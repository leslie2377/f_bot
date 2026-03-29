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
- 통화/문자 "기본제공"은 무제한이 아닙니다. 그대로 "기본제공"이라 안내하세요.
- "추천요금제", "추천 요금제" 질문 시 → "이달의 추천" 카테고리 요금제를 안내하세요.

- 개통 절차는 단계별 번호를 매겨 안내하세요.
- 약관은 쉬운 말로 요약하세요.
- 고객센터: SKT 1661-2207 / KT 1577-4551 / U+ 1588-3615
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

async function smartRetrieve(question, k = 8) {
  if (!vectorStore) vectorStore = await loadVectorStore();

  const lower = question.toLowerCase();
  const queryType = detectQueryType(question);
  const isRecommend = RECOMMEND_KEYWORDS.some(kw => lower.includes(kw));

  // 추천 요금제 질문: "이달의 추천" 검색어로 변환
  const searchQuery = isRecommend ? '이달의 추천 요금제 ' + question : question;

  const allDocs = await vectorStore.similaritySearch(searchQuery, k * 2);

  // 추천 요금제: 이달의 추천 카테고리 우선
  if (isRecommend) {
    const recommended = allDocs.filter(d => d.metadata.type === 'product' && (d.metadata.categories || '').includes('이달의 추천'));
    const otherProducts = allDocs.filter(d => d.metadata.type === 'product' && !(d.metadata.categories || '').includes('이달의 추천'));
    const others = allDocs.filter(d => d.metadata.type !== 'product');
    return [...recommended.slice(0, 5), ...otherProducts.slice(0, 2), ...others.slice(0, 1)].slice(0, k);
  }

  const typed = allDocs.filter(d => d.metadata.type === queryType);
  const others = allDocs.filter(d => d.metadata.type !== queryType);

  let result;
  if (queryType === 'product') {
    result = [...typed.slice(0, 6), ...others.slice(0, 2)];
  } else if (queryType === 'guide') {
    result = [...typed.slice(0, 5), ...others.slice(0, 3)];
  } else if (queryType === 'terms') {
    result = [...typed.slice(0, 5), ...others.slice(0, 3)];
  } else {
    const faqs = allDocs.filter(d => d.metadata.type === 'faq');
    const rest = allDocs.filter(d => d.metadata.type !== 'faq');
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
