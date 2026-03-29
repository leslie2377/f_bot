const { findExactFaqMatch } = require('./dataService');
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
  if (!reply) {
    const queryKey = normalizeQuery(message);
    const cached = dbQ.getCachedResponse(queryKey);
    if (cached) {
      reply = cached.reply;
      source = cached.source;
    }
  }

  // ── 3단계: RAG 체인 ──
  if (!reply) {
    const historyText = history.slice(-6).map(m =>
      `${m.role === 'user' ? '고객' : '상담AI'}: ${m.content.slice(0, 200)}`
    ).join('\n');

    reply = await ragChat(message, historyText);
    source = 'rag';

    // 캐시 저장
    dbQ.setCachedResponse(normalizeQuery(message), reply, category);
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

// 서버 시작 시 RAG 초기화
initChain().catch(err => console.error('RAG 초기화 실패:', err.message));

module.exports = { chat };
