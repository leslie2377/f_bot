const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');
const { Document } = require('@langchain/core/documents');
const { RecursiveCharacterTextSplitter } = require('@langchain/textsplitters');
const { FaissStore } = require('@langchain/community/vectorstores/faiss');
const { LocalKoreanEmbeddings } = require('./localEmbeddings');

const DATA_DIR = path.join(__dirname, '..', 'data');
const VECTOR_DIR = path.join(DATA_DIR, 'vectorstore');
const PDF_DIR = path.join(DATA_DIR, 'pdf');

const embeddings = new LocalKoreanEmbeddings();

// ─── PDF 로더 ───
async function loadPDFs() {
  const docs = [];
  if (!fs.existsSync(PDF_DIR)) return docs;

  const files = fs.readdirSync(PDF_DIR).filter(f => f.endsWith('.pdf'));
  for (const file of files) {
    try {
      const buffer = fs.readFileSync(path.join(PDF_DIR, file));
      const data = await pdfParse(buffer);
      docs.push(new Document({
        pageContent: data.text,
        metadata: { source: file, type: 'terms', pages: data.numpages }
      }));
      console.log(`  PDF 로드: ${file} (${data.numpages}페이지, ${data.text.length}자)`);
    } catch (err) {
      console.error(`  PDF 로드 실패: ${file} - ${err.message}`);
    }
  }
  return docs;
}

// ─── FAQ 로더 ───
function loadFAQs() {
  const faqPath = path.join(DATA_DIR, 'faq.json');
  const faqs = JSON.parse(fs.readFileSync(faqPath, 'utf-8'));

  return faqs.map(faq => new Document({
    pageContent: `질문: ${faq.question}\n답변: ${faq.answer}`,
    metadata: {
      source: 'faq',
      type: 'faq',
      id: faq.id,
      category: faq.category,
      keywords: faq.keywords.join(',')
    }
  }));
}

// ─── 요금제 로더 ───
function loadProducts() {
  const prodPath = path.join(DATA_DIR, 'products.json');
  const products = JSON.parse(fs.readFileSync(prodPath, 'utf-8'));

  return products.map(p => {
    const fee = p.monthlyFee;
    const priceTag = fee <= 5000 ? '저가 초저가 가성비' : fee <= 15000 ? '중저가 가성비' : fee <= 30000 ? '중가' : fee <= 50000 ? '중고가' : '고가 프리미엄';
    const dataNum = parseInt(p.data) || 0;
    const dataTag = (p.data || '').includes('무제한') ? '무제한 데이터무제한' : dataNum >= 100 ? '대용량 100GB이상' : dataNum >= 20 ? '대용량' : dataNum >= 10 ? '중용량' : '소용량';
    const voiceTag = (p.voice || '').includes('무제한') || (p.voice || '').includes('기본제공') ? '무제한통화' : '';
    const features = (p.features || []).join(' ');
    // 브랜드명 추출 및 강화 (CGV, 다이소, 하나은행 등)
    const name = p.name || '';
    const brandMatches = name.match(/(CGV|다이소|올리브영|하나은행|신한카드|CU|NH|밀리의서재|예스24|멜론|SEEZN|글로벌)/gi) || [];
    const brandTag = brandMatches.length > 0 ? brandMatches.map(b => `${b} ${b} 제휴 ${b}요금제`).join(' ') : '';

    return new Document({
      pageContent: [
        `프리티 요금제: ${p.name}`,
        `통신망: ${p.network} 알뜰폰 요금제`,
        `월요금: ${p.monthlyFee.toLocaleString()}원${p.originalFee ? ` (정가: ${p.originalFee.toLocaleString()}원, 할인)` : ''}`,
        `데이터: ${p.data} ${dataTag}`,
        `통화: ${p.voice} ${voiceTag}`,
        `문자: ${p.sms}`,
        `가격대: ${priceTag}`,
        p.promo ? `프로모션 할인 요금제 (${p.promoEndDate || '진행중'})` : '정가 요금제',
        p.partner ? `제휴: ${p.partner} 제휴 요금제 제휴혜택 ${p.partner}요금제` : '',
        brandTag ? `브랜드: ${brandTag}` : '',
        features ? `특징: ${features}` : '',
        (p.categories && p.categories.length > 0) ? `카테고리: ${p.categories.join(', ')} ${p.categories.join(' ')}` : '',
        p.genCd === '5G' ? '5G 요금제 5세대' : 'LTE 요금제 4G',
        p.esimYn === 'Y' ? 'eSIM 가능 이심' : '',
        p.selfYn === 'Y' ? '셀프개통 가능' : '',
        `상세보기: ${p.detailUrl}`,
        `개통신청: ${p.openUrl}`,
      ].filter(Boolean).join('\n'),
      metadata: {
        source: 'product',
        type: 'product',
        id: p.id,
        name: p.name,
        network: p.network,
        monthlyFee: p.monthlyFee,
        data: p.data,
        voice: p.voice,
        sms: p.sms,
        detailUrl: p.detailUrl || '',
        svcCd: p.svcCd || '',
        categories: (p.categories || []).join(','),
        genCd: p.genCd || 'LTE'
      }
    });
  });
}

// ─── 개통 가이드 로더 ───
function loadGuide() {
  const guidePath = path.join(DATA_DIR, 'guide.json');
  const guide = JSON.parse(fs.readFileSync(guidePath, 'utf-8'));
  const docs = [];

  // 셀프개통 절차
  const stepsText = guide.selfActivation.steps.map(s =>
    `${s.step}단계 ${s.title}: ${s.description}${s.note ? ` (※ ${s.note})` : ''}`
  ).join('\n');
  docs.push(new Document({
    pageContent: `프리티 셀프개통 절차\n${stepsText}\n\n개통시간:\n신규가입: ${guide.selfActivation.hours.newActivation}\n번호이동: ${guide.selfActivation.hours.numberTransfer}\n${guide.selfActivation.hours.closed}`,
    metadata: { source: 'guide', type: 'guide', section: 'selfActivation' }
  }));

  // 가입 제한
  const rest = guide.selfActivation.restrictions;
  docs.push(new Document({
    pageContent: `가입 제한 조건\n${Object.entries(rest).map(([k, v]) => `${k}: ${v}`).join('\n')}`,
    metadata: { source: 'guide', type: 'guide', section: 'restrictions' }
  }));

  // 트러블슈팅
  guide.selfActivation.troubleshooting.forEach(t => {
    docs.push(new Document({
      pageContent: `문제: ${t.problem}\n해결방법:\n${t.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}`,
      metadata: { source: 'guide', type: 'guide', section: 'troubleshooting' }
    }));
  });

  // 고객센터
  const cs = guide.customerService;
  docs.push(new Document({
    pageContent: `고객센터 연락처\nSKT: ${cs.skt.number} (이메일: ${cs.email?.skt || ''})\nKT: ${cs.kt.number} (이메일: ${cs.email?.kt || ''})\nU+: ${cs.lgu.number} (이메일: ${cs.email?.lgu || ''})\n민원: ${cs.complaint.number}\n무료: ${cs.free.number}\n운영시간: ${cs.hours}\n1:1문의: ${cs.inquiry}`,
    metadata: { source: 'guide', type: 'guide', section: 'customerService' }
  }));

  // eSIM
  if (guide.esim) {
    const e = guide.esim;
    docs.push(new Document({
      pageContent: `eSIM 개통 안내\n지원 확인: ${e.checkMethod}\n프로파일 발급비: ${e.profileFee}원\n설치 방법: ${e.installMethods.join(', ')}\n주의사항: ${e.notes.join(' / ')}\n개통 URL: ${e.openUrl}\n가이드: ${e.guideUrl}`,
      metadata: { source: 'guide', type: 'guide', section: 'esim' }
    }));
  }

  // 선불
  if (guide.prepaid) {
    const p = guide.prepaid;
    docs.push(new Document({
      pageContent: `선불 서비스\n충전: ${p.chargeMethod}\n최소 충전: ${p.minCharge}원\n잔액 확인: ${p.balanceCheck}`,
      metadata: { source: 'guide', type: 'guide', section: 'prepaid' }
    }));
  }

  return docs;
}

// ─── 약관 요약 로더 ───
function loadTerms() {
  const termsPath = path.join(DATA_DIR, 'terms.json');
  const terms = JSON.parse(fs.readFileSync(termsPath, 'utf-8'));

  return terms.map(t => new Document({
    pageContent: `약관 - ${t.title}\n요약: ${t.summary}\n상세: ${t.details}`,
    metadata: { source: 'terms', type: 'terms', id: t.id, section: t.section }
  }));
}

// ─── 메인 인제스션 ───
async function ingestAll() {
  console.log('=== 프리티 RAG 인제스션 시작 ===\n');

  // 1. 모든 데이터 로드
  console.log('[1/5] FAQ 로드...');
  const faqDocs = loadFAQs();
  console.log(`  ${faqDocs.length}개 FAQ`);

  console.log('[2/5] 요금제 로드...');
  const productDocs = loadProducts();
  console.log(`  ${productDocs.length}개 요금제`);

  console.log('[3/5] 개통 가이드 로드...');
  const guideDocs = loadGuide();
  console.log(`  ${guideDocs.length}개 가이드 문서`);

  console.log('[4/5] 약관 로드...');
  const termsDocs = loadTerms();
  console.log(`  ${termsDocs.length}개 약관`);

  console.log('[5/5] PDF 로드...');
  const pdfDocs = await loadPDFs();
  console.log(`  ${pdfDocs.length}개 PDF`);

  // 2. 모든 문서 결합
  const allDocs = [...faqDocs, ...productDocs, ...guideDocs, ...termsDocs, ...pdfDocs];
  console.log(`\n총 ${allDocs.length}개 문서`);

  // 3. 텍스트 분할 (PDF는 긴 문서이므로 청크 분할 필요)
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 500,
    chunkOverlap: 50,
    separators: ['\n\n', '\n', '다.', '요.', '. ', ' ']
  });

  const splitDocs = [];
  for (const doc of allDocs) {
    if (doc.pageContent.length > 600) {
      const chunks = await splitter.splitDocuments([doc]);
      splitDocs.push(...chunks);
    } else {
      splitDocs.push(doc);
    }
  }
  console.log(`청크 분할 후: ${splitDocs.length}개 문서\n`);

  // 4. FAISS 벡터 스토어 생성
  console.log('벡터 스토어 생성 중...');
  if (!fs.existsSync(VECTOR_DIR)) fs.mkdirSync(VECTOR_DIR, { recursive: true });

  const vectorStore = await FaissStore.fromDocuments(splitDocs, embeddings);
  await vectorStore.save(VECTOR_DIR);

  const stats = {
    totalDocuments: splitDocs.length,
    faq: faqDocs.length,
    products: productDocs.length,
    guide: guideDocs.length,
    terms: termsDocs.length,
    pdf: pdfDocs.length,
    vectorDir: VECTOR_DIR,
    createdAt: new Date().toISOString()
  };

  fs.writeFileSync(path.join(VECTOR_DIR, 'stats.json'), JSON.stringify(stats, null, 2));

  console.log('\n=== 인제스션 완료 ===');
  console.log(JSON.stringify(stats, null, 2));
  return stats;
}

// ─── 벡터 스토어 로드 ───
async function loadVectorStore() {
  if (!fs.existsSync(path.join(VECTOR_DIR, 'faiss.index'))) {
    console.log('벡터 스토어 없음, 인제스션 실행...');
    await ingestAll();
  }
  return await FaissStore.load(VECTOR_DIR, embeddings);
}

// ─── 수동 추가 이력 ───
const MANUAL_PATH = path.join(DATA_DIR, 'manual_docs.json');

function loadManualDocs() {
  if (fs.existsSync(MANUAL_PATH)) {
    try { return JSON.parse(fs.readFileSync(MANUAL_PATH, 'utf-8')); } catch { return []; }
  }
  return [];
}

function saveManualDoc(doc) {
  const list = loadManualDocs();
  list.push(doc);
  fs.writeFileSync(MANUAL_PATH, JSON.stringify(list, null, 2));
}

function getManualDocs({ page = 1, limit = 20, type } = {}) {
  let list = loadManualDocs();
  if (type) list = list.filter(d => d.type === type);
  list.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  const total = list.length;
  const start = (page - 1) * limit;
  return { items: list.slice(start, start + limit), total };
}

function deleteManualDoc(id) {
  let list = loadManualDocs();
  const before = list.length;
  list = list.filter(d => d.id !== id);
  if (list.length === before) return false;
  fs.writeFileSync(MANUAL_PATH, JSON.stringify(list, null, 2));
  return true;
}

// ─── 개별 문서 추가 (관리자용) ───
async function addDocuments(docs) {
  const store = await loadVectorStore();
  await store.addDocuments(docs);
  await store.save(VECTOR_DIR);

  // stats.json 업데이트
  const statsPath = path.join(VECTOR_DIR, 'stats.json');
  let stats = {};
  if (fs.existsSync(statsPath)) {
    stats = JSON.parse(fs.readFileSync(statsPath, 'utf-8'));
  }
  stats.totalDocuments = (stats.totalDocuments || 0) + docs.length;
  docs.forEach(d => {
    const type = d.metadata?.type || 'manual';
    const key = type === 'product' ? 'products' : type;
    stats[key] = (stats[key] || 0) + 1;
  });
  stats.lastUpdated = new Date().toISOString();
  fs.writeFileSync(statsPath, JSON.stringify(stats, null, 2));

  return { added: docs.length, stats };
}

// ─── JSON 원본에 반영 ───
function addToSourceJson(type, content) {
  const id = `manual_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const now = new Date().toISOString();

  if (type === 'faq') {
    const faqPath = path.join(DATA_DIR, 'faq.json');
    const faqs = JSON.parse(fs.readFileSync(faqPath, 'utf-8'));
    // "질문: ... 답변: ..." 형식 파싱
    const qMatch = content.match(/질문[:\s]*(.+?)(?:\n|답변)/s);
    const aMatch = content.match(/답변[:\s]*(.+)/s);
    const newFaq = {
      id: `faq_${faqs.length + 1}`.padStart(7, '0'),
      category: 'manual',
      question: qMatch ? qMatch[1].trim() : content.slice(0, 50),
      answer: aMatch ? aMatch[1].trim() : content,
      keywords: content.split(/\s+/).filter(w => w.length >= 2).slice(0, 5)
    };
    faqs.push(newFaq);
    fs.writeFileSync(faqPath, JSON.stringify(faqs, null, 2));
    return { ...newFaq, sourceId: newFaq.id };
  }

  if (type === 'product') {
    const prodPath = path.join(DATA_DIR, 'products.json');
    const products = JSON.parse(fs.readFileSync(prodPath, 'utf-8'));
    const newProd = {
      id: `plan_manual_${products.length + 1}`,
      name: content.match(/요금제[:\s]*(.+?)(?:\n|$)/)?.[1]?.trim() || '수동 추가 요금제',
      network: content.match(/통신망[:\s]*(.+?)(?:\n|$)/)?.[1]?.trim() || '',
      monthlyFee: parseInt(content.match(/월요금[:\s]*(\d+)/)?.[1]) || 0,
      originalFee: null, data: '', voice: '', sms: '',
      promo: false, promoEndDate: null, partner: null,
      features: ['수동추가'], svcCd: '', detailUrl: '', openUrl: ''
    };
    products.push(newProd);
    fs.writeFileSync(prodPath, JSON.stringify(products, null, 2));
    return { ...newProd, sourceId: newProd.id };
  }

  if (type === 'terms') {
    const termsPath = path.join(DATA_DIR, 'terms.json');
    const terms = JSON.parse(fs.readFileSync(termsPath, 'utf-8'));
    const newTerm = {
      id: `term_manual_${terms.length + 1}`,
      section: '수동추가',
      title: content.split('\n')[0].slice(0, 50),
      summary: content.slice(0, 200),
      details: content
    };
    terms.push(newTerm);
    fs.writeFileSync(termsPath, JSON.stringify(terms, null, 2));
    return { ...newTerm, sourceId: newTerm.id };
  }

  return { sourceId: id };
}

// CLI 실행 지원
if (require.main === module) {
  ingestAll().catch(console.error);
}

module.exports = {
  ingestAll, loadVectorStore, addDocuments,
  loadFAQs, loadProducts, loadGuide, loadTerms,
  addToSourceJson, saveManualDoc, getManualDocs, deleteManualDoc, loadManualDocs
};
