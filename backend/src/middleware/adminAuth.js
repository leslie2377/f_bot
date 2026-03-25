const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'f_bot_default_secret_2026';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin1234';

// 브루트포스 방지
const loginAttempts = new Map();
const MAX_ATTEMPTS = 5;
const LOCK_DURATION = 60 * 1000; // 1분

function login(req, res) {
  const { password } = req.body;
  const ip = req.ip;

  // 잠금 체크
  const attempt = loginAttempts.get(ip);
  if (attempt && attempt.count >= MAX_ATTEMPTS && Date.now() - attempt.lastTry < LOCK_DURATION) {
    const remaining = Math.ceil((LOCK_DURATION - (Date.now() - attempt.lastTry)) / 1000);
    return res.status(429).json({ error: `너무 많은 시도. ${remaining}초 후 다시 시도해주세요.` });
  }

  if (password !== ADMIN_PASSWORD) {
    // 실패 카운트 증가
    if (!loginAttempts.has(ip)) loginAttempts.set(ip, { count: 0, lastTry: 0 });
    const a = loginAttempts.get(ip);
    a.count++;
    a.lastTry = Date.now();
    return res.status(401).json({ error: '인증 실패' });
  }

  // 성공 → 카운트 초기화
  loginAttempts.delete(ip);

  const token = jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: '24h' });
  res.json({ token, expiresIn: '24h' });
}

function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: '인증 토큰이 필요합니다.' });
  }

  const token = authHeader.slice(7);
  try {
    jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: '유효하지 않거나 만료된 토큰입니다.' });
  }
}

module.exports = { login, authenticate };
