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
  if (category) {
    return faqData.filter(f => f.category === category);
  }
  return faqData;
}

function searchFaqs(query) {
  const lower = query.toLowerCase();
  return faqData.filter(f =>
    f.question.toLowerCase().includes(lower) ||
    f.keywords.some(k => lower.includes(k))
  );
}

function getProducts(network, sort) {
  let results = [...productsData];
  if (network) {
    results = results.filter(p => p.network.toLowerCase() === network.toLowerCase());
  }
  if (sort === 'price') {
    results.sort((a, b) => a.monthlyFee - b.monthlyFee);
  } else if (sort === 'data') {
    results.sort((a, b) => parseInt(b.data) - parseInt(a.data));
  }
  return results;
}

function getTerms() {
  return termsData;
}

function getGuide() {
  return guideData;
}

function buildContext(message) {
  const lower = message.toLowerCase();
  let context = '';

  // 항상 포함: 고객센터 정보
  context += `\n[고객센터 정보]\n${JSON.stringify(guideData.customerService, null, 2)}\n`;

  // 요금제 관련
  if (['요금', '상품', '가격', '얼마', '추천', '비교', '데이터', '통화', '문자', '무제한', '프로모션', '제휴'].some(k => lower.includes(k))) {
    context += `\n[요금제 목록]\n${JSON.stringify(productsData, null, 2)}\n`;
  }

  // 개통 관련
  if (['개통', '가입', '신규', '번호이동', '준비', '시간', '유심', '인증', '절차', '방법'].some(k => lower.includes(k))) {
    context += `\n[셀프개통 가이드]\n${JSON.stringify(guideData.selfActivation, null, 2)}\n`;
  }

  // 약관 관련
  if (['약관', '해지', '계약', '환불', '의무', '개인정보', '조건'].some(k => lower.includes(k))) {
    context += `\n[이용약관 요약]\n${JSON.stringify(termsData, null, 2)}\n`;
  }

  // FAQ 검색
  const matchedFaqs = searchFaqs(message);
  if (matchedFaqs.length > 0) {
    context += `\n[관련 FAQ]\n${JSON.stringify(matchedFaqs, null, 2)}\n`;
  }

  // 컨텍스트가 거의 없으면 전체 FAQ 포함
  if (context.length < 200) {
    context += `\n[전체 FAQ]\n${JSON.stringify(faqData, null, 2)}\n`;
  }

  return context;
}

loadData();

module.exports = { getFaqs, searchFaqs, getProducts, getTerms, getGuide, buildContext, loadData };
