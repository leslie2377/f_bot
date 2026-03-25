const Anthropic = require('@anthropic-ai/sdk');
const { buildContext } = require('./dataService');
const conversationStore = require('./conversationStore');

const client = new Anthropic();

const SYSTEM_PROMPT = `당신은 프리텔레콤(프리티) 공식 셀프개통 전문 상담 AI입니다.

역할:
- 프리텔레콤 셀프개통, 요금제, 약관에 대해 정확하고 친절하게 안내합니다.
- 제공된 데이터만을 기반으로 답변합니다. 데이터에 없는 내용은 추측하지 않습니다.
- 모르는 내용은 반드시 고객센터 연결을 안내합니다.

톤앤매너:
- 친절하고 전문적인 상담원 톤으로 존댓말을 사용합니다.
- 핵심 정보를 먼저 전달하고, 부가 설명은 뒤에 덧붙입니다.
- 이모지를 적절히 사용하여 친근감을 줍니다.

응답 규칙:
1. 요금제 질문 → 요금제 데이터 기반으로 안내하고, 반드시 detailUrl 링크를 포함하세요
   - 형식: "👉 [요금제명 상세보기](detailUrl)"
   - 개통 신청 링크도 함께: "📱 [바로 개통하기](openUrl)"
2. 개통 절차 → 단계별 번호를 매겨 안내
3. 약관 질문 → 쉬운 말로 요약하여 설명
4. FAQ 질문 → FAQ 데이터 기반 답변
5. 답변 불가 → "정확한 답변을 드리기 어렵습니다" + 고객센터 번호 안내
6. 인사말 → "안녕하세요! 프리티 셀프개통 상담 AI입니다 😊" 로 시작
7. 요금제 추천/비교 시 → 각 요금제마다 프리티 홈페이지 링크를 꼭 포함하세요

고객센터 안내 시:
- SKT 알뜰폰: 1661-2207
- KT 알뜰폰: 1577-4551
- U+ 알뜰폰: 1588-3615
- 운영시간: 평일 09:00~18:00

응답은 간결하되 필요한 정보는 빠짐없이 전달하세요. 마크다운 형식을 사용할 수 있습니다.`;

// 세션별 대화 히스토리
const sessions = new Map();
const SESSION_TTL = 30 * 60 * 1000; // 30분

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
  // 최근 10턴만 유지
  if (session.messages.length > 20) {
    session.messages = session.messages.slice(-20);
  }
}

async function chat(message, sessionId) {
  const startTime = Date.now();
  const context = buildContext(message);
  const history = getHistory(sessionId);

  addToHistory(sessionId, 'user', message);

  // 카테고리 추정 (먼저 수행)
  let category = 'general';
  const lower = message.toLowerCase();
  if (['요금', '상품', '가격', '추천'].some(k => lower.includes(k))) category = 'product';
  else if (['개통', '가입', '유심', '준비'].some(k => lower.includes(k))) category = 'opening';
  else if (['약관', '해지', '계약'].some(k => lower.includes(k))) category = 'terms';
  else if (['고객센터', '전화', '문의'].some(k => lower.includes(k))) category = 'cs';

  // 사용자 메시지 영구 저장
  conversationStore.saveMessage(sessionId, { role: 'user', content: message, category });

  const messages = [
    ...history.slice(-18),
    {
      role: 'user',
      content: `[참고 데이터]\n${context}\n\n[고객 질문]\n${message}`
    }
  ];

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages
  });

  const reply = response.content[0].text;
  const responseTimeMs = Date.now() - startTime;
  addToHistory(sessionId, 'assistant', reply);

  // 봇 응답 영구 저장
  conversationStore.saveMessage(sessionId, {
    role: 'bot',
    content: reply,
    category,
    responseTimeMs,
    tokensUsed: {
      input: response.usage?.input_tokens || 0,
      output: response.usage?.output_tokens || 0
    },
    model: 'claude-haiku-4-5-20251001'
  });

  return { reply, category };
}

module.exports = { chat };
