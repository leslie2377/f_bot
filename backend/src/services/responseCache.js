const fs = require('fs');
const path = require('path');

const CACHE_PATH = path.join(__dirname, '..', 'data', 'response_cache.json');
const KEYWORDS_PATH = path.join(__dirname, '..', 'data', 'keyword_stats.json');

// ─── 응답 캐시 ───
let cache = {};       // { normalizedKey: { reply, category, hitCount, createdAt, lastHitAt } }
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24시간
const MAX_CACHE = 500;

// ─── 키워드 통계 ───
let keywordStats = {}; // { keyword: { count, lastSeen, category } }

function init() {
  if (fs.existsSync(CACHE_PATH)) {
    try { cache = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf-8')); } catch { cache = {}; }
  }
  if (fs.existsSync(KEYWORDS_PATH)) {
    try { keywordStats = JSON.parse(fs.readFileSync(KEYWORDS_PATH, 'utf-8')); } catch { keywordStats = {}; }
  }
}

function save() {
  fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));
  fs.writeFileSync(KEYWORDS_PATH, JSON.stringify(keywordStats, null, 2));
}

// 질문 정규화: 공백/특수문자 제거, 소문자, 핵심 키워드만 추출
function normalizeQuery(message) {
  return message
    .replace(/[?？！!~.,\s]+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

// 유사도 체크 (간단한 키워드 겹침 비율)
function similarity(a, b) {
  const wordsA = new Set(a.split(' ').filter(w => w.length > 1));
  const wordsB = new Set(b.split(' ').filter(w => w.length > 1));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  let overlap = 0;
  wordsA.forEach(w => { if (wordsB.has(w)) overlap++; });
  return overlap / Math.max(wordsA.size, wordsB.size);
}

// ─── 캐시 조회 ───
function getCachedResponse(message) {
  const normalized = normalizeQuery(message);
  const now = Date.now();

  // 1. 정확 매칭
  if (cache[normalized] && now - cache[normalized].createdAt < CACHE_TTL) {
    cache[normalized].hitCount++;
    cache[normalized].lastHitAt = new Date().toISOString();
    save();
    return { ...cache[normalized], source: 'cache_exact' };
  }

  // 2. 유사 매칭 (80% 이상)
  for (const [key, entry] of Object.entries(cache)) {
    if (now - entry.createdAt > CACHE_TTL) continue;
    if (similarity(normalized, key) >= 0.8) {
      entry.hitCount++;
      entry.lastHitAt = new Date().toISOString();
      save();
      return { ...entry, source: 'cache_similar' };
    }
  }

  return null;
}

// ─── 캐시 저장 ───
function setCachedResponse(message, reply, category) {
  const normalized = normalizeQuery(message);

  // 너무 짧은 질문(인사 등)은 캐시하지 않음
  if (normalized.length < 4) return;

  cache[normalized] = {
    reply,
    category,
    hitCount: 0,
    createdAt: Date.now(),
    lastHitAt: null
  };

  // 캐시 크기 제한
  const keys = Object.keys(cache);
  if (keys.length > MAX_CACHE) {
    // hitCount 가장 낮은 것부터 삭제
    const sorted = keys.sort((a, b) => cache[a].hitCount - cache[b].hitCount);
    for (let i = 0; i < keys.length - MAX_CACHE; i++) {
      delete cache[sorted[i]];
    }
  }

  save();
}

// ─── 키워드 추출 및 통계 ───
const STOP_WORDS = new Set([
  '이', '그', '저', '것', '수', '등', '를', '을', '에', '의', '가', '은', '는',
  '좀', '해', '주세요', '알려', '뭐', '어떻게', '얼마', '있나요', '되나요', '인가요',
  '하나요', '싶어요', '해요', '줘', '줘요', '요', '가요', '나요', '해주세요'
]);

const KEYWORD_MAP = {
  // 개통 관련
  '개통': 'opening', '셀프개통': 'opening', '가입': 'opening', '신규': 'opening',
  '번호이동': 'opening', '유심': 'opening', 'esim': 'opening', '이심': 'opening',
  '안면인증': 'opening', '본인인증': 'opening', '인증': 'opening',
  '준비물': 'opening', '절차': 'opening', '방법': 'opening', '시간': 'opening',
  // 요금제 관련
  '요금제': 'product', '요금': 'product', '가격': 'product', '상품': 'product',
  '추천': 'product', '비교': 'product', '데이터': 'product', '통화': 'product',
  '문자': 'product', '무제한': 'product', '프로모션': 'product', '할인': 'product',
  '제휴': 'product', '하나은행': 'product', 'skt': 'product', 'kt': 'product', 'lgu': 'product',
  // 약관 관련
  '약관': 'terms', '해지': 'terms', '계약': 'terms', '환불': 'terms',
  '위약금': 'terms', '개인정보': 'terms',
  // 고객센터
  '고객센터': 'cs', '전화번호': 'cs', '연락처': 'cs', '상담': 'cs', '문의': 'cs',
  // 결제
  '납부': 'payment', '결제': 'payment', '자동이체': 'payment', '청구': 'payment',
  // 장애
  '오류': 'trouble', '안됨': 'trouble', '안돼': 'trouble', '인식': 'trouble', '장애': 'trouble'
};

function extractKeywords(message) {
  const lower = message.toLowerCase().replace(/[?？！!~.,]/g, '');
  const words = lower.split(/\s+/).filter(w => w.length > 1 && !STOP_WORDS.has(w));

  const keywords = [];
  // 매핑된 키워드 우선 추출
  for (const [keyword, cat] of Object.entries(KEYWORD_MAP)) {
    if (lower.includes(keyword)) {
      keywords.push({ word: keyword, category: cat });
    }
  }
  // 매핑에 없는 단어도 2글자 이상이면 일반 키워드로
  words.forEach(w => {
    if (!keywords.some(k => k.word === w) && !STOP_WORDS.has(w)) {
      keywords.push({ word: w, category: 'general' });
    }
  });

  return keywords;
}

function trackKeywords(message, category) {
  const keywords = extractKeywords(message);
  const now = new Date().toISOString();

  keywords.forEach(({ word, category: kwCat }) => {
    if (!keywordStats[word]) {
      keywordStats[word] = { count: 0, lastSeen: null, category: kwCat || category };
    }
    keywordStats[word].count++;
    keywordStats[word].lastSeen = now;
  });

  save();
  return keywords.map(k => k.word);
}

// ─── 키워드 통계 조회 (관리자용) ───
function getKeywordStats({ sort = 'count', limit = 50, category } = {}) {
  let entries = Object.entries(keywordStats).map(([word, data]) => ({
    word, ...data
  }));

  if (category) entries = entries.filter(e => e.category === category);

  if (sort === 'count') entries.sort((a, b) => b.count - a.count);
  else if (sort === 'recent') entries.sort((a, b) => (b.lastSeen || '').localeCompare(a.lastSeen || ''));

  return {
    keywords: entries.slice(0, limit),
    total: entries.length,
    totalSearches: entries.reduce((sum, e) => sum + e.count, 0)
  };
}

function getCacheStats() {
  const entries = Object.values(cache);
  const totalHits = entries.reduce((sum, e) => sum + e.hitCount, 0);
  return {
    cacheSize: entries.length,
    totalHits,
    maxCache: MAX_CACHE,
    cacheTtlHours: CACHE_TTL / (60 * 60 * 1000)
  };
}

init();

module.exports = {
  getCachedResponse, setCachedResponse,
  trackKeywords, extractKeywords,
  getKeywordStats, getCacheStats
};
