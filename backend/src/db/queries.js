const db = require('./schema');
const { toKSTDate, toKSTDateTime } = require('../utils/kst');

// ═══════════════════════════════════════
//  세션 & 메시지
// ═══════════════════════════════════════

const stmts = {
  // 세션
  insertSession: db.prepare(`INSERT OR IGNORE INTO sessions (session_id, started_at) VALUES (?, datetime('now','+9 hours'))`),
  updateSession: db.prepare(`
    UPDATE sessions SET
      last_message_at = datetime('now','+9 hours'),
      message_count = message_count + 1,
      user_msg_count = CASE WHEN ? = 'user' THEN user_msg_count + 1 ELSE user_msg_count END,
      bot_msg_count = CASE WHEN ? = 'bot' THEN bot_msg_count + 1 ELSE bot_msg_count END,
      first_user_msg = CASE WHEN first_user_msg IS NULL AND ? = 'user' THEN ? ELSE first_user_msg END,
      primary_category = CASE WHEN ? != 'general' THEN ? ELSE primary_category END,
      status = 'active'
    WHERE session_id = ?
  `),
  updateSessionQuality: db.prepare(`
    UPDATE sessions SET
      avg_quality = COALESCE((SELECT AVG(quality_score) FROM messages WHERE session_id = ? AND role = 'bot' AND quality_score > 0), 0),
      avg_response_ms = COALESCE((SELECT AVG(response_ms) FROM messages WHERE session_id = ? AND role = 'bot' AND response_ms > 0), 0),
      total_tokens_in = COALESCE((SELECT SUM(tokens_in) FROM messages WHERE session_id = ?), 0),
      total_tokens_out = COALESCE((SELECT SUM(tokens_out) FROM messages WHERE session_id = ?), 0),
      has_unresolved = COALESCE((SELECT COUNT(*) > 0 FROM messages WHERE session_id = ? AND role = 'bot' AND quality_score < 50), 0)
    WHERE session_id = ?
  `),
  setSessionStatus: db.prepare(`UPDATE sessions SET status = ? WHERE session_id = ?`),

  // 메시지
  insertMessage: db.prepare(`
    INSERT INTO messages (id, session_id, role, content, category, source, response_ms, tokens_in, tokens_out, quality_score, model)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `),
  updateFeedback: db.prepare(`UPDATE messages SET feedback = ? WHERE id = ?`),
  updateSessionFeedback: db.prepare(`
    UPDATE sessions SET
      feedback_good = (SELECT COUNT(*) FROM messages WHERE session_id = ? AND feedback = 'good'),
      feedback_bad = (SELECT COUNT(*) FROM messages WHERE session_id = ? AND feedback = 'bad')
    WHERE session_id = ?
  `),
};

// ─── 메시지 저장 ───
function saveMessage(sessionId, msg) {
  const msgId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const role = msg.role || 'user';
  const content = msg.content || '';
  const category = msg.category || 'general';
  const source = msg.source || null;
  const responseMs = msg.responseTimeMs || 0;
  const tokensIn = msg.tokensUsed?.input || 0;
  const tokensOut = msg.tokensUsed?.output || 0;
  const quality = (role === 'bot') ? (msg.qualityScore || 70) : 0;
  const model = msg.model || null;

  db.transaction(() => {
    stmts.insertSession.run(sessionId);
    stmts.insertMessage.run(msgId, sessionId, role, content, category, source, responseMs, tokensIn, tokensOut, quality, model);
    // updateSession: role, role, role, contentSlice, category, category, sessionId
    stmts.updateSession.run(role, role, role, content.slice(0, 80), category, category, sessionId);
    if (role === 'bot') {
      // updateSessionQuality: sid x6
      stmts.updateSessionQuality.run(sessionId, sessionId, sessionId, sessionId, sessionId, sessionId);
    }
  })();

  return msgId;
}

// ─── 피드백 저장 ───
function saveFeedback(messageId, feedback) {
  stmts.updateFeedback.run(feedback, messageId);
  const msg = db.prepare('SELECT session_id FROM messages WHERE id = ?').get(messageId);
  if (msg) stmts.updateSessionFeedback.run(msg.session_id, msg.session_id, msg.session_id);
  return !!msg;
}

// ═══════════════════════════════════════
//  조회 API
// ═══════════════════════════════════════

function getSessions({ page = 1, limit = 20, search, category, status, dateFrom, dateTo, sort = 'latest' } = {}) {
  let where = ['1=1'];
  const params = [];

  if (search) { where.push("(first_user_msg LIKE '%' || ? || '%' OR session_id LIKE '%' || ? || '%')"); params.push(search, search); }
  if (category) { where.push('primary_category = ?'); params.push(category); }
  if (status === 'unresolved') { where.push('has_unresolved = 1'); }
  else if (status) { where.push('status = ?'); params.push(status); }
  if (dateFrom) { where.push("date(started_at) >= ?"); params.push(dateFrom); }
  if (dateTo) { where.push("date(started_at) <= ?"); params.push(dateTo); }

  const orderBy = sort === 'oldest' ? 'started_at ASC' : sort === 'messages' ? 'message_count DESC' : 'started_at DESC';
  const whereClause = where.join(' AND ');

  const total = db.prepare(`SELECT COUNT(*) as c FROM sessions WHERE ${whereClause}`).get(...params).c;
  const offset = (page - 1) * limit;
  const sessions = db.prepare(`SELECT * FROM sessions WHERE ${whereClause} ORDER BY ${orderBy} LIMIT ? OFFSET ?`).all(...params, limit, offset);

  return { sessions, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
}

function getSession(sessionId) {
  const session = db.prepare('SELECT * FROM sessions WHERE session_id = ?').get(sessionId);
  if (!session) return null;
  const messages = db.prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY timestamp ASC').all(sessionId);

  // 카테고리 집계
  const categories = {};
  messages.forEach(m => { categories[m.category] = (categories[m.category] || 0) + 1; });

  return {
    ...session,
    messages: messages.map(m => ({
      id: m.id,
      timestamp: m.timestamp,
      role: m.role,
      content: m.content,
      metadata: {
        category: m.category,
        responseTimeMs: m.response_ms,
        tokensUsed: { input: m.tokens_in, output: m.tokens_out },
        source: m.source,
        qualityScore: m.quality_score,
        feedback: m.feedback
      }
    })),
    stats: {
      totalMessages: messages.length,
      avgResponseTimeMs: session.avg_response_ms || 0,
      avgQuality: Math.round(session.avg_quality || 0),
      categories
    }
  };
}

function deleteSession(sessionId) {
  const result = db.prepare('DELETE FROM sessions WHERE session_id = ?').run(sessionId);
  return result.changes > 0;
}

// ═══════════════════════════════════════
//  통계
// ═══════════════════════════════════════

function getStats() {
  const today = toKSTDate();

  const overview = db.prepare(`
    SELECT
      COUNT(*) as totalSessions,
      SUM(CASE WHEN date(started_at) = ? THEN 1 ELSE 0 END) as todaySessions,
      SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as activeSessions,
      SUM(CASE WHEN has_unresolved = 1 THEN 1 ELSE 0 END) as unresolvedCount,
      COALESCE(SUM(message_count),0) as totalMessages,
      ROUND(COALESCE(AVG(avg_response_ms),0)) as avgResponseTimeMs,
      ROUND(COALESCE(AVG(avg_quality),0)) as avgQuality,
      COALESCE(SUM(feedback_good),0) as totalFeedbackGood,
      COALESCE(SUM(feedback_bad),0) as totalFeedbackBad
    FROM sessions
  `).get(today);

  const categoryDist = {};
  db.prepare('SELECT primary_category, COUNT(*) as c FROM sessions GROUP BY primary_category').all()
    .forEach(r => { categoryDist[r.primary_category] = r.c; });

  const sourceDist = {};
  db.prepare("SELECT source, COUNT(*) as c FROM messages WHERE role='bot' AND source IS NOT NULL GROUP BY source").all()
    .forEach(r => { sourceDist[r.source] = r.c; });

  const todayHourly = db.prepare(`
    SELECT CAST(strftime('%H', timestamp) AS INTEGER) as hour, COUNT(*) as count
    FROM messages WHERE date(timestamp) = ? AND role = 'user'
    GROUP BY hour ORDER BY hour
  `).all(today);

  return { overview, categoryDistribution: categoryDist, sourceDistribution: sourceDist, todayHourly };
}

function getDailyStats(from, to) {
  const dateFrom = from || (() => { const d = new Date(Date.now() + 9*3600000); d.setDate(d.getDate()-30); return d.toISOString().slice(0,10); })();
  const dateTo = to || toKSTDate();

  const daily = db.prepare(`
    SELECT date(started_at) as date, COUNT(*) as sessions, SUM(message_count) as messages,
      ROUND(AVG(avg_quality)) as avgQuality
    FROM sessions
    WHERE date(started_at) BETWEEN ? AND ?
    GROUP BY date(started_at) ORDER BY date
  `).all(dateFrom, dateTo);

  return { daily };
}

// ═══════════════════════════════════════
//  미해결 & 품질
// ═══════════════════════════════════════

function getUnresolved({ page = 1, limit = 20 } = {}) {
  const total = db.prepare("SELECT COUNT(*) as c FROM messages WHERE role='bot' AND quality_score < 50").get().c;
  const offset = (page - 1) * limit;
  const items = db.prepare(`
    SELECT m.id, m.session_id, m.timestamp, m.content as botResponse, m.quality_score, m.category,
      (SELECT content FROM messages WHERE session_id = m.session_id AND role = 'user' AND timestamp < m.timestamp ORDER BY timestamp DESC LIMIT 1) as userMessage
    FROM messages m
    WHERE m.role = 'bot' AND m.quality_score < 50
    ORDER BY m.timestamp DESC LIMIT ? OFFSET ?
  `).all(limit, offset);

  return { items, total };
}

function getPopularQuestions(limit = 10) {
  const questions = db.prepare(`
    SELECT first_user_msg as question, COUNT(*) as count, primary_category as category
    FROM sessions WHERE first_user_msg IS NOT NULL
    GROUP BY first_user_msg ORDER BY count DESC LIMIT ?
  `).all(limit);
  return { questions };
}

function getQualityTrend(days = 14) {
  const trend = db.prepare(`
    SELECT date(timestamp) as date,
      ROUND(AVG(quality_score)) as avgQuality,
      COUNT(*) as totalResponses,
      SUM(CASE WHEN quality_score >= 80 THEN 1 ELSE 0 END) as goodCount,
      SUM(CASE WHEN quality_score < 50 THEN 1 ELSE 0 END) as badCount,
      SUM(CASE WHEN source = 'faq_direct' THEN 1 ELSE 0 END) as faqCount,
      SUM(CASE WHEN source LIKE 'cache%' THEN 1 ELSE 0 END) as cacheCount,
      SUM(CASE WHEN source = 'rag' THEN 1 ELSE 0 END) as ragCount
    FROM messages WHERE role = 'bot' AND date(timestamp) >= date('now', '-' || ? || ' days')
    GROUP BY date(timestamp) ORDER BY date
  `).all(days);
  return { trend };
}

// ═══════════════════════════════════════
//  키워드
// ═══════════════════════════════════════

function trackKeyword(word, category) {
  db.prepare(`
    INSERT INTO keywords (word, count, category, last_seen)
    VALUES (?, 1, ?, datetime('now','+9 hours'))
    ON CONFLICT(word) DO UPDATE SET count = count + 1, last_seen = datetime('now','+9 hours')
  `).run(word, category);
}

function getKeywordStats({ sort = 'count', limit = 50, category } = {}) {
  let query = 'SELECT * FROM keywords';
  const params = [];
  if (category) { query += ' WHERE category = ?'; params.push(category); }
  query += sort === 'recent' ? ' ORDER BY last_seen DESC' : ' ORDER BY count DESC';
  query += ' LIMIT ?';
  params.push(limit);

  const keywords = db.prepare(query).all(...params);
  const totalSearches = db.prepare('SELECT COALESCE(SUM(count),0) as c FROM keywords').get().c;
  return { keywords, total: keywords.length, totalSearches };
}

// ═══════════════════════════════════════
//  응답 캐시
// ═══════════════════════════════════════

function getCachedResponse(queryKey) {
  // 1. 정확 매칭
  const exact = db.prepare(`
    SELECT * FROM response_cache WHERE query_key = ? AND created_at > datetime('now','+9 hours', '-7 days')
  `).get(queryKey);

  if (exact) {
    db.prepare("UPDATE response_cache SET hit_count = hit_count + 1, last_hit_at = datetime('now','+9 hours') WHERE query_key = ?").run(queryKey);
    return { reply: exact.reply, category: exact.category, source: 'cache_exact' };
  }

  // 2. 키워드 포함 매칭 (queryKey의 핵심 단어가 캐시 키에 포함)
  const words = queryKey.split(' ').filter(w => w.length >= 2);
  if (words.length >= 2) {
    const rows = db.prepare(`SELECT * FROM response_cache WHERE created_at > datetime('now','+9 hours', '-7 days')`).all();
    for (const row of rows) {
      const matchCount = words.filter(w => row.query_key.includes(w)).length;
      if (matchCount >= 2 && matchCount / words.length >= 0.6) {
        db.prepare("UPDATE response_cache SET hit_count = hit_count + 1, last_hit_at = datetime('now','+9 hours') WHERE query_key = ?").run(row.query_key);
        return { reply: row.reply, category: row.category, source: 'cache_similar' };
      }
    }
  }

  return null;
}

function setCachedResponse(queryKey, reply, category) {
  db.prepare(`
    INSERT OR REPLACE INTO response_cache (query_key, reply, category, created_at)
    VALUES (?, ?, ?, datetime('now','+9 hours'))
  `).run(queryKey, reply, category);
}

function invalidateCache(queryKey) {
  db.prepare('DELETE FROM response_cache WHERE query_key = ?').run(queryKey);
}

function getCacheStats() {
  const stats = db.prepare(`
    SELECT COUNT(*) as cacheSize, COALESCE(SUM(hit_count),0) as totalHits FROM response_cache
    WHERE created_at > datetime('now', '-7 days')
  `).get();
  return { ...stats, maxCache: 500, cacheTtlHours: 24 };
}

// ═══════════════════════════════════════
//  미해결 큐 (관리자)
// ═══════════════════════════════════════

function addUnresolvedItem(sessionId, messageId, userQuestion, botResponse, category) {
  // 같은 질문 있으면 occurrence 증가
  const existing = db.prepare("SELECT id FROM unresolved_queue WHERE user_question = ? AND status = 'pending'").get(userQuestion);
  if (existing) {
    db.prepare('UPDATE unresolved_queue SET occurrence = occurrence + 1 WHERE id = ?').run(existing.id);
    return existing.id;
  }
  return db.prepare(`
    INSERT INTO unresolved_queue (session_id, message_id, user_question, bot_response, category)
    VALUES (?, ?, ?, ?, ?)
  `).run(sessionId, messageId, userQuestion, botResponse, category).lastInsertRowid;
}

function getUnresolvedQueue({ page = 1, limit = 20, status = 'pending' } = {}) {
  const total = db.prepare('SELECT COUNT(*) as c FROM unresolved_queue WHERE status = ?').get(status).c;
  const offset = (page - 1) * limit;
  const items = db.prepare('SELECT * FROM unresolved_queue WHERE status = ? ORDER BY occurrence DESC, created_at DESC LIMIT ? OFFSET ?')
    .all(status, limit, offset);
  return { items, total };
}

function resolveUnresolvedItem(id, adminAnswer, action) {
  db.prepare('UPDATE unresolved_queue SET status = ?, admin_answer = ?, resolved_at = datetime(\'now\') WHERE id = ?')
    .run(action || 'resolved', adminAnswer, id);
}

// ═══════════════════════════════════════
//  내보내기
// ═══════════════════════════════════════

function exportSessions({ format = 'json', from, to, category } = {}) {
  let where = ['1=1'];
  const params = {};
  if (from) { where.push("date(s.started_at) >= $from"); params.$from = from; }
  if (to) { where.push("date(s.started_at) <= $to"); params.$to = to; }
  if (category) { where.push("s.primary_category = $cat"); params.$cat = category; }

  const rows = db.prepare(`
    SELECT s.session_id, m.timestamp, m.role, m.content, m.category, m.source, m.response_ms, m.quality_score, m.feedback
    FROM sessions s JOIN messages m ON s.session_id = m.session_id
    WHERE ${where.join(' AND ')} ORDER BY s.started_at, m.timestamp
  `).all(params);

  if (format === 'csv') {
    const header = 'session_id,timestamp,role,content,category,source,response_ms,quality_score,feedback';
    const lines = rows.map(r => `"${r.session_id}","${r.timestamp}","${r.role}","${r.content.replace(/"/g, '""').replace(/\n/g, ' ')}","${r.category}","${r.source || ''}","${r.response_ms}","${r.quality_score}","${r.feedback || ''}"`);
    return { data: header + '\n' + lines.join('\n'), contentType: 'text/csv', filename: `export_${toKSTDate()}.csv` };
  }
  return { data: JSON.stringify(rows, null, 2), contentType: 'application/json', filename: `export_${toKSTDate()}.json` };
}

// ─── 응답 수정 (관리자 즉시 조치) ───
function correctResponse(messageId, correctedReply) {
  // 1. 봇 메시지 내용 수정 + 품질 100으로
  db.prepare('UPDATE messages SET content = ?, quality_score = 100, source = ? WHERE id = ?')
    .run(correctedReply, 'admin_corrected', messageId);

  // 2. 원본 사용자 질문 찾기
  const botMsg = db.prepare('SELECT session_id, timestamp FROM messages WHERE id = ?').get(messageId);
  if (!botMsg) return null;

  const userMsg = db.prepare(
    "SELECT content, category FROM messages WHERE session_id = ? AND role = 'user' AND timestamp < ? ORDER BY timestamp DESC LIMIT 1"
  ).get(botMsg.session_id, botMsg.timestamp);

  if (!userMsg) return null;

  // 3. 캐시에 수정된 답변 저장 (즉시 반영)
  const queryKey = userMsg.content.replace(/[?？！!~.,\s]+/g, ' ').trim().toLowerCase().replace(/\s+/g, ' ');
  setCachedResponse(queryKey, correctedReply, userMsg.category || 'general');

  // 4. 세션 품질 재계산
  const sid = botMsg.session_id;
  db.prepare(`UPDATE sessions SET avg_quality = COALESCE((SELECT AVG(quality_score) FROM messages WHERE session_id = ? AND role = 'bot' AND quality_score > 0), 0) WHERE session_id = ?`)
    .run(sid, sid);

  return { messageId, userQuestion: userMsg.content, queryKey };
}

// 사용자 질문으로 캐시 직접 등록 (관리자가 답변 작성)
function setAdminResponse(userQuestion, adminReply, category) {
  const queryKey = userQuestion.replace(/[?？！!~.,\s]+/g, ' ').trim().toLowerCase().replace(/\s+/g, ' ');
  setCachedResponse(queryKey, adminReply, category || 'general');
  return { queryKey };
}

module.exports = {
  saveMessage, saveFeedback,
  getSessions, getSession, deleteSession,
  getStats, getDailyStats, getUnresolved, getPopularQuestions, getQualityTrend,
  trackKeyword, getKeywordStats,
  getCachedResponse, setCachedResponse, invalidateCache, getCacheStats,
  addUnresolvedItem, getUnresolvedQueue, resolveUnresolvedItem,
  correctResponse, setAdminResponse,
  exportSessions
};
