const express = require('express');
const router = express.Router();
const { login, authenticate } = require('../middleware/adminAuth');
const dbQ = require('../db/queries');
const { searchDocuments, reindex } = require('../rag/ragChain');
const { addDocuments, addToSourceJson, saveManualDoc, getManualDocs, deleteManualDoc } = require('../rag/ingest');
const { Document } = require('@langchain/core/documents');
const fs = require('fs');
const path = require('path');
const { toKSTString } = require('../utils/kst');

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

// ═══ 응답 수정 (즉시 조치) ═══

// 봇 응답 수정 → 캐시 즉시 반영
router.post('/messages/:messageId/correct', (req, res) => {
  const { correctedReply } = req.body;
  if (!correctedReply?.trim()) return res.status(400).json({ error: '수정된 답변을 입력하세요.' });
  const result = dbQ.correctResponse(req.params.messageId, correctedReply.trim());
  if (!result) return res.status(404).json({ error: '메시지를 찾을 수 없습니다.' });
  res.json({ success: true, ...result, message: '수정 완료. 동일 질문 시 수정된 답변이 제공됩니다.' });
});

// 관리자 답변 직접 등록 (질문 + 답변)
router.post('/responses/add', async (req, res) => {
  const { question, reply, category, addToFaq } = req.body;
  if (!question?.trim() || !reply?.trim()) return res.status(400).json({ error: '질문과 답변을 모두 입력하세요.' });

  // 캐시 등록
  const result = dbQ.setAdminResponse(question.trim(), reply.trim(), category);

  // FAQ 등록 옵션
  if (addToFaq) {
    const content = `질문: ${question.trim()}\n답변: ${reply.trim()}`;
    addToSourceJson('faq', content);
    const doc = new Document({ pageContent: content, metadata: { source: 'admin_response', type: 'faq' } });
    await addDocuments([doc]);
  }

  res.json({ success: true, ...result, faqAdded: !!addToFaq, message: addToFaq ? '캐시 + FAQ + 벡터DB 반영 완료' : '캐시에 반영 완료' });
});

// ═══ RAG 타입별 원본 데이터 조회 ═══
router.get('/rag/data/:type', (req, res) => {
  const { type } = req.params;
  const { page = 1, limit = 20 } = req.query;
  const p = parseInt(page);
  const l = Math.min(parseInt(limit), 100);
  const dataDir = path.join(__dirname, '..', 'data');

  let items = [];
  let total = 0;

  if (type === 'faq') {
    const all = JSON.parse(fs.readFileSync(path.join(dataDir, 'faq.json'), 'utf-8'));
    total = all.length;
    items = all.slice((p - 1) * l, p * l).map(f => ({
      id: f.id, type: 'faq', category: f.category,
      title: f.question, content: f.answer, keywords: f.keywords
    }));
  } else if (type === 'products') {
    const all = JSON.parse(fs.readFileSync(path.join(dataDir, 'products.json'), 'utf-8'));
    total = all.length;
    items = all.slice((p - 1) * l, p * l).map(pr => ({
      id: pr.id, type: 'product', name: pr.name, network: pr.network,
      sellingPrice: pr.sellingPrice || pr.monthlyFee,
      data: pr.data, voice: pr.voice, sms: pr.sms,
      categories: pr.categories, detailUrl: pr.detailUrl,
      hasDiscount: pr.hasDiscount, discountMonths: pr.discountMonths,
      afterDiscountPrice: pr.afterDiscountPrice
    }));
  } else if (type === 'terms') {
    const all = JSON.parse(fs.readFileSync(path.join(dataDir, 'terms.json'), 'utf-8'));
    total = all.length;
    items = all.slice((p - 1) * l, p * l).map(t => ({
      id: t.id, type: 'terms', title: t.title, section: t.section,
      content: t.summary
    }));
  } else if (type === 'guide') {
    const guide = JSON.parse(fs.readFileSync(path.join(dataDir, 'guide.json'), 'utf-8'));
    const steps = guide.selfActivation?.steps || [];
    total = steps.length;
    items = steps.slice((p - 1) * l, p * l).map((s, i) => ({
      id: `step_${s.step}`, type: 'guide', title: `${s.step}단계: ${s.title}`,
      content: s.description + (s.note ? ` (※${s.note})` : '')
    }));
  } else if (type === 'pdf') {
    const pdfDir = path.join(dataDir, 'pdf');
    if (fs.existsSync(pdfDir)) {
      const files = fs.readdirSync(pdfDir).filter(f => f.endsWith('.pdf'));
      total = files.length;
      items = files.map(f => ({
        id: f, type: 'pdf', title: f,
        content: `${f} (벡터 DB에 청크로 저장됨)`,
        size: fs.statSync(path.join(pdfDir, f)).size
      }));
    }
  }

  res.json({ items, total, page: p, limit: l, totalPages: Math.ceil(total / l) });
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
    const record = { id: `doc_${Date.now()}`, type: type || 'manual', content: content.trim(), sourceId: sourceResult.sourceId, createdAt: toKSTString() };
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
