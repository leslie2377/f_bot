const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'data');

let faqData = [];
let productsData = [];
let termsData = [];
let guideData = {};

function loadData() {
  faqData = JSON.parse(fs.readFileSync(path.join(dataDir, 'faq.json'), 'utf-8'));
  productsData = JSON.parse(fs.readFileSync(path.join(dataDir, 'products.json'), 'utf-8'));
  termsData = JSON.parse(fs.readFileSync(path.join(dataDir, 'terms.json'), 'utf-8'));
  guideData = JSON.parse(fs.readFileSync(path.join(dataDir, 'guide.json'), 'utf-8'));
}

function getFaqs(category) {
  if (category) return faqData.filter(f => f.category === category);
  return faqData;
}

function searchFaqs(query) {
  const lower = query.toLowerCase();
  return faqData.filter(f =>
    f.question.toLowerCase().includes(lower) ||
    f.keywords.some(k => lower.includes(k))
  );
}

// FAQ 정확 매칭: AI 호출 없이 직접 응답 가능한지 판단
// "추천", "비교" 등 AI 판단이 필요한 질문은 제외
const AI_REQUIRED_KEYWORDS = ['추천', '비교', '어떤게 좋', '골라', '뭐가 나', '어디가', '차이'];

function findExactFaqMatch(message) {
  const lower = message.toLowerCase();

  // AI 판단이 필요한 질문은 FAQ 매칭 스킵
  if (AI_REQUIRED_KEYWORDS.some(k => lower.includes(k))) return null;

  let bestMatch = null;
  let bestScore = 0;

  for (const faq of faqData) {
    let score = 0;
    // 키워드 매칭 (2글자 이상만)
    faq.keywords.forEach(k => { if (k.length >= 2 && lower.includes(k)) score += 2; });
    // 질문 텍스트 유사도 (3글자 이상 단어만)
    const qWords = faq.question.replace(/[?？]/g, '').split(/\s+/);
    qWords.forEach(w => { if (w.length >= 3 && lower.includes(w.toLowerCase())) score += 1; });

    if (score > bestScore && score >= 4) {
      bestScore = score;
      bestMatch = faq;
    }
  }

  return bestMatch;
}

function getProducts(network, sort) {
  let results = [...productsData];
  if (network) results = results.filter(p => p.network.toLowerCase() === network.toLowerCase());
  if (sort === 'price') results.sort((a, b) => a.monthlyFee - b.monthlyFee);
  else if (sort === 'data') results.sort((a, b) => parseInt(b.data) - parseInt(a.data));
  return results;
}

function getTerms() { return termsData; }
function getGuide() { return guideData; }

// ─── 토큰 최소화된 컨텍스트 빌더 ───
function buildContext(message) {
  const lower = message.toLowerCase();
  let context = '';

  // 고객센터: 전화번호만 간결하게 (JSON 전체 대신)
  context += '[고객센터] SKT:1661-2207 / KT:1577-4551 / U+:1588-3615 / 114(무료) / 운영:평일09~18시\n';

  // 요금제: 필요한 필드만 추출 (detailUrl, features 등 제외)
  if (['요금', '상품', '가격', '얼마', '추천', '비교', '데이터', '통화', '문자', '무제한', '프로모션', '제휴'].some(k => lower.includes(k))) {
    const compact = productsData.map(p =>
      `${p.name}(${p.network}) ${p.monthlyFee}원 ${p.data}/${p.voice}/${p.sms}${p.promo ? ' [프로모션]' : ''}${p.partner ? ` [${p.partner}]` : ''} 상세:${p.detailUrl}`
    ).join('\n');
    context += `[요금제]\n${compact}\n`;
  }

  // 개통: steps만 간결하게
  if (['개통', '가입', '신규', '번호이동', '준비', '시간', '유심', '인증', '절차', '방법', 'esim', '이심'].some(k => lower.includes(k))) {
    const steps = guideData.selfActivation.steps.map(s =>
      `${s.step}. ${s.title}: ${s.description}${s.note ? ` (※${s.note})` : ''}`
    ).join('\n');
    const hours = guideData.selfActivation.hours;
    const restrictions = guideData.selfActivation.restrictions;
    context += `[셀프개통 절차]\n${steps}\n`;
    context += `[개통시간] 신규:${hours.newActivation} / 번호이동:${hours.numberTransfer} / ${hours.closed}\n`;
    context += `[제한] ${restrictions.maxLines} / ${restrictions.newLineLimit} / 번호이동:${restrictions.numberTransfer}\n`;
  }

  // eSIM 관련
  if (['esim', '이심', 'e심', '듀얼심', '프로파일', 'qr'].some(k => lower.includes(k))) {
    if (guideData.esim) {
      const e = guideData.esim;
      context += `[eSIM] 지원확인:${e.checkMethod} / 발급비:${e.profileFee}원 / 설치:${e.installMethods.join(',')} / 개통:${e.openUrl}\n`;
      context += `[eSIM 주의] ${e.notes.join(' / ')}\n`;
    }
  }

  // 선불 관련
  if (['선불', '충전', '잔액', '선불카드'].some(k => lower.includes(k))) {
    if (guideData.prepaid) {
      const p = guideData.prepaid;
      context += `[선불] 충전:${p.chargeMethod} / 최소:${p.minCharge}원 / 잔액확인:${p.balanceCheck}\n`;
    }
  }

  // 부가서비스/셀프서비스
  if (['부가서비스', '서비스', '자동납부', '청구서', '번호변경'].some(k => lower.includes(k))) {
    if (guideData.selfServices) {
      context += `[셀프서비스] ${guideData.selfServices.join(', ')}\n`;
    }
  }

  // 약관: summary만
  if (['약관', '해지', '계약', '환불', '의무', '개인정보', '조건'].some(k => lower.includes(k))) {
    const compact = termsData.map(t => `${t.title}: ${t.summary}`).join('\n');
    context += `[약관]\n${compact}\n`;
  }

  // FAQ: 관련된 것만 (answer만, question 제외)
  const matchedFaqs = searchFaqs(message);
  if (matchedFaqs.length > 0) {
    const compact = matchedFaqs.slice(0, 3).map(f => `Q:${f.question}\nA:${f.answer}`).join('\n\n');
    context += `[FAQ]\n${compact}\n`;
  }

  return context;
}

loadData();

module.exports = { getFaqs, searchFaqs, findExactFaqMatch, getProducts, getTerms, getGuide, buildContext, loadData };
