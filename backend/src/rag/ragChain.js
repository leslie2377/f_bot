const { ChatAnthropic } = require('@langchain/anthropic');
const { PromptTemplate } = require('@langchain/core/prompts');
const { StringOutputParser } = require('@langchain/core/output_parsers');
const { RunnableSequence, RunnablePassthrough } = require('@langchain/core/runnables');
const { loadVectorStore } = require('./ingest');

let vectorStore = null;
let retriever = null;
let chain = null;

const SYSTEM_TEMPLATE = `당신은 프리텔레콤(프리티) 셀프개통 전문 상담 AI입니다. 존댓말을 사용하고 친절하게 안내합니다.

규칙:
- 아래 [참고 자료]만 기반으로 답변하세요. 자료에 없으면 "정확한 답변을 드리기 어렵습니다"라고 하고 고객센터를 안내하세요.
- 요금제 안내 시 상세 링크를 포함하세요: "👉 [상세보기](URL)"
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

async function initChain() {
  if (chain) return;

  console.log('RAG 체인 초기화 중...');
  vectorStore = await loadVectorStore();
  retriever = vectorStore.asRetriever({
    k: 5,  // 상위 5개 문서 검색
    searchType: 'similarity'
  });

  const llm = new ChatAnthropic({
    model: 'claude-haiku-4-5-20251001',
    maxTokens: 768,
    temperature: 0.3,
  });

  chain = RunnableSequence.from([
    {
      context: async (input) => {
        const docs = await retriever.invoke(input.question);
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

// RAG 검색만 수행 (디버깅/관리자용)
async function searchDocuments(query, k = 5) {
  if (!vectorStore) await initChain();
  const docs = await retriever.invoke(query);
  return docs.map(d => ({
    content: d.pageContent.slice(0, 200),
    metadata: d.metadata,
    score: d.score || null
  }));
}

// RAG 체인 실행
async function ragChat(question, history = '') {
  await initChain();
  const reply = await chain.invoke({ question, history });
  return reply;
}

// 벡터 스토어 재인덱싱
async function reindex() {
  const { ingestAll } = require('./ingest');
  vectorStore = null;
  retriever = null;
  chain = null;
  const stats = await ingestAll();
  await initChain();
  return stats;
}

module.exports = { initChain, ragChat, searchDocuments, reindex };
