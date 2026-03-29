# f_bot 시스템 구성 및 아키텍처

> 프리텔레콤(프리티) 셀프개통 AI 상담 챗봇

| 항목 | 내용 |
|------|------|
| 프로젝트 | f_bot |
| GitHub | https://github.com/leslie2377/f_bot |
| 작성일 | 2026-03-29 |
| 버전 | 1.0.0 |

---

## 1. 시스템 전체 구성도

```
┌────────────────────────────────────────────────────────────────────┐
│                        사용자 (고객)                                │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │        채팅 위젯 (React + Vite, :5173)                       │  │
│  │  - 플로팅 채팅 버튼                                           │  │
│  │  - 실시간 대화 UI (마크다운 렌더링, 링크 클릭)                  │  │
│  │  - 자주 묻는 질문 6개 빠른 버튼                                │  │
│  │  - 프리티 브랜드 컬러 (#f0543a, #3f4970)                      │  │
│  └────────────────────────┬─────────────────────────────────────┘  │
└───────────────────────────┼────────────────────────────────────────┘
                            │ POST /api/chat
                            ▼
┌────────────────────────────────────────────────────────────────────┐
│                    Backend API (Node.js + Express, :3001)           │
│                                                                     │
│  ┌─── 라우트 ───────────────────────────────────────────────────┐  │
│  │  POST /api/chat         채팅 API (메인)                       │  │
│  │  GET  /api/products     요금제 목록 API                       │  │
│  │  GET  /api/faq          FAQ 목록 API                         │  │
│  │  GET  /api/health       헬스체크                              │  │
│  │  POST /api/admin/login  관리자 로그인 (JWT)                   │  │
│  │  GET  /api/admin/*      관리자 API (인증 필요)                │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌─── AI 서비스 레이어 (3단계 토큰 최적화) ─────────────────────┐  │
│  │                                                                │  │
│  │  1단계: FAQ 직접 매칭 ──→ 토큰 0 (키워드 점수 기반)           │  │
│  │          ↓ (미매칭)                                           │  │
│  │  2단계: 응답 캐시 조회 ──→ 토큰 0 (24h TTL, 500건)           │  │
│  │          ↓ (캐시 미스)                                        │  │
│  │  3단계: LangChain RAG 체인 ──→ AI 호출                       │  │
│  │          ├─ FAISS 벡터 검색 (Top 5 유사 문서)                 │  │
│  │          ├─ 프롬프트 템플릿 (컨텍스트 + 히스토리 + 질문)       │  │
│  │          └─ Claude Haiku 4.5 (max 768 tokens)                │  │
│  │                                                                │  │
│  └──────────────┬───────────────┬───────────────┬────────────────┘  │
│                 │               │               │                   │
│  ┌──────────────▼──┐ ┌─────────▼────────┐ ┌────▼──────────────┐   │
│  │  데이터 서비스   │ │  RAG 엔진        │ │  대화 저장소       │   │
│  │  (dataService)  │ │  (ragChain)      │ │  (convStore)      │   │
│  │                 │ │                  │ │                    │   │
│  │  - FAQ 검색     │ │  - FAISS 벡터DB  │ │  - 세션별 JSON    │   │
│  │  - 요금제 조회  │ │  - 로컬 임베딩   │ │  - 메시지 저장    │   │
│  │  - 컨텍스트 빌드│ │  - PDF 인제스션  │ │  - 통계/분석      │   │
│  └────────┬────────┘ └────────┬─────────┘ └────────┬──────────┘   │
│           │                   │                     │               │
│  ┌────────▼───────────────────▼─────────────────────▼──────────┐   │
│  │                     데이터 레이어                             │   │
│  │                                                              │   │
│  │  /data/faq.json (22개)         /data/vectorstore/ (FAISS)   │   │
│  │  /data/products.json (181개)   /data/conversations/ (세션)   │   │
│  │  /data/terms.json (7개)        /data/response_cache.json    │   │
│  │  /data/guide.json              /data/keyword_stats.json     │   │
│  │  /data/pdf/ (약관 PDF 156p)    /data/manual_docs.json       │   │
│  └──────────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────────┘
                            ▲
                            │ /api/admin/* (JWT 인증)
                            │
┌───────────────────────────┼────────────────────────────────────────┐
│                        관리자                                       │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │        관리자 대시보드 (React + Vite, :5174)                  │  │
│  │                                                               │  │
│  │  📊 대시보드     - 전체/오늘 상담 수, 카테고리 차트             │  │
│  │  💬 세션 목록    - 검색/필터/페이지네이션, 화자별 대화 뷰       │  │
│  │  ❓ 미해결 질문  - AI 미응답 건 추적                           │  │
│  │  🔑 키워드 통계  - 문의 키워드 빈도, 카테고리별 분포            │  │
│  │  🧠 RAG 관리    - 벡터 검색 테스트, 문서 추가, 이력, 재인덱싱  │  │
│  └──────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────┘
```

---

## 2. 기술 스택

### 2.1 Backend

| 기술 | 버전 | 용도 |
|------|------|------|
| Node.js | v24+ | 서버 런타임 |
| Express | 4.21 | HTTP API 프레임워크 |
| LangChain.js | 1.2 | RAG 체인, 프롬프트 관리 |
| @langchain/anthropic | 1.3 | Claude LLM 통합 |
| @langchain/community | 1.1 | FAISS 벡터 스토어 |
| faiss-node | 0.5 | 벡터 유사도 검색 (C++ 바인딩) |
| pdf-parse | 1.1 | PDF 텍스트 추출 |
| jsonwebtoken | 9.0 | JWT 인증 |
| dotenv | 16.4 | 환경변수 관리 |

### 2.2 Frontend (채팅 위젯)

| 기술 | 버전 | 용도 |
|------|------|------|
| React | 19.0 | UI 컴포넌트 |
| Vite | 6.2 | 빌드 도구 + HMR |

### 2.3 Admin (관리자 대시보드)

| 기술 | 버전 | 용도 |
|------|------|------|
| React | 19.0 | UI 컴포넌트 |
| react-router-dom | 7.4 | 라우팅 |
| recharts | 2.15 | 차트 (파이, 바) |
| Vite | 6.2 | 빌드 도구 |

---

## 3. 디렉토리 구조

```
f_bot/
├── package.json                     # 모노레포 루트 (concurrently)
├── .gitignore
│
├── backend/                          # API 서버
│   ├── src/
│   │   ├── app.js                   # Express 진입점
│   │   ├── routes/
│   │   │   ├── chat.js              # POST /api/chat
│   │   │   ├── admin.js             # /api/admin/* (23개 엔드포인트)
│   │   │   ├── products.js          # GET /api/products
│   │   │   └── faq.js               # GET /api/faq
│   │   ├── services/
│   │   │   ├── aiService.js         # 3단계 AI 응답 오케스트레이션
│   │   │   ├── dataService.js       # JSON 데이터 로드 + FAQ 매칭
│   │   │   ├── conversationStore.js # 대화 영구 저장/통계
│   │   │   └── responseCache.js     # 응답 캐시 + 키워드 통계
│   │   ├── rag/
│   │   │   ├── ragChain.js          # LangChain RAG 체인
│   │   │   ├── ingest.js            # 데이터 인제스션 파이프라인
│   │   │   └── localEmbeddings.js   # 로컬 한국어 임베딩 (API 무료)
│   │   ├── middleware/
│   │   │   └── adminAuth.js         # JWT 인증 + 브루트포스 방지
│   │   └── data/
│   │       ├── faq.json             # FAQ 22개
│   │       ├── products.json        # 요금제 181개
│   │       ├── terms.json           # 약관 요약 7개
│   │       ├── guide.json           # 개통 가이드 + eSIM + 선불 + 고객센터
│   │       ├── pdf/                 # 약관 PDF (156페이지)
│   │       ├── vectorstore/         # FAISS 벡터 DB (838문서)
│   │       ├── conversations/       # 대화 세션 저장소
│   │       ├── response_cache.json  # 응답 캐시
│   │       ├── keyword_stats.json   # 키워드 통계
│   │       └── manual_docs.json     # 수동 추가 이력
│   ├── .env                         # 환경변수 (API 키, 비밀번호)
│   └── package.json
│
├── frontend/                         # 고객 채팅 위젯
│   ├── src/
│   │   ├── App.jsx                  # 메인 앱
│   │   ├── components/
│   │   │   └── ChatWidget.jsx       # 채팅 위젯 (플로팅 + 패널)
│   │   ├── hooks/
│   │   │   └── useChat.js           # 채팅 API 연동 훅
│   │   └── styles/
│   │       └── chat.css             # 프리티 브랜드 컬러 스타일
│   ├── vite.config.js               # 포트 5173, /api 프록시
│   └── package.json
│
├── admin/                            # 관리자 대시보드
│   ├── src/
│   │   ├── App.jsx                  # 인증 라우팅
│   │   ├── components/
│   │   │   ├── LoginPage.jsx        # 로그인
│   │   │   ├── AdminLayout.jsx      # 사이드바 + 탭 레이아웃
│   │   │   ├── Dashboard.jsx        # 통계 대시보드
│   │   │   ├── SessionList.jsx      # 세션 목록
│   │   │   ├── SessionDetail.jsx    # 대화 상세 (화자별 뷰)
│   │   │   ├── UnresolvedList.jsx   # 미해결 질문
│   │   │   ├── KeywordStats.jsx     # 키워드 통계
│   │   │   └── RagManager.jsx       # RAG 벡터 관리
│   │   ├── hooks/
│   │   │   └── useAdmin.js          # 관리자 API 훅
│   │   └── styles/
│   │       └── admin.css            # 관리자 스타일
│   ├── vite.config.js               # 포트 5174, /api 프록시
│   └── package.json
│
└── docs/                             # 프로젝트 문서
    ├── 01-plan/features/             # 기획 문서
    ├── 02-design/features/           # 설계 문서
    └── 03-architecture/              # 아키텍처 문서
        └── system-architecture.md    # (본 문서)
```

---

## 4. 핵심 아키텍처: 3단계 AI 응답 시스템

### 4.1 응답 처리 흐름

```
사용자 메시지 수신
    │
    ├─ 키워드 추출 → keyword_stats.json 저장 (통계용)
    ├─ 카테고리 감지 (product/opening/terms/cs/payment/general)
    ├─ 대화 히스토리 저장 (conversationStore)
    │
    ▼
┌─────────────────────────────────────────────────┐
│  1단계: FAQ 직접 매칭                            │
│                                                  │
│  findExactFaqMatch(message)                      │
│  - 키워드 매칭 점수 계산 (2글자+: 2점, 3글자+: 1점) │
│  - 점수 ≥ 4 이면 직접 응답                        │
│  - "추천", "비교" 등 AI 필요 키워드 제외            │
│                                                  │
│  결과: 토큰 0, 즉시 응답                          │
└──────────┬──────────────────────────────────────┘
           │ (미매칭)
           ▼
┌─────────────────────────────────────────────────┐
│  2단계: 응답 캐시 조회                            │
│                                                  │
│  getCachedResponse(message)                      │
│  - 정규화: 공백/특수문자 제거, 소문자              │
│  - 정확 매칭 → 캐시 히트                          │
│  - 유사 매칭 (80% 키워드 겹침) → 캐시 히트         │
│  - TTL: 24시간, 최대 500건                        │
│                                                  │
│  결과: 토큰 0, 캐시 응답 반환                     │
└──────────┬──────────────────────────────────────┘
           │ (캐시 미스)
           ▼
┌─────────────────────────────────────────────────┐
│  3단계: LangChain RAG 체인                       │
│                                                  │
│  ragChat(question, history)                      │
│  ┌─────────────────────────────────────────┐     │
│  │ 1. FAISS 벡터 검색 (Top 5 문서)         │     │
│  │    - 838개 벡터 중 유사도 기반 검색       │     │
│  │    - 로컬 한국어 임베딩 (API 비용 0)     │     │
│  │                                         │     │
│  │ 2. PromptTemplate 조합                  │     │
│  │    - System: 프리티 상담원 역할/규칙     │     │
│  │    - Context: 검색된 5개 문서            │     │
│  │    - History: 최근 6턴 대화              │     │
│  │    - Question: 사용자 질문               │     │
│  │                                         │     │
│  │ 3. Claude Haiku 4.5 호출                │     │
│  │    - Temperature: 0.3                   │     │
│  │    - Max tokens: 768                    │     │
│  └─────────────────────────────────────────┘     │
│                                                  │
│  결과: AI 응답 + 캐시 저장                        │
└─────────────────────────────────────────────────┘
    │
    ├─ 응답 캐시 저장 (setCachedResponse)
    ├─ 대화 히스토리 저장 (conversationStore)
    └─ 응답 반환 { reply, category, source, tokensUsed }
```

### 4.2 응답 소스(source) 구분

| source | 설명 | 토큰 비용 | 응답 속도 |
|--------|------|-----------|-----------|
| `faq_direct` | FAQ 정확 매칭 | 0 | ~1ms |
| `cache_exact` | 캐시 정확 매칭 | 0 | ~1ms |
| `cache_similar` | 캐시 유사 매칭 | 0 | ~5ms |
| `rag` | LangChain RAG 체인 | ~800 tokens | ~2-5초 |

---

## 5. RAG (Retrieval-Augmented Generation) 아키텍처

### 5.1 인제스션 파이프라인

```
데이터 소스                    인제스션                       벡터 스토어
┌─────────────┐              ┌──────────────┐             ┌──────────────┐
│ faq.json    │──→ 22 문서 ──┤              │             │              │
│ (22개 FAQ)  │              │              │             │   FAISS      │
├─────────────┤              │  텍스트 분할  │             │   Index      │
│products.json│──→ 181 문서──┤  (500자 청크  │──임베딩──→  │              │
│ (181 요금제)│              │   50자 오버랩) │             │  838개 벡터  │
├─────────────┤              │              │             │              │
│ guide.json  │──→ 7 문서 ──┤              │             │  차원: 384   │
│ (가이드)    │              │              │             │              │
├─────────────┤              │              │             └──────────────┘
│ terms.json  │──→ 7 문서 ──┤              │
│ (약관 요약) │              │              │
├─────────────┤              │              │
│ PDF 약관    │──→ 1 문서 ──┤              │
│ (156페이지) │   (622청크)  └──────────────┘
└─────────────┘
```

### 5.2 로컬 한국어 임베딩 (LocalKoreanEmbeddings)

외부 API 없이 동작하는 한국어 특화 임베딩:

| 차원 범위 | 방식 | 설명 |
|-----------|------|------|
| 0~127 | 도메인 키워드 매칭 | 128개 프리티 도메인 키워드 (개통, 유심, 요금제...) |
| 128~255 | 문자 바이그램 해시 | 2글자 조합의 해시 (의미 유사도) |
| 256~383 | 단어 해시 | 2글자+ 단어의 해시 (단어 수준 매칭) |

- 벡터 차원: 384
- 정규화: L2 Norm
- API 비용: 0원 (완전 로컬)

### 5.3 벡터 스토어 현황

| 데이터 | 원본 수 | 청크 후 | 비율 |
|--------|---------|---------|------|
| FAQ | 22 | 22 | 2.6% |
| 요금제 | 181 | 181 | 21.6% |
| 가이드 | 7 | 7 | 0.8% |
| 약관 요약 | 7 | 7 | 0.8% |
| 약관 PDF | 1 (156p) | 622 | 74.2% |
| **합계** | **218** | **839** | **100%** |

---

## 6. 대화 저장 시스템

### 6.1 저장 구조

```
data/conversations/
├── index.json                    # 세션 인덱스 (메타데이터)
└── sessions/
    └── 2026-03-25/               # 날짜별 폴더
        ├── session_abc123.json   # 세션별 전체 대화
        └── session_def456.json
```

### 6.2 세션 메타데이터

```json
{
  "sessionId": "session_1711350605000",
  "date": "2026-03-25",
  "startedAt": "ISO 날짜",
  "lastMessageAt": "ISO 날짜",
  "messageCount": 12,
  "userMessageCount": 6,
  "botMessageCount": 6,
  "categories": ["opening", "product"],
  "primaryCategory": "opening",
  "status": "active | completed",
  "hasUnresolved": false,
  "firstUserMessage": "셀프개통 하려면...",
  "avgResponseTimeMs": 2340
}
```

### 6.3 메시지 저장 형식

```json
{
  "id": "msg_1711350605001",
  "timestamp": "ISO 날짜",
  "role": "user | bot",
  "content": "메시지 내용",
  "metadata": {
    "category": "opening",
    "responseTimeMs": 2341,          // bot만
    "tokensUsed": { "input": 0, "output": 0 },
    "source": "rag | faq_direct | cache_exact"
  }
}
```

### 6.4 성능 최적화

| 전략 | 설명 |
|------|------|
| 쓰기 디바운스 | 500ms 모아서 한번에 flush |
| 인덱스 캐시 | 인덱스는 메모리 유지, 세션 파일은 요청 시 로드 |
| 날짜별 분리 | 파일 탐색 성능 확보 |

---

## 7. API 엔드포인트 총람

### 7.1 고객용 API

| Method | Endpoint | 설명 | 인증 |
|--------|----------|------|------|
| POST | `/api/chat` | AI 채팅 | 없음 |
| GET | `/api/products` | 요금제 목록 (?network, ?sort) | 없음 |
| GET | `/api/faq` | FAQ 목록 (?category) | 없음 |
| GET | `/api/health` | 헬스체크 | 없음 |

### 7.2 관리자 API

| Method | Endpoint | 설명 |
|--------|----------|------|
| POST | `/api/admin/login` | JWT 로그인 |
| **세션** | | |
| GET | `/api/admin/sessions` | 세션 목록 (검색/필터/페이지네이션) |
| GET | `/api/admin/sessions/:id` | 세션 상세 (전체 대화) |
| DELETE | `/api/admin/sessions/:id` | 세션 삭제 |
| **통계** | | |
| GET | `/api/admin/stats` | 전체 통계 |
| GET | `/api/admin/stats/daily` | 일별 추이 |
| GET | `/api/admin/unresolved` | 미해결 질문 목록 |
| GET | `/api/admin/popular` | 인기 질문 Top N |
| **키워드** | | |
| GET | `/api/admin/keywords` | 키워드 통계 |
| GET | `/api/admin/cache` | 캐시 통계 |
| **RAG 관리** | | |
| GET | `/api/admin/rag/search` | 벡터 검색 테스트 |
| GET | `/api/admin/rag/stats` | 벡터 스토어 통계 |
| POST | `/api/admin/rag/reindex` | 전체 재인덱싱 |
| POST | `/api/admin/rag/add` | 문서 수동 추가 |
| GET | `/api/admin/rag/documents` | 수동 추가 이력 조회 |
| DELETE | `/api/admin/rag/documents/:id` | 수동 추가 문서 삭제 |
| **내보내기** | | |
| GET | `/api/admin/export` | CSV/JSON 내보내기 |

---

## 8. 인증 및 보안

### 8.1 관리자 인증

```
로그인 요청 → 비밀번호 검증 → JWT 발급 (24h)
                                  │
이후 API 요청 → Authorization: Bearer <token> → 검증 → 허용/거부
```

| 항목 | 설정 |
|------|------|
| 인증 방식 | JWT (HS256) |
| 토큰 유효기간 | 24시간 |
| 비밀번호 | 환경변수 `ADMIN_PASSWORD` |
| 브루트포스 방지 | 5회 실패 시 60초 잠금 (IP 기반) |

### 8.2 보안 고려사항

| 항목 | 현재 상태 |
|------|-----------|
| API 키 | `.env` 파일 (gitignore 처리) |
| CORS | 전체 허용 (프로덕션 시 제한 필요) |
| 고객 데이터 | IP 미수집, 개인정보 없음 |
| 대화 보관 | 로컬 JSON (암호화 미적용) |

---

## 9. 데이터 현황

### 9.1 콘텐츠 데이터

| 데이터 | 건수 | 소스 |
|--------|------|------|
| FAQ | 22개 | 프리티 사이트 + 수동 |
| 요금제 | 181개 | 프리티 API (`/plan/v1/list`) 자동 수집 |
| 약관 요약 | 7개 | 수동 정리 |
| 약관 PDF | 1개 (156페이지) | freet.co.kr 다운로드 |
| 개통 가이드 | 7개 섹션 | 프리티 사이트 수집 |

### 9.2 요금제 분포

| 통신망 | 요금제 수 | 비율 |
|--------|----------|------|
| SKT | 68개 | 37.6% |
| LGU+ | 59개 | 32.6% |
| KT | 54개 | 29.8% |
| **합계** | **181개** | 100% |

### 9.3 운영 데이터

| 데이터 | 저장 위치 | 설명 |
|--------|-----------|------|
| 대화 세션 | `data/conversations/` | 세션별 JSON |
| 응답 캐시 | `data/response_cache.json` | 24h TTL, 500건 |
| 키워드 통계 | `data/keyword_stats.json` | 문의 키워드 빈도 |
| 수동 추가 이력 | `data/manual_docs.json` | 관리자 추가 문서 |
| 벡터 인덱스 | `data/vectorstore/` | FAISS 바이너리 |

---

## 10. 실행 및 배포

### 10.1 개발 환경 실행

```bash
# 전체 실행 (Backend + Frontend + Admin)
npm run dev:all

# 개별 실행
npm run dev:backend    # http://localhost:3001
npm run dev:frontend   # http://localhost:5173
npm run dev:admin      # http://localhost:5174
```

### 10.2 데이터 관리 명령

```bash
# 벡터 DB 재구축
cd backend && npm run ingest

# 요금제 데이터 갱신 후 재인덱싱
# → products.json 수정 → npm run ingest
# → 또는 관리자 페이지 > RAG 관리 > 재인덱싱
```

### 10.3 환경변수

```env
ANTHROPIC_API_KEY=sk-ant-...    # Claude API 키 (필수)
PORT=3001                       # 서버 포트
ADMIN_PASSWORD=freet_admin_2026 # 관리자 비밀번호
JWT_SECRET=...                  # JWT 시크릿
```

### 10.4 포트 구성

| 서비스 | 포트 | 용도 |
|--------|------|------|
| Backend API | 3001 | Express API 서버 |
| Frontend | 5173 | 고객 채팅 위젯 (Vite) |
| Admin | 5174 | 관리자 대시보드 (Vite) |

---

## 11. 향후 확장 포인트

| 영역 | 현재 | 확장 가능 |
|------|------|-----------|
| 임베딩 | 로컬 TF-IDF (무료) | OpenAI Embeddings (정확도↑) |
| 벡터 DB | FAISS (로컬 파일) | Pinecone/Chroma (클라우드) |
| 데이터 저장 | JSON 파일 | SQLite → PostgreSQL |
| 배포 | 로컬 개발 | Vercel (FE) + Railway (BE) |
| 인증 | 단일 비밀번호 | OAuth2 / SSO |
| 모니터링 | 자체 통계 | Grafana + Prometheus |
