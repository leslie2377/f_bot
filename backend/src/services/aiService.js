const { findExactFaqMatch } = require('./dataService');
const conversationStore = require('./conversationStore');
const { getCachedResponse, setCachedResponse, trackKeywords } = require('./responseCache');
const { ragChat, initChain } = require('../rag/ragChain');

// 세션별 대화 히스토리 (RAG 컨텍스트용)
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
  if (session.messages.length > 12) {
    session.messages = session.messages.slice(-12);
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

// 히스토리를 텍스트로 변환 (RAG 프롬프트용)
function formatHistory(sessionId) {
  const history = getHistory(sessionId);
  if (history.length === 0) return '';
  return history.slice(-6).map(m =>
    `${m.role === 'user' ? '고객' : '상담AI'}: ${m.content.slice(0, 200)}`
  ).join('\n');
}

async function chat(message, sessionId) {
  const startTime = Date.now();
  const category = detectCategory(message);

  // 키워드 추적
  trackKeywords(message, category);

  addToHistory(sessionId, 'user', message);
  conversationStore.saveMessage(sessionId, { role: 'user', content: message, category });

  let reply;
  let source = 'rag'; // rag | faq_direct | cache_exact | cache_similar
  let tokensUsed = { input: 0, output: 0 };

  // ─── 1단계: FAQ 정확 매칭 (AI 호출 없음, 토큰 0) ───
  const faqMatch = findExactFaqMatch(message);
  if (faqMatch && getHistory(sessionId).length <= 2) {
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

  // ─── 3단계: LangChain RAG 체인 (벡터 검색 + AI) ───
  if (!reply) {
    const history = formatHistory(sessionId);
    reply = await ragChat(message, history);
    source = 'rag';

    // 캐시에 저장
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
    model: source === 'rag' ? 'claude-haiku-4-5 (RAG)' : source,
    source
  });

  return { reply, category, source, tokensUsed };
}

// 서버 시작 시 RAG 초기화 (비동기)
initChain().catch(err => console.error('RAG 초기화 실패:', err.message));

module.exports = { chat };
