const fs = require('fs');
const path = require('path');

const CONV_DIR = path.join(__dirname, '..', 'data', 'conversations');
const SESSIONS_DIR = path.join(CONV_DIR, 'sessions');
const INDEX_PATH = path.join(CONV_DIR, 'index.json');

// 메모리 캐시
let index = { sessions: [], stats: { totalSessions: 0, totalMessages: 0, lastUpdated: null } };
// 세션별 쓰기 버퍼 (디바운스용)
const writeBuffers = new Map();
const FLUSH_DELAY = 500;

function init() {
  if (!fs.existsSync(SESSIONS_DIR)) fs.mkdirSync(SESSIONS_DIR, { recursive: true });
  if (fs.existsSync(INDEX_PATH)) {
    try { index = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf-8')); } catch { /* 초기화 */ }
  }
  saveIndex();
}

function saveIndex() {
  index.stats.lastUpdated = new Date().toISOString();
  fs.writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2));
}

function getDateFolder() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getSessionPath(sessionId) {
  const entry = index.sessions.find(s => s.sessionId === sessionId);
  const dateFolder = entry ? entry.date : getDateFolder();
  const dirPath = path.join(SESSIONS_DIR, dateFolder);
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
  return path.join(dirPath, `${sessionId}.json`);
}

function loadSessionFile(sessionId) {
  const filePath = getSessionPath(sessionId);
  if (fs.existsSync(filePath)) {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  }
  return null;
}

function flushSession(sessionId) {
  const buffer = writeBuffers.get(sessionId);
  if (!buffer) return;
  clearTimeout(buffer.timer);

  const filePath = getSessionPath(sessionId);
  fs.writeFileSync(filePath, JSON.stringify(buffer.data, null, 2));
  writeBuffers.delete(sessionId);
}

function scheduleFlush(sessionId) {
  const buffer = writeBuffers.get(sessionId);
  if (!buffer) return;
  clearTimeout(buffer.timer);
  buffer.timer = setTimeout(() => flushSession(sessionId), FLUSH_DELAY);
}

// 미해결 판정
function isUnresolved(botContent) {
  const unresolvedPatterns = [
    '답변을 드리기 어렵습니다',
    '답변이 어렵습니다',
    '정확한 답변을 드리기',
    '일시적인 오류가 발생'
  ];
  return unresolvedPatterns.some(p => botContent.includes(p));
}

// ─── 저장 API ───

function saveMessage(sessionId, msg) {
  const now = new Date().toISOString();
  const msgId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

  // 세션 파일 로드 또는 생성
  let buffer = writeBuffers.get(sessionId);
  if (!buffer) {
    let data = loadSessionFile(sessionId);
    if (!data) {
      data = { sessionId, startedAt: now, messages: [] };
      // 인덱스에 새 세션 추가
      index.sessions.unshift({
        sessionId,
        date: getDateFolder(),
        startedAt: now,
        lastMessageAt: now,
        messageCount: 0,
        userMessageCount: 0,
        botMessageCount: 0,
        categories: [],
        primaryCategory: 'general',
        status: 'active',
        hasUnresolved: false,
        firstUserMessage: '',
        avgResponseTimeMs: 0,
        totalTokens: { input: 0, output: 0 }
      });
      index.stats.totalSessions++;
    }
    buffer = { data, timer: null };
    writeBuffers.set(sessionId, buffer);
  }

  // 메시지 추가
  const message = {
    id: msgId,
    timestamp: now,
    role: msg.role,
    content: msg.content,
    metadata: { category: msg.category || 'general' }
  };

  if (msg.role === 'bot') {
    message.metadata.responseTimeMs = msg.responseTimeMs || 0;
    message.metadata.tokensUsed = msg.tokensUsed || { input: 0, output: 0 };
    message.metadata.model = msg.model || 'claude-haiku-4-5';
  }

  buffer.data.messages.push(message);

  // 인덱스 갱신
  const entry = index.sessions.find(s => s.sessionId === sessionId);
  if (entry) {
    entry.lastMessageAt = now;
    entry.messageCount++;
    index.stats.totalMessages++;

    if (msg.role === 'user') {
      entry.userMessageCount++;
      if (!entry.firstUserMessage) entry.firstUserMessage = msg.content.slice(0, 80);
    } else {
      entry.botMessageCount++;
      if (msg.tokensUsed) {
        entry.totalTokens.input += msg.tokensUsed.input || 0;
        entry.totalTokens.output += msg.tokensUsed.output || 0;
      }
      if (msg.responseTimeMs) {
        const botMsgs = buffer.data.messages.filter(m => m.role === 'bot');
        const totalTime = botMsgs.reduce((sum, m) => sum + (m.metadata.responseTimeMs || 0), 0);
        entry.avgResponseTimeMs = Math.round(totalTime / botMsgs.length);
      }
      if (isUnresolved(msg.content)) entry.hasUnresolved = true;
    }

    // 카테고리 갱신
    if (msg.category && msg.category !== 'general' && !entry.categories.includes(msg.category)) {
      entry.categories.push(msg.category);
    }
    // 가장 많은 카테고리를 primary로
    const catCounts = {};
    buffer.data.messages.forEach(m => {
      const c = m.metadata.category;
      if (c && c !== 'general') catCounts[c] = (catCounts[c] || 0) + 1;
    });
    const sorted = Object.entries(catCounts).sort((a, b) => b[1] - a[1]);
    if (sorted.length > 0) entry.primaryCategory = sorted[0][0];

    entry.status = 'active';
  }

  saveIndex();
  scheduleFlush(sessionId);
}

function markSessionCompleted(sessionId) {
  const entry = index.sessions.find(s => s.sessionId === sessionId);
  if (entry) {
    entry.status = 'completed';
    saveIndex();
  }
  flushSession(sessionId);
}

// ─── 조회 API ───

function getSessions({ page = 1, limit = 20, search, category, dateFrom, dateTo, status, sort = 'latest' } = {}) {
  let results = [...index.sessions];

  // 필터링
  if (search) {
    const lower = search.toLowerCase();
    results = results.filter(s => s.firstUserMessage.toLowerCase().includes(lower) || s.sessionId.includes(lower));
  }
  if (category) results = results.filter(s => s.primaryCategory === category || s.categories.includes(category));
  if (dateFrom) results = results.filter(s => s.date >= dateFrom);
  if (dateTo) results = results.filter(s => s.date <= dateTo);
  if (status === 'unresolved') results = results.filter(s => s.hasUnresolved);
  else if (status) results = results.filter(s => s.status === status);

  // 정렬
  if (sort === 'latest') results.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  else if (sort === 'oldest') results.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  else if (sort === 'messages') results.sort((a, b) => b.messageCount - a.messageCount);

  const total = results.length;
  const totalPages = Math.ceil(total / limit);
  const start = (page - 1) * limit;
  const sessions = results.slice(start, start + limit);

  return { sessions, pagination: { page, limit, total, totalPages } };
}

function getSession(sessionId) {
  const data = loadSessionFile(sessionId);
  // 버퍼에 있으면 버퍼 우선
  const buffer = writeBuffers.get(sessionId);
  const sessionData = buffer ? buffer.data : data;
  if (!sessionData) return null;

  const entry = index.sessions.find(s => s.sessionId === sessionId);
  const botMsgs = sessionData.messages.filter(m => m.role === 'bot');
  const catCounts = {};
  sessionData.messages.forEach(m => {
    const c = m.metadata.category;
    if (c) catCounts[c] = (catCounts[c] || 0) + 1;
  });

  return {
    ...sessionData,
    stats: {
      totalMessages: sessionData.messages.length,
      avgResponseTimeMs: entry ? entry.avgResponseTimeMs : 0,
      categories: catCounts
    }
  };
}

function getStats() {
  const today = getDateFolder();
  const todaySessions = index.sessions.filter(s => s.date === today);
  const activeSessions = index.sessions.filter(s => s.status === 'active');
  const unresolvedSessions = index.sessions.filter(s => s.hasUnresolved);

  // 카테고리 분포
  const categoryDist = {};
  index.sessions.forEach(s => {
    const cat = s.primaryCategory || 'general';
    categoryDist[cat] = (categoryDist[cat] || 0) + 1;
  });

  // 오늘 시간대별
  const todayHourly = [];
  for (let h = 0; h < 24; h++) {
    const count = todaySessions.filter(s => {
      const hour = new Date(s.startedAt).getHours();
      return hour === h;
    }).length;
    if (count > 0) todayHourly.push({ hour: h, count });
  }

  const allAvgTime = index.sessions.length > 0
    ? Math.round(index.sessions.reduce((sum, s) => sum + s.avgResponseTimeMs, 0) / index.sessions.length)
    : 0;

  return {
    overview: {
      totalSessions: index.stats.totalSessions,
      todaySessions: todaySessions.length,
      activeSessions: activeSessions.length,
      unresolvedCount: unresolvedSessions.length,
      totalMessages: index.stats.totalMessages,
      avgResponseTimeMs: allAvgTime
    },
    categoryDistribution: categoryDist,
    todayHourly
  };
}

function getDailyStats(from, to) {
  const dateFrom = from || (() => { const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().slice(0, 10); })();
  const dateTo = to || getDateFolder();

  const dailyMap = {};
  index.sessions
    .filter(s => s.date >= dateFrom && s.date <= dateTo)
    .forEach(s => {
      if (!dailyMap[s.date]) dailyMap[s.date] = { date: s.date, sessions: 0, messages: 0 };
      dailyMap[s.date].sessions++;
      dailyMap[s.date].messages += s.messageCount;
    });

  return { daily: Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date)) };
}

function getUnresolved({ page = 1, limit = 20 } = {}) {
  const items = [];
  const unresolvedSessions = index.sessions.filter(s => s.hasUnresolved);

  for (const entry of unresolvedSessions) {
    const data = loadSessionFile(entry.sessionId) || (writeBuffers.get(entry.sessionId) || {}).data;
    if (!data) continue;

    for (let i = 0; i < data.messages.length; i++) {
      const msg = data.messages[i];
      if (msg.role === 'bot' && isUnresolved(msg.content)) {
        const userMsg = i > 0 ? data.messages[i - 1] : null;
        items.push({
          sessionId: entry.sessionId,
          timestamp: msg.timestamp,
          userMessage: userMsg ? userMsg.content : '(없음)',
          botResponse: msg.content.slice(0, 200),
          category: msg.metadata.category
        });
      }
    }
  }

  const total = items.length;
  const start = (page - 1) * limit;
  return { items: items.slice(start, start + limit), total };
}

function getPopularQuestions(limit = 10) {
  const questionCounts = {};
  for (const entry of index.sessions) {
    if (entry.firstUserMessage) {
      const q = entry.firstUserMessage.trim();
      if (!questionCounts[q]) questionCounts[q] = { question: q, count: 0, category: entry.primaryCategory };
      questionCounts[q].count++;
    }
  }
  const sorted = Object.values(questionCounts).sort((a, b) => b.count - a.count);
  return { questions: sorted.slice(0, limit) };
}

function deleteSession(sessionId) {
  const entry = index.sessions.find(s => s.sessionId === sessionId);
  if (!entry) return false;

  // 파일 삭제
  const filePath = getSessionPath(sessionId);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

  // 인덱스에서 제거
  index.sessions = index.sessions.filter(s => s.sessionId !== sessionId);
  index.stats.totalSessions = index.sessions.length;
  index.stats.totalMessages = index.sessions.reduce((sum, s) => sum + s.messageCount, 0);
  saveIndex();

  // 버퍼 제거
  if (writeBuffers.has(sessionId)) {
    clearTimeout(writeBuffers.get(sessionId).timer);
    writeBuffers.delete(sessionId);
  }
  return true;
}

function exportSessions({ format = 'json', from, to, category } = {}) {
  let sessions = [...index.sessions];
  if (from) sessions = sessions.filter(s => s.date >= from);
  if (to) sessions = sessions.filter(s => s.date <= to);
  if (category) sessions = sessions.filter(s => s.primaryCategory === category || s.categories.includes(category));

  const fullData = sessions.map(entry => {
    const data = loadSessionFile(entry.sessionId);
    return data || { sessionId: entry.sessionId, messages: [] };
  });

  if (format === 'csv') {
    const rows = ['sessionId,timestamp,role,content,category,responseTimeMs'];
    fullData.forEach(session => {
      session.messages.forEach(msg => {
        const content = msg.content.replace(/"/g, '""').replace(/\n/g, ' ');
        rows.push(`"${session.sessionId}","${msg.timestamp}","${msg.role}","${content}","${msg.metadata.category || ''}","${msg.metadata.responseTimeMs || ''}"`);
      });
    });
    return { data: rows.join('\n'), contentType: 'text/csv', filename: `export_${getDateFolder()}.csv` };
  }

  return { data: JSON.stringify(fullData, null, 2), contentType: 'application/json', filename: `export_${getDateFolder()}.json` };
}

init();

module.exports = {
  saveMessage, markSessionCompleted,
  getSessions, getSession, getStats, getDailyStats,
  getUnresolved, getPopularQuestions,
  deleteSession, exportSessions
};
