// 응답 품질 자동 스코어링 (0~100점)

const UNRESOLVED_PATTERNS = [
  '답변을 드리기 어렵습니다', '답변이 어렵습니다',
  '정확한 답변을 드리기', '일시적인 오류가 발생'
];

const NEGATIVE_FOLLOWUPS = [
  '아니요', '아닌데', '그게 아니라', '아니고',
  '다시', '다시 알려', '모르겠', '고객센터', '상담원'
];

function scoreResponse({ reply, source, responseTimeMs, category, previousMessages = [] }) {
  let score = 70; // 기본 (RAG 정상)

  // ── 가산 ──
  if (source === 'faq_direct') score += 15;
  if (source === 'cache_exact' || source === 'cache_similar') score += 10;
  if (reply.includes('freet.co.kr')) score += 10; // 프리티 링크 포함
  if (reply.length >= 50 && reply.length <= 500) score += 5; // 적절한 길이

  // ── 감산 ──
  if (UNRESOLVED_PATTERNS.some(p => reply.includes(p))) score -= 30;
  if (source === 'error') score -= 20;
  if (responseTimeMs > 5000) score -= 10;
  if (reply.length < 30) score -= 5;

  // 동일 세션에서 같은 카테고리 반복 질문 (불만족 추정)
  if (previousMessages.length > 0) {
    const recentUserMsgs = previousMessages.filter(m => m.role === 'user').slice(-3);
    const sameCategory = recentUserMsgs.filter(m => m.category === category);
    if (sameCategory.length >= 2) score -= 10;
  }

  // 직후 부정 키워드 감지용 (호출자가 추후 조정)
  return Math.max(0, Math.min(100, Math.round(score)));
}

// 후속 메시지로 이전 응답 품질 재평가
function adjustScoreByFollowup(followupMessage) {
  const lower = followupMessage.toLowerCase();
  if (NEGATIVE_FOLLOWUPS.some(k => lower.includes(k))) return -15;
  return 0;
}

function isUnresolved(reply) {
  return UNRESOLVED_PATTERNS.some(p => reply.includes(p));
}

module.exports = { scoreResponse, adjustScoreByFollowup, isUnresolved };
