const { ChatAnthropic } = require('@langchain/anthropic');
const { PromptTemplate } = require('@langchain/core/prompts');
const { StringOutputParser } = require('@langchain/core/output_parsers');
const { RunnableSequence } = require('@langchain/core/runnables');
const { loadVectorStore } = require('./ingest');

let vectorStore = null;
let chain = null;

const SYSTEM_TEMPLATE = `당신은 프리텔레콤(프리티) 셀프개통 전문 상담 AI입니다. 존댓말을 사용하고 친절하게 안내합니다.

규칙:
- 아래 [참고 자료]만 기반으로 답변하세요. 자료에 없으면 "정확한 답변을 드리기 어렵습니다"라고 하고 고객센터를 안내하세요.
- 요금제 안내 시 반드시 상세 링크를 포함하세요: "👉 [상세보기](URL)" + "📱 [바로 개통](https://www.freet.co.kr/self/usimOpen)"

요금제 안내 규칙:
- **판매가(볼드)**가 현재 가입 시 월 납부 금액입니다.
- 할인 요금제는 "N개월 후 월 XX,XXX원"을 함께 안내하세요.
- 통화 "기본제공" = 약 300분 이하 (무제한 아님). "기본제공(약 300분 이하)"로 안내하세요.
- 문자 "기본제공" = 약 300건 이하 (무제한 아님). "기본제공(약 300건 이하)"로 안내하세요.
- 추천 시 반드시 **5개 요금제**를 가로 테이블로 안내하세요.

요금제 결과 표시 규칙 (매우 중요):
- 요금제를 안내할 때 반드시 가로 정렬 마크다운 테이블로 표시하세요.
- 항목을 첫 번째 열에, 각 요금제를 오른쪽 열에 배치합니다.
- 예시 (요금제 3개일 때):
| 항목 | 요금제1 | 요금제2 | 요금제3 |
|------|---------|---------|---------|
| 요금제명 | 이름A | 이름B | 이름C |
| 통신망 | SKT | KT | LGU+ |
| **판매가** | **월 X,XXX원** | **월 X,XXX원** | **월 X,XXX원** |
| 할인후 | N개월후 XX,XXX원 | - | N개월후 XX,XXX원 |
| 데이터 | 10GB | 15GB | 20GB |
| 통화 | 300분 | 기본제공 | 무제한 |
| 문자 | 100건 | 기본제공 | 기본제공 |
| 상세 | [보기](URL) | [보기](URL) | [보기](URL) |
- 테이블 아래에 📱 [바로 개통](https://www.freet.co.kr/self/usimOpen) 링크 포함
- 1개 요금제도 같은 형식으로 표시하세요

후불/선불 규칙:
- "요금제 보기", "저렴한 요금제", "요금제 알려줘" 등 일반 요금제 질문 시 → 반드시 **후불 요금제**를 안내하세요.
- 선불 요금제는 고객이 명확히 "선불"이라고 말했을 때만 안내하세요.
- "선불"이라는 단어가 포함된 요금제(프리티 선불 LTE 등)는 선불 질문이 아닌 이상 제외하세요.

요금제 추천 대화 규칙:
- 고객이 "추천", "추천해줘", "어떤 요금제" 등으로 질문하면 먼저 사용 패턴을 질문하세요.
- 아래 3가지를 물어보세요:
  1. "📞 한 달 통화량이 어느 정도인가요? (예: 거의 안함 / 100분 이하 / 300분 이상 / 무제한)"
  2. "📊 데이터는 한 달에 얼마나 사용하시나요? (예: 5GB 이하 / 10GB / 20GB 이상 / 무제한)"
  3. "💰 희망 월 예산은 어느 정도인가요? (예: 1만원 이하 / 2만원대 / 3만원 이상)"
- 고객이 사용량을 알려주면 조건에 맞는 **후불 요금제 5개**를 가로 테이블로 추천하세요.
- 이미 대화 히스토리에 사용량 정보가 있으면 다시 묻지 말고 바로 5개 추천하세요.
- 5개가 부족하면 가능한 만큼 추천하세요.

고객센터 안내 규칙:
- 전화번호는 반드시 클릭 통화 가능한 링크로 표시하세요:
  - SKT: [1661-2207](tel:1661-2207)
  - KT: [1577-4551](tel:1577-4551)
  - U+: [1588-3615](tel:1588-3615)
  - 무료: [114](tel:114)

- 개통 절차는 단계별 번호를 매겨 안내하세요.
- 약관은 쉬운 말로 요약하세요.
- 간결하되 필요한 정보는 빠짐없이 전달하세요.

[참고 자료]
{context}

[대화 히스토리]
{history}

[고객 질문]
{question}`;

const prompt = PromptTemplate.fromTemplate(SYSTEM_TEMPLATE);

// ─── 질문 유형별 검색 전략 ───
const PRODUCT_KEYWORDS = ['요금제','요금','가격','추천','비교','얼마','데이터','통화','문자','무제한','할인','프로모션','제휴',
  'cgv','다이소','올리브영','하나은행','신한카드','cu','nh','밀리','멜론','예스24',
  'skt','kt','lgu','lg','5g','lte','선불','후불','가성비','저렴','싼',
  '5gb','7gb','10gb','15gb','20gb','30gb','50gb','100gb'];
const GUIDE_KEYWORDS = ['개통','가입','유심','esim','이심','준비','절차','방법','시간','번호이동','인증'];
const TERMS_KEYWORDS = ['약관','해지','계약','환불','위약금','의무','개인정보'];

function detectQueryType(question) {
  const lower = question.toLowerCase();
  if (PRODUCT_KEYWORDS.some(k => lower.includes(k))) return 'product';
  if (GUIDE_KEYWORDS.some(k => lower.includes(k))) return 'guide';
  if (TERMS_KEYWORDS.some(k => lower.includes(k))) return 'terms';
  return 'general';
}

// ─── 스마트 검색: 유형별 필터 + 일반 검색 혼합 ───
// "추천요금제" → 이달의 추천 카테고리 매핑
const RECOMMEND_KEYWORDS = ['추천요금', '추천 요금', '이달의 추천', '이달 추천', '추천해', '추천좀', '뭐가 좋', '어떤게 좋'];

// ─── 사용량 조건 파싱 ───
function parseUsageConditions(text) {
  const lower = text.toLowerCase();
  const cond = {};

  // 데이터 파싱
  const dataMatch = lower.match(/(\d+)\s*(?:gb|기가)/);
  if (dataMatch) cond.dataGB = parseInt(dataMatch[1]);
  if (lower.includes('데이터 무제한') || lower.includes('무제한 데이터')) cond.dataGB = 999;
  if (lower.includes('데이터 적') || lower.includes('거의 안') || lower.includes('5gb 이하') || lower.includes('5기가 이하')) cond.dataGB = cond.dataGB || 5;

  // 통화 파싱
  const voiceMatch = lower.match(/(\d+)\s*분/);
  if (voiceMatch) cond.voiceMin = parseInt(voiceMatch[1]);
  if (lower.includes('통화 무제한') || lower.includes('무제한 통화')) cond.voiceMin = 9999;
  if (lower.includes('통화 거의') || lower.includes('통화 안') || lower.includes('100분 이하')) cond.voiceMin = cond.voiceMin || 100;

  // 예산 파싱
  const priceMatch = lower.match(/(\d+)\s*(?:만원|만|원)/);
  if (priceMatch) {
    let price = parseInt(priceMatch[1]);
    if (lower.includes('만원') || lower.includes('만')) price *= 10000;
    else if (price < 1000) price *= 10000; // "2만" → 20000
    cond.maxPrice = price;
  }

  // 통신망
  if (lower.includes('skt') || lower.includes('에스케이')) cond.network = 'SKT';
  if (lower.includes('kt') || lower.includes('케이티')) cond.network = 'KT';
  if (lower.includes('lg') || lower.includes('유플러스')) cond.network = 'LGU+';

  return Object.keys(cond).length > 0 ? cond : null;
}

// ─── 조건 기반 요금제 필터링 + 저렴한 순 정렬 ───
function filterProductDocs(docs, cond) {
  if (!cond) return docs;

  const filtered = docs.filter(d => {
    if (d.metadata.type !== 'product') return true;

    const fee = d.metadata.monthlyFee || 0;
    const dataStr = (d.metadata.data || '').toLowerCase();
    const voiceStr = (d.metadata.voice || '').toLowerCase();
    const network = d.metadata.network || '';

    // 통신망 필터 (정확 매칭)
    if (cond.network && network !== cond.network) return false;

    // 데이터: 요청량 이상이면 OK (더 넉넉한 요금제도 포함)
    if (cond.dataGB && cond.dataGB < 999) {
      const dataNum = parseInt(dataStr) || 0;
      const isUnlimited = dataStr.includes('무제한');
      if (!isUnlimited && dataNum > 0 && dataNum < cond.dataGB * 0.8) return false;
    }

    // 통화: 요청량 이상이면 OK (기본제공=300분, 500분 요금제도 포함)
    if (cond.voiceMin) {
      const voiceNum = parseInt(voiceStr) || (voiceStr.includes('기본제공') ? 300 : 0);
      const isVoiceUnlimited = voiceStr.includes('무제한');
      if (!isVoiceUnlimited && voiceNum < cond.voiceMin * 0.5) return false;
    }

    // 가격: 예산의 2배 이내까지 허용 (저렴한 순으로 정렬할 거라 넓게)
    if (cond.maxPrice && fee > cond.maxPrice * 2) return false;

    return true;
  });

  // 요금제만 저렴한 순 정렬
  return filtered.sort((a, b) => {
    if (a.metadata.type !== 'product') return 1;
    if (b.metadata.type !== 'product') return -1;
    return (a.metadata.monthlyFee || 0) - (b.metadata.monthlyFee || 0);
  });
}

async function smartRetrieve(question, k = 8) {
  if (!vectorStore) vectorStore = await loadVectorStore();

  const lower = question.toLowerCase();
  const queryType = detectQueryType(question);
  const isRecommend = RECOMMEND_KEYWORDS.some(kw => lower.includes(kw));
  const usageCond = parseUsageConditions(question);
  const wantsPrepaid = lower.includes('선불');

  // 검색어 구성
  let searchQuery = question;
  if (isRecommend && !usageCond) searchQuery = '이달의 추천 요금제 ' + question;
  if (usageCond) {
    // 조건이 있으면 검색어에 포함
    const parts = [question];
    if (usageCond.dataGB) parts.push(usageCond.dataGB >= 999 ? '무제한 데이터' : `${usageCond.dataGB}GB 데이터`);
    if (usageCond.voiceMin) parts.push(usageCond.voiceMin >= 9999 ? '무제한 통화' : `${usageCond.voiceMin}분 통화`);
    if (usageCond.maxPrice) parts.push(`${usageCond.maxPrice}원 이하`);
    if (usageCond.network) parts.push(usageCond.network);
    searchQuery = parts.join(' ') + ' 요금제';
  }

  const allDocs = await vectorStore.similaritySearch(searchQuery, k * 5);

  // 선불 제외 필터 (명시적으로 선불을 원하지 않는 경우)
  const noPrepaid = wantsPrepaid ? allDocs : allDocs.filter(d => {
    if (d.metadata.type !== 'product') return true;
    const name = (d.metadata.name || '').toLowerCase();
    return !name.includes('선불');
  });

  // 조건 필터링 적용
  const filtered = usageCond ? filterProductDocs(noPrepaid, usageCond) : noPrepaid;

  // 추천 요금제 (조건 없을 때): 이달의 추천 카테고리 우선
  if (isRecommend && !usageCond) {
    const recommended = filtered.filter(d => d.metadata.type === 'product' && (d.metadata.categories || '').includes('이달의 추천'));
    const otherProducts = filtered.filter(d => d.metadata.type === 'product' && !(d.metadata.categories || '').includes('이달의 추천'));
    const others = filtered.filter(d => d.metadata.type !== 'product');
    return [...recommended.slice(0, 7), ...otherProducts.slice(0, 2), ...others.slice(0, 1)].slice(0, 10);
  }

  // 조건 기반 추천: 요금제 우선 (최대 10개 전달 → AI가 5개 선택)
  if (usageCond) {
    const products = filtered.filter(d => d.metadata.type === 'product')
      .sort((a, b) => (a.metadata.monthlyFee || 0) - (b.metadata.monthlyFee || 0));
    const others = filtered.filter(d => d.metadata.type !== 'product');
    return [...products.slice(0, 8), ...others.slice(0, 2)].slice(0, 10);
  }

  const typed = filtered.filter(d => d.metadata.type === queryType);
  const others = filtered.filter(d => d.metadata.type !== queryType);

  let result;
  if (queryType === 'product') {
    result = [...typed.slice(0, 6), ...others.slice(0, 2)];
  } else if (queryType === 'guide') {
    result = [...typed.slice(0, 5), ...others.slice(0, 3)];
  } else if (queryType === 'terms') {
    result = [...typed.slice(0, 5), ...others.slice(0, 3)];
  } else {
    const faqs = filtered.filter(d => d.metadata.type === 'faq');
    const rest = filtered.filter(d => d.metadata.type !== 'faq');
    result = [...faqs.slice(0, 3), ...rest.slice(0, 5)];
  }

  return result.slice(0, k);
}

async function initChain() {
  if (chain) return;

  console.log('RAG 체인 초기화 중...');
  vectorStore = await loadVectorStore();

  const llm = new ChatAnthropic({
    model: 'claude-haiku-4-5-20251001',
    maxTokens: 768,
    temperature: 0.3,
  });

  chain = RunnableSequence.from([
    {
      context: async (input) => {
        const docs = await smartRetrieve(input.question, 8);
        return docs.map(d => d.pageContent).join('\n\n---\n\n');
      },
      question: (input) => input.question,
      history: (input) => input.history || ''
    },
    prompt,
    llm,
    new StringOutputParser()
  ]);

  console.log('RAG 체인 초기화 완료');
}

// 검색만 (관리자용)
async function searchDocuments(query, k = 5) {
  const docs = await smartRetrieve(query, k);
  return docs.map(d => ({
    content: d.pageContent.slice(0, 300),
    metadata: d.metadata,
    score: d.score || null
  }));
}

// RAG 체인 실행
async function ragChat(question, history = '') {
  await initChain();
  return await chain.invoke({ question, history });
}

// 재인덱싱
async function reindex() {
  const { ingestAll } = require('./ingest');
  vectorStore = null;
  chain = null;
  const stats = await ingestAll();
  await initChain();
  return stats;
}

module.exports = { initChain, ragChat, searchDocuments, reindex };
