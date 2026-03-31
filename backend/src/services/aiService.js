const { findExactFaqMatch, getProducts, getFaqs, getGuide } = require('./dataService');
const { scoreResponse, adjustScoreByFollowup, isUnresolved } = require('./qualityScorer');
const dbQ = require('../db/queries');
const { ragChat, initChain } = require('../rag/ragChain');

// AI 컨텍스트용 메모리 히스토리 (빠른 접근)
const sessions = new Map();
const SESSION_TTL = 30 * 60 * 1000;

// ─── 키워드 추출 ───
const STOP_WORDS = new Set(['이','그','저','것','수','등','를','을','에','의','가','은','는','좀','해','요','주세요','알려','뭐','어떻게']);
const KEYWORD_MAP = {
  '개통':'opening','셀프개통':'opening','가입':'opening','번호이동':'opening',
  '유심':'opening','esim':'opening','이심':'opening','인증':'opening',
  '요금제':'product','요금':'product','가격':'product','추천':'product','비교':'product',
  '데이터':'product','통화':'product','무제한':'product','프로모션':'product',
  '약관':'terms','해지':'terms','계약':'terms','환불':'terms',
  '고객센터':'cs','전화번호':'cs','문의':'cs','상담':'cs',
  '납부':'payment','결제':'payment','충전':'payment'
};

function extractAndTrackKeywords(message, category) {
  const lower = message.toLowerCase();
  for (const [kw, cat] of Object.entries(KEYWORD_MAP)) {
    if (lower.includes(kw)) dbQ.trackKeyword(kw, cat);
  }
  const words = lower.split(/\s+/).filter(w => w.length >= 2 && !STOP_WORDS.has(w));
  words.forEach(w => { if (!KEYWORD_MAP[w]) dbQ.trackKeyword(w, category); });
}

// ─── 히스토리 관리 (메모리 + DB 폴백) ───
function getHistory(sessionId) {
  const mem = sessions.get(sessionId);
  if (mem && Date.now() - mem.lastAccess < SESSION_TTL) {
    mem.lastAccess = Date.now();
    return mem.messages;
  }

  // DB에서 복원 (서버 재시작 시)
  const session = dbQ.getSession(sessionId);
  if (session && session.messages.length > 0) {
    const msgs = session.messages.slice(-12).map(m => ({ role: m.role === 'bot' ? 'assistant' : m.role, content: m.content }));
    sessions.set(sessionId, { messages: msgs, lastAccess: Date.now() });
    return msgs;
  }
  return [];
}

function addToHistory(sessionId, role, content) {
  if (!sessions.has(sessionId)) sessions.set(sessionId, { messages: [], lastAccess: Date.now() });
  const s = sessions.get(sessionId);
  s.messages.push({ role, content });
  s.lastAccess = Date.now();
  if (s.messages.length > 12) s.messages = s.messages.slice(-12);
}

// ─── 카테고리 감지 ───
function detectCategory(message) {
  const lower = message.toLowerCase();
  if (['요금','상품','가격','추천','비교','얼마'].some(k => lower.includes(k))) return 'product';
  if (['개통','가입','유심','준비','절차','방법','esim','이심'].some(k => lower.includes(k))) return 'opening';
  if (['약관','해지','계약','환불'].some(k => lower.includes(k))) return 'terms';
  if (['고객센터','전화','문의','연락'].some(k => lower.includes(k))) return 'cs';
  if (['납부','결제','자동이체','청구'].some(k => lower.includes(k))) return 'payment';
  return 'general';
}

// ─── 캐시 정규화 ───
function normalizeQuery(msg) {
  return msg.replace(/[?？！!~.,\s]+/g, ' ').trim().toLowerCase().replace(/\s+/g, ' ');
}

// ─── 메인 채팅 ───
async function chat(message, sessionId) {
  const startTime = Date.now();
  const category = detectCategory(message);

  // 키워드 추적 (DB)
  extractAndTrackKeywords(message, category);

  // 히스토리에 사용자 메시지 추가
  addToHistory(sessionId, 'user', message);

  // 사용자 메시지 DB 저장
  const userMsgId = dbQ.saveMessage(sessionId, {
    role: 'user', content: message, category, source: null,
    qualityScore: null, tokensUsed: { input: 0, output: 0 }
  });

  // 이전 봇 응답 품질 재평가 (부정 후속 메시지 감지)
  const adjustment = adjustScoreByFollowup(message);
  if (adjustment < 0) {
    // 직전 봇 메시지 품질 하향 처리는 별도 로직 필요 시 추가
  }

  let reply;
  let source = 'rag';
  let tokensUsed = { input: 0, output: 0 };

  // ── 1단계: FAQ 직접 매칭 ──
  const history = getHistory(sessionId);
  const faqMatch = findExactFaqMatch(message);
  if (faqMatch && history.length <= 2) {
    reply = faqMatch.answer;
    source = 'faq_direct';
  }

  // ── 2단계: DB 캐시 조회 ──
  // 사용량/조건 포함 메시지는 매번 RAG 검색 필요 (캐시 스킵)
  const hasUsageInfo = /\d+\s*(gb|기가|분|만원|만\s*원)/i.test(message);
  const isConversational = history.length > 2; // 대화 중이면 캐시 스킵

  if (!reply && !hasUsageInfo && !isConversational) {
    const queryKey = normalizeQuery(message);
    const cached = dbQ.getCachedResponse(queryKey);
    if (cached && !isUnresolved(cached.reply)) {
      reply = cached.reply;
      source = cached.source;
    }
  }

  // ── 3단계: RAG 체인 ──
  if (!reply) {
    const historyText = history.slice(-6).map(m =>
      `${m.role === 'user' ? '고객' : '상담AI'}: ${m.content.slice(0, 200)}`
    ).join('\n');

    try {
      reply = await ragChat(message, historyText);
      source = 'rag';
    } catch (err) {
      console.error('RAG 에러:', err.message);
      // RAG 실패 시 폴백: 관련 데이터로 기본 응답 생성
      reply = generateFallbackReply(message, category);
      source = 'fallback';
    }

    // 품질 좋은 응답만 캐시 (답변 불가/에러/사용량 답변은 캐시하지 않음)
    if (!isUnresolved(reply) && source !== 'fallback' && !hasUsageInfo) {
      dbQ.setCachedResponse(normalizeQuery(message), reply, category);
    }
  }

  const responseTimeMs = Date.now() - startTime;

  // 품질 스코어 산출
  const qualityScore = scoreResponse({
    reply, source, responseTimeMs, category,
    previousMessages: history.map(m => ({ role: m.role, category }))
  });

  // 히스토리에 봇 응답 추가
  addToHistory(sessionId, 'assistant', reply);

  // 봇 응답 DB 저장
  const botMsgId = dbQ.saveMessage(sessionId, {
    role: 'bot', content: reply, category, source,
    responseTimeMs, qualityScore,
    tokensUsed, model: source === 'rag' ? 'claude-haiku-4-5 (RAG)' : source
  });

  // 미해결 시 큐에 추가
  if (isUnresolved(reply)) {
    dbQ.addUnresolvedItem(sessionId, botMsgId, message, reply, category);
  }

  return { reply, category, source, tokensUsed, qualityScore, messageId: botMsgId };
}

// ─── 폴백 응답 생성 (RAG 실패 시 데이터 기반 직접 응답) ───
function generateFallbackReply(message, category) {
  const lower = message.toLowerCase();

  if (category === 'product' || ['요금', '가격', '추천'].some(k => lower.includes(k))) {
    const products = getProducts();
    const top5 = products.sort((a, b) => (a.sellingPrice || a.monthlyFee) - (b.sellingPrice || b.monthlyFee)).slice(0, 5);
    let reply = '프리티 요금제를 안내드립니다.\n\n';
    top5.forEach((p, i) => {
      const price = p.sellingPrice || p.monthlyFee;
      reply += `**${i + 1}. ${p.name}** (${p.network})\n`;
      reply += `   월 ${price.toLocaleString()}원 | ${p.data} | 통화: ${p.voice}\n`;
      if (p.hasDiscount) reply += `   ${p.discountMonths}개월 후: 월 ${(p.afterDiscountPrice || p.originalPrice).toLocaleString()}원\n`;
      reply += `   👉 [상세보기](${p.detailUrl})\n\n`;
    });
    reply += '더 자세한 요금제는 프리티 홈페이지를 확인해주세요.\n📱 [전체 요금제 보기](https://www.freet.co.kr/plan/ratePlan)';
    return reply;
  }

  if (category === 'opening' || ['개통', '가입', '유심'].some(k => lower.includes(k))) {
    const guide = getGuide();
    const steps = guide.selfActivation?.steps || [];
    let reply = '프리티 셀프개통 절차를 안내드립니다.\n\n';
    steps.forEach(s => { reply += `**${s.step}단계. ${s.title}**\n${s.description}\n\n`; });
    reply += `⏰ 신규: ${guide.selfActivation?.hours?.newActivation || '09:00~20:00'}\n`;
    reply += `⏰ 번호이동: ${guide.selfActivation?.hours?.numberTransfer || '10:00~19:00'}\n`;
    reply += `\n📱 [셀프개통 바로가기](https://www.freet.co.kr/self/usimOpen)`;
    return reply;
  }

  if (category === 'cs' || ['고객센터', '전화', '연락', '문의'].some(k => lower.includes(k))) {
    return '**프리티 고객센터 안내**\n\n| 통신망 | 전화번호 | 이메일 |\n|--------|----------|--------|\n| SKT | [1661-2207](tel:1661-2207) | skt@freet.co.kr |\n| KT | [1577-4551](tel:1577-4551) | kt@freet.co.kr |\n| U+ | [1588-3615](tel:1588-3615) | lg@freet.co.kr |\n| 무료 | [114](tel:114) | - |\n\n⏰ 평일 09:00~18:00 (점심 12:00~13:00)\n💬 [1:1 온라인 문의](https://www.freet.co.kr/customer/inquiry/form)';
  }

  // 기본 폴백
  return '죄송합니다. 해당 문의에 대해 정확한 답변을 드리기 어렵습니다.\n\n고객센터로 문의해주시면 상세한 안내를 받으실 수 있습니다.\n\n| 통신망 | 전화번호 |\n|--------|----------|\n| SKT | [1661-2207](tel:1661-2207) |\n| KT | [1577-4551](tel:1577-4551) |\n| U+ | [1588-3615](tel:1588-3615) |\n\n⏰ 평일 09:00~18:00\n💬 [1:1 문의](https://www.freet.co.kr/customer/inquiry/form)';
}

// 서버 시작 시 RAG 초기화
initChain().catch(err => console.error('RAG 초기화 실패:', err.message));

module.exports = { chat };
