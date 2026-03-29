const express = require('express');
const router = express.Router();
const { login, authenticate } = require('../middleware/adminAuth');
const dbQ = require('../db/queries');
const { searchDocuments, reindex } = require('../rag/ragChain');
const { addDocuments, addToSourceJson, saveManualDoc, getManualDocs, deleteManualDoc } = require('../rag/ingest');
const { Document } = require('@langchain/core/documents');
const fs = require('fs');
const path = require('path');

// 로그인
router.post('/login', login);
router.use(authenticate);

// ═══ 세션 ═══
router.get('/sessions', (req, res) => {
  const { page, limit, search, category, dateFrom, dateTo, status, sort } = req.query;
  res.json(dbQ.getSessions({
    page: parseInt(page) || 1, limit: Math.min(parseInt(limit) || 20, 100),
    search, category, dateFrom, dateTo, status, sort
  }));
});

router.get('/sessions/:sessionId', (req, res) => {
  const session = dbQ.getSession(req.params.sessionId);
  if (!session) return res.status(404).json({ error: '세션을 찾을 수 없습니다.' });
  res.json(session);
});

router.delete('/sessions/:sessionId', (req, res) => {
  const deleted = dbQ.deleteSession(req.params.sessionId);
  if (!deleted) return res.status(404).json({ error: '세션을 찾을 수 없습니다.' });
  res.json({ success: true });
});

// ═══ 통계 ═══
router.get('/stats', (req, res) => res.json(dbQ.getStats()));

router.get('/stats/daily', (req, res) => {
  res.json(dbQ.getDailyStats(req.query.from, req.query.to));
});

router.get('/stats/quality', (req, res) => {
  res.json(dbQ.getQualityTrend(parseInt(req.query.days) || 14));
});

// ═══ 미해결 & 인기 ═══
router.get('/unresolved', (req, res) => {
  res.json(dbQ.getUnresolved({ page: parseInt(req.query.page) || 1, limit: parseInt(req.query.limit) || 20 }));
});

router.get('/popular', (req, res) => {
  res.json(dbQ.getPopularQuestions(parseInt(req.query.limit) || 10));
});

// ═══ 미해결 큐 (관리자 검토) ═══
router.get('/unresolved-queue', (req, res) => {
  const { page, limit, status } = req.query;
  res.json(dbQ.getUnresolvedQueue({ page: parseInt(page) || 1, limit: parseInt(limit) || 20, status: status || 'pending' }));
});

router.post('/unresolved-queue/:id/resolve', async (req, res) => {
  const { adminAnswer, action } = req.body; // action: resolved | faq_added
  dbQ.resolveUnresolvedItem(parseInt(req.params.id), adminAnswer, action);

  // FAQ 등록 시 벡터 DB에도 반영
  if (action === 'faq_added' && adminAnswer) {
    const item = require('../db/schema').prepare('SELECT * FROM unresolved_queue WHERE id = ?').get(parseInt(req.params.id));
    if (item) {
      const content = `질문: ${item.user_question}\n답변: ${adminAnswer}`;
      addToSourceJson('faq', content);
      const doc = new Document({ pageContent: content, metadata: { source: 'admin_resolve', type: 'faq' } });
      await addDocuments([doc]);
    }
  }
  res.json({ success: true });
});

// ═══ 키워드 ═══
router.get('/keywords', (req, res) => {
  res.json(dbQ.getKeywordStats({ sort: req.query.sort, limit: parseInt(req.query.limit) || 50, category: req.query.category }));
});

// ═══ 캐시 ═══
router.get('/cache', (req, res) => res.json(dbQ.getCacheStats()));

// ═══ RAG 관리 ═══
router.get('/rag/search', async (req, res) => {
  const { query, k } = req.query;
  if (!query) return res.status(400).json({ error: '검색어가 필요합니다.' });
  res.json({ query, results: await searchDocuments(query, parseInt(k) || 5), count: 0 });
});

router.post('/rag/reindex', async (req, res) => {
  try { res.json({ success: true, stats: await reindex() }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/rag/stats', (req, res) => {
  const statsPath = path.join(__dirname, '..', 'data', 'vectorstore', 'stats.json');
  if (fs.existsSync(statsPath)) res.json(JSON.parse(fs.readFileSync(statsPath, 'utf-8')));
  else res.json({ error: '벡터 스토어 없음' });
});

router.post('/rag/add', async (req, res) => {
  try {
    const { content, type, metadata } = req.body;
    if (!content?.trim()) return res.status(400).json({ error: '내용을 입력해주세요.' });
    const sourceResult = addToSourceJson(type || 'manual', content.trim());
    const doc = new Document({ pageContent: content.trim(), metadata: { source: 'manual', type: type || 'manual', ...metadata } });
    const { added, stats } = await addDocuments([doc]);
    const record = { id: `doc_${Date.now()}`, type: type || 'manual', content: content.trim(), sourceId: sourceResult.sourceId, createdAt: new Date().toISOString() };
    saveManualDoc(record);
    res.json({ success: true, added, record, stats });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/rag/documents', (req, res) => {
  res.json(getManualDocs({ page: parseInt(req.query.page) || 1, limit: parseInt(req.query.limit) || 20, type: req.query.type }));
});

router.delete('/rag/documents/:id', (req, res) => {
  const deleted = deleteManualDoc(req.params.id);
  if (!deleted) return res.status(404).json({ error: '문서를 찾을 수 없습니다.' });
  res.json({ success: true });
});

// ═══ 내보내기 ═══
router.get('/export', (req, res) => {
  const result = dbQ.exportSessions({ format: req.query.format, from: req.query.from, to: req.query.to, category: req.query.category });
  res.setHeader('Content-Type', result.contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
  res.send(result.data);
});

module.exports = router;
