// 한국 시간대(KST, UTC+9) 유틸리티

function nowKST() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000);
}

function toKSTString() {
  const d = nowKST();
  return d.toISOString().replace('Z', '+09:00');
}

function toKSTDate() {
  const d = nowKST();
  return d.toISOString().slice(0, 10);
}

function toKSTDateTime() {
  const d = nowKST();
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

// SQLite용: datetime('now', '+9 hours') 대체
const KST_NOW = "datetime('now', '+9 hours')";

module.exports = { nowKST, toKSTString, toKSTDate, toKSTDateTime, KST_NOW };
