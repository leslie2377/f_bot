const express = require('express');
const router = express.Router();
const { login, authenticate } = require('../middleware/adminAuth');
const store = require('../services/conversationStore');
const { getKeywordStats, getCacheStats } = require('../services/responseCache');

// 로그인 (인증 불필요)
router.post('/login', login);

// 이하 모든 라우트 인증 필요
router.use(authenticate);

// 세션 목록
router.get('/sessions', (req, res) => {
  const { page, limit, search, category, dateFrom, dateTo, status, sort } = req.query;
  const result = store.getSessions({
    page: parseInt(page) || 1,
    limit: Math.min(parseInt(limit) || 20, 100),
    search, category, dateFrom, dateTo, status, sort
  });
  res.json(result);
});

// 세션 상세
router.get('/sessions/:sessionId', (req, res) => {
  const session = store.getSession(req.params.sessionId);
  if (!session) return res.status(404).json({ error: '세션을 찾을 수 없습니다.' });
  res.json(session);
});

// 세션 삭제
router.delete('/sessions/:sessionId', (req, res) => {
  const deleted = store.deleteSession(req.params.sessionId);
  if (!deleted) return res.status(404).json({ error: '세션을 찾을 수 없습니다.' });
  res.json({ success: true, message: '세션이 삭제되었습니다.' });
});

// 전체 통계
router.get('/stats', (req, res) => {
  res.json(store.getStats());
});

// 일별 통계
router.get('/stats/daily', (req, res) => {
  const { from, to } = req.query;
  res.json(store.getDailyStats(from, to));
});

// 미해결 질문
router.get('/unresolved', (req, res) => {
  const { page, limit } = req.query;
  res.json(store.getUnresolved({ page: parseInt(page) || 1, limit: parseInt(limit) || 20 }));
});

// 인기 질문
router.get('/popular', (req, res) => {
  const { limit } = req.query;
  res.json(store.getPopularQuestions(parseInt(limit) || 10));
});

// 키워드 통계
router.get('/keywords', (req, res) => {
  const { sort, limit, category } = req.query;
  res.json(getKeywordStats({ sort, limit: parseInt(limit) || 50, category }));
});

// 캐시 통계
router.get('/cache', (req, res) => {
  res.json(getCacheStats());
});

// 내보내기
router.get('/export', (req, res) => {
  const { format, from, to, category } = req.query;
  const result = store.exportSessions({ format, from, to, category });
  res.setHeader('Content-Type', result.contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
  res.send(result.data);
});

module.exports = router;
