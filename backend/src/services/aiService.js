const Anthropic = require('@anthropic-ai/sdk');
const { buildContext, findExactFaqMatch } = require('./dataService');
const conversationStore = require('./conversationStore');
const { getCachedResponse, setCachedResponse, trackKeywords } = require('./responseCache');

const client = new Anthropic();

const SYSTEM_PROMPT = `프리텔레콤(프리티) 셀프개통 상담 AI. 존댓말, 간결, 정확.
규칙:
- 요금제 안내 시 detailUrl 링크 필수: "👉 [상세보기](url)" + "📱 [바로 개통](https://www.freet.co.kr/self/usimOpen)"
- 개통절차 → 단계별 번호
- 약관 → 쉬운말 요약
- 모르면 → 고객센터 안내 (SKT:1661-2207/KT:1577-4551/U+:1588-3615)
- 마크다운 사용`;

// 세션별 대화 히스토리 (AI 컨텍스트용)
const sessions = new Map();
const SESSION_TTL = 30 * 60 * 1000;

function getHistory(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return [];
  if (Date.now() - session.lastAccess > SESSION_TTL) {
    sessions.delete(sessionId);
    return [];
  }
  session.lastAccess = Date.now();
  return session.messages;
}

function addToHistory(sessionId, role, content) {
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, { messages: [], lastAccess: Date.now() });
  }
  const session = sessions.get(sessionId);
  session.messages.push({ role, content });
  session.lastAccess = Date.now();
  if (session.messages.length > 20) {
    session.messages = session.messages.slice(-20);
  }
}

// 카테고리 추정
function detectCategory(message) {
  const lower = message.toLowerCase();
  if (['요금', '상품', '가격', '추천', '비교', '얼마'].some(k => lower.includes(k))) return 'product';
  if (['개통', '가입', '유심', '준비', '절차', '방법', 'esim', '이심'].some(k => lower.includes(k))) return 'opening';
  if (['약관', '해지', '계약', '환불'].some(k => lower.includes(k))) return 'terms';
  if (['고객센터', '전화', '문의', '연락'].some(k => lower.includes(k))) return 'cs';
  if (['납부', '결제', '자동이체', '청구'].some(k => lower.includes(k))) return 'payment';
  return 'general';
}

async function chat(message, sessionId) {
  const startTime = Date.now();
  const category = detectCategory(message);

  // 키워드 추적 (통계용)
  const keywords = trackKeywords(message, category);

  addToHistory(sessionId, 'user', message);
  conversationStore.saveMessage(sessionId, { role: 'user', content: message, category });

  let reply;
  let source = 'ai'; // ai | faq_direct | cache_exact | cache_similar
  let tokensUsed = { input: 0, output: 0 };

  // ─── 1단계: FAQ 정확 매칭 (AI 호출 없음, 토큰 0) ───
  const faqMatch = findExactFaqMatch(message);
  if (faqMatch && getHistory(sessionId).length <= 2) {
    // 첫 질문이고 FAQ에 정확히 매칭되면 직접 응답
    reply = faqMatch.answer;
    source = 'faq_direct';
  }

  // ─── 2단계: 캐시 조회 (AI 호출 없음, 토큰 0) ───
  if (!reply) {
    const cached = getCachedResponse(message);
    if (cached) {
      reply = cached.reply;
      source = cached.source;
    }
  }

  // ─── 3단계: AI 호출 (캐시 미스 시만) ───
  if (!reply) {
    const context = buildContext(message);
    const history = getHistory(sessionId);

    // 히스토리도 최소화: 최근 6턴만 (기존 18턴 → 6턴)
    const recentHistory = history.slice(-6);

    const messages = [
      ...recentHistory,
      {
        role: 'user',
        content: `[데이터]\n${context}\n[질문] ${message}`
      }
    ];

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 768, // 1024 → 768 축소
      system: SYSTEM_PROMPT,
      messages
    });

    reply = response.content[0].text;
    tokensUsed = {
      input: response.usage?.input_tokens || 0,
      output: response.usage?.output_tokens || 0
    };
    source = 'ai';

    // 캐시에 저장 (다음 동일 질문 시 AI 호출 불필요)
    setCachedResponse(message, reply, category);
  }

  const responseTimeMs = Date.now() - startTime;
  addToHistory(sessionId, 'assistant', reply);

  // 봇 응답 영구 저장
  conversationStore.saveMessage(sessionId, {
    role: 'bot',
    content: reply,
    category,
    responseTimeMs,
    tokensUsed,
    model: source === 'ai' ? 'claude-haiku-4-5' : source,
    source
  });

  return { reply, category, source, tokensUsed };
}

module.exports = { chat };
