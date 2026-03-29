const express = require('express');
const router = express.Router();
const { login, authenticate } = require('../middleware/adminAuth');
const store = require('../services/conversationStore');
const { getKeywordStats, getCacheStats } = require('../services/responseCache');
const { searchDocuments, reindex } = require('../rag/ragChain');
const { addDocuments, addToSourceJson, saveManualDoc, getManualDocs, deleteManualDoc } = require('../rag/ingest');
const { Document } = require('@langchain/core/documents');
const fs = require('fs');
const path = require('path');

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

// ─── RAG 관리 ───

// RAG 검색 테스트
router.get('/rag/search', async (req, res) => {
  const { query, k } = req.query;
  if (!query) return res.status(400).json({ error: '검색어가 필요합니다.' });
  const results = await searchDocuments(query, parseInt(k) || 5);
  res.json({ query, results, count: results.length });
});

// RAG 재인덱싱
router.post('/rag/reindex', async (req, res) => {
  try {
    const stats = await reindex();
    res.json({ success: true, stats });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// RAG 벡터 스토어 통계
router.get('/rag/stats', (req, res) => {
  const statsPath = path.join(__dirname, '..', 'data', 'vectorstore', 'stats.json');
  if (fs.existsSync(statsPath)) {
    res.json(JSON.parse(fs.readFileSync(statsPath, 'utf-8')));
  } else {
    res.json({ error: '벡터 스토어가 아직 생성되지 않았습니다.' });
  }
});

// 문서 수동 추가 (JSON + 벡터 + 이력 모두 반영)
router.post('/rag/add', async (req, res) => {
  try {
    const { content, type, metadata } = req.body;
    if (!content || !content.trim()) return res.status(400).json({ error: '내용을 입력해주세요.' });

    const docType = type || 'manual';

    // 1. JSON 원본에 반영
    const sourceResult = addToSourceJson(docType, content.trim());

    // 2. 벡터 DB에 추가
    const doc = new Document({
      pageContent: content.trim(),
      metadata: { source: 'manual', type: docType, addedAt: new Date().toISOString(), ...metadata }
    });
    const { added, stats } = await addDocuments([doc]);

    // 3. 수동 추가 이력 저장
    const record = {
      id: `doc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      type: docType,
      content: content.trim(),
      sourceId: sourceResult.sourceId || null,
      createdAt: new Date().toISOString()
    };
    saveManualDoc(record);

    res.json({ success: true, added, record, stats });
  } catch (err) {
    console.error('문서 추가 오류:', err.message);
    res.status(500).json({ error: '문서 추가 실패: ' + err.message });
  }
});

// 수동 추가 이력 조회
router.get('/rag/documents', (req, res) => {
  const { page, limit, type } = req.query;
  res.json(getManualDocs({ page: parseInt(page) || 1, limit: parseInt(limit) || 20, type }));
});

// 수동 추가 문서 삭제
router.delete('/rag/documents/:id', (req, res) => {
  const deleted = deleteManualDoc(req.params.id);
  if (!deleted) return res.status(404).json({ error: '문서를 찾을 수 없습니다.' });
  res.json({ success: true, message: '이력에서 삭제되었습니다. 벡터 DB 반영은 재인덱싱이 필요합니다.' });
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
