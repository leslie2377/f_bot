const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'f_bot.db');

const db = new Database(DB_PATH, { verbose: null });

// WAL 모드 (성능 + 동시 읽기)
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ─── 테이블 생성 ───
db.exec(`
  -- 세션 테이블
  CREATE TABLE IF NOT EXISTS sessions (
    session_id    TEXT PRIMARY KEY,
    started_at    TEXT NOT NULL DEFAULT (datetime('now')),
    last_message_at TEXT,
    message_count   INTEGER DEFAULT 0,
    user_msg_count  INTEGER DEFAULT 0,
    bot_msg_count   INTEGER DEFAULT 0,
    primary_category TEXT DEFAULT 'general',
    status          TEXT DEFAULT 'active' CHECK(status IN ('active','completed','unresolved')),
    has_unresolved  INTEGER DEFAULT 0,
    first_user_msg  TEXT,
    avg_response_ms INTEGER DEFAULT 0,
    avg_quality     REAL DEFAULT 0,
    total_tokens_in  INTEGER DEFAULT 0,
    total_tokens_out INTEGER DEFAULT 0,
    feedback_good   INTEGER DEFAULT 0,
    feedback_bad    INTEGER DEFAULT 0
  );

  -- 메시지 테이블
  CREATE TABLE IF NOT EXISTS messages (
    id            TEXT PRIMARY KEY,
    session_id    TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
    timestamp     TEXT NOT NULL DEFAULT (datetime('now')),
    role          TEXT NOT NULL CHECK(role IN ('user','bot')),
    content       TEXT NOT NULL,
    category      TEXT DEFAULT 'general',
    source        TEXT,
    response_ms   INTEGER DEFAULT 0,
    tokens_in     INTEGER DEFAULT 0,
    tokens_out    INTEGER DEFAULT 0,
    quality_score INTEGER DEFAULT 70,
    feedback      TEXT CHECK(feedback IN ('good','bad',NULL)),
    model         TEXT
  );

  -- 키워드 통계 테이블
  CREATE TABLE IF NOT EXISTS keywords (
    word          TEXT PRIMARY KEY,
    count         INTEGER DEFAULT 1,
    category      TEXT DEFAULT 'general',
    last_seen     TEXT DEFAULT (datetime('now'))
  );

  -- 응답 캐시 테이블
  CREATE TABLE IF NOT EXISTS response_cache (
    query_key     TEXT PRIMARY KEY,
    reply         TEXT NOT NULL,
    category      TEXT,
    hit_count     INTEGER DEFAULT 0,
    created_at    TEXT DEFAULT (datetime('now')),
    last_hit_at   TEXT
  );

  -- 품질 일별 집계 테이블
  CREATE TABLE IF NOT EXISTS daily_quality (
    date          TEXT NOT NULL,
    total_sessions INTEGER DEFAULT 0,
    total_messages INTEGER DEFAULT 0,
    avg_quality    REAL DEFAULT 0,
    response_rate  REAL DEFAULT 0,
    feedback_good  INTEGER DEFAULT 0,
    feedback_bad   INTEGER DEFAULT 0,
    source_faq     INTEGER DEFAULT 0,
    source_cache   INTEGER DEFAULT 0,
    source_rag     INTEGER DEFAULT 0,
    unresolved     INTEGER DEFAULT 0,
    PRIMARY KEY (date)
  );

  -- 미해결 큐 (관리자 검토용)
  CREATE TABLE IF NOT EXISTS unresolved_queue (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id    TEXT,
    message_id    TEXT,
    user_question TEXT NOT NULL,
    bot_response  TEXT,
    category      TEXT,
    occurrence    INTEGER DEFAULT 1,
    status        TEXT DEFAULT 'pending' CHECK(status IN ('pending','reviewed','resolved','faq_added')),
    admin_answer  TEXT,
    created_at    TEXT DEFAULT (datetime('now')),
    resolved_at   TEXT
  );

  -- 인덱스
  CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
  CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
  CREATE INDEX IF NOT EXISTS idx_messages_role ON messages(role);
  CREATE INDEX IF NOT EXISTS idx_messages_category ON messages(category);
  CREATE INDEX IF NOT EXISTS idx_messages_feedback ON messages(feedback);
  CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
  CREATE INDEX IF NOT EXISTS idx_sessions_started ON sessions(started_at);
  CREATE INDEX IF NOT EXISTS idx_keywords_count ON keywords(count DESC);
  CREATE INDEX IF NOT EXISTS idx_unresolved_status ON unresolved_queue(status);
`);

console.log('DB 초기화 완료:', DB_PATH);

module.exports = db;
