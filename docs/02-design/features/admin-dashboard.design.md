# Design: 관리자 대시보드 - 대화 세션/화자별 관리

## Executive Summary

| 항목 | 내용 |
|------|------|
| Feature | 챗봇 관리자 대시보드 (대화 세션/화자별 분리 관리) |
| Plan 참조 | docs/01-plan/features/admin-dashboard.plan.md |
| 작성일 | 2026-03-25 |

---

## 1. 기존 코드 변경 설계 (Backend)

### 1.1 aiService.js 변경 사항

**현재**: 대화를 `Map`에만 저장 (메모리, 휘발성)
**변경**: `Map` 유지 (AI 컨텍스트용) + `conversationStore`에 영구 저장 병행

```js
// 변경 전 (aiService.js:84)
addToHistory(sessionId, 'assistant', reply);
return { reply, category };

// 변경 후
addToHistory(sessionId, 'assistant', reply);

// 영구 저장 (비동기, 논블로킹)
const responseTimeMs = Date.now() - startTime;
conversationStore.saveMessage(sessionId, {
  role: 'user',
  content: message,
  category
});
conversationStore.saveMessage(sessionId, {
  role: 'bot',
  content: reply,
  category,
  responseTimeMs,
  tokensUsed: {
    input: response.usage.input_tokens,
    output: response.usage.output_tokens
  }
});

return { reply, category };
```

**변경 범위**: `chat()` 함수 내부만 수정. 기존 Map 기반 히스토리 로직은 유지.

### 1.2 chat.js 라우트 변경 사항

**변경 없음**. aiService 내부에서 저장을 처리하므로 라우트는 그대로.

### 1.3 app.js 변경 사항

```js
// 추가할 내용
const adminRouter = require('./routes/admin');

// 관리자 라우트 등록 (기존 라우트 아래에 추가)
app.use('/api/admin', adminRouter);

// 관리자 페이지 정적 파일 서빙 (빌드 후)
app.use('/admin', express.static(path.join(__dirname, '../../admin/dist')));
```

---

## 2. 신규 모듈 설계

### 2.1 conversationStore.js - 대화 저장 서비스

**파일 위치**: `backend/src/services/conversationStore.js`

#### 저장 디렉토리 구조

```
backend/src/data/conversations/
├── index.json                    # 세션 인덱스 (목록 + 메타)
└── sessions/
    ├── 2026-03-25/               # 날짜별 폴더
    │   ├── session_abc123.json
    │   └── session_def456.json
    └── 2026-03-26/
        └── session_ghi789.json
```

#### 함수 설계

```
┌─────────────────────────────────────────────────────────────────┐
│                    conversationStore.js                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  초기화                                                          │
│  ├─ init()                  저장 디렉토리 생성, 인덱스 로드       │
│                                                                  │
│  저장 (쓰기)                                                     │
│  ├─ saveMessage(sessionId, msg)    메시지 1건 저장               │
│  ├─ createSession(sessionId)       새 세션 생성                  │
│  ├─ updateSessionIndex(sessionId)  인덱스 갱신                   │
│                                                                  │
│  조회 (읽기)                                                     │
│  ├─ getSessions(options)           세션 목록 조회                │
│  │    options: { page, limit, search, category, dateFrom,       │
│  │              dateTo, status, sort }                           │
│  ├─ getSession(sessionId)          세션 상세 (전체 대화)          │
│  ├─ searchMessages(keyword)        메시지 내용 검색              │
│  │                                                               │
│  통계                                                            │
│  ├─ getStats()                     전체 통계                     │
│  │    → { totalSessions, todaySessions, activeSessions,         │
│  │        unresolvedCount, avgResponseTime, categoryDist }      │
│  ├─ getDailyStats(from, to)        일별 상담 추이               │
│  ├─ getCategoryStats()             카테고리별 통계               │
│  ├─ getUnresolved()                미해결 질문 목록              │
│  ├─ getPopularQuestions(limit)     인기 질문 Top N               │
│  │                                                               │
│  관리                                                            │
│  ├─ deleteSession(sessionId)       세션 삭제                     │
│  ├─ exportSessions(format, opts)   CSV/JSON 내보내기            │
│  └─ cleanup(daysOld)               오래된 세션 정리              │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

#### 세션 인덱스 상세 스키마 (index.json)

```json
{
  "sessions": [
    {
      "sessionId": "session_1711350605000",
      "date": "2026-03-25",
      "startedAt": "2026-03-25T10:30:05.000Z",
      "lastMessageAt": "2026-03-25T10:45:32.000Z",
      "messageCount": 12,
      "userMessageCount": 6,
      "botMessageCount": 6,
      "categories": ["opening", "product"],
      "primaryCategory": "opening",
      "status": "completed",
      "hasUnresolved": false,
      "firstUserMessage": "셀프개통 하려면 뭐가 필요해요?",
      "avgResponseTimeMs": 2340,
      "totalTokens": { "input": 5200, "output": 1800 }
    }
  ],
  "stats": {
    "totalSessions": 150,
    "totalMessages": 1840,
    "lastUpdated": "2026-03-25T10:45:32.000Z"
  }
}
```

#### 세션 파일 상세 스키마 (session_xxx.json)

```json
{
  "sessionId": "session_1711350605000",
  "startedAt": "2026-03-25T10:30:05.000Z",
  "messages": [
    {
      "id": "msg_1711350605001",
      "timestamp": "2026-03-25T10:30:05.000Z",
      "role": "user",
      "content": "셀프개통 하려면 뭐가 필요해요?",
      "metadata": {
        "category": "opening"
      }
    },
    {
      "id": "msg_1711350607341",
      "timestamp": "2026-03-25T10:30:07.341Z",
      "role": "bot",
      "content": "셀프개통을 위해서는 다음이 필요합니다:\n1. 유심카드...",
      "metadata": {
        "category": "opening",
        "responseTimeMs": 2341,
        "tokensUsed": { "input": 850, "output": 230 },
        "model": "claude-haiku-4-5-20251001"
      }
    }
  ]
}
```

#### 성능 고려사항

| 항목 | 설계 |
|------|------|
| **쓰기 성능** | `saveMessage()` 는 비동기 + 디바운스 (500ms 모아서 한번에 flush) |
| **인덱스 갱신** | 세션 종료 시 또는 5분마다 배치 업데이트 |
| **읽기 성능** | 인덱스로 목록 조회, 상세 시만 세션 파일 로드 |
| **메모리** | 인덱스만 메모리 캐시, 세션 파일은 요청 시 로드 |
| **파일 분리** | 날짜별 폴더로 분리하여 파일 탐색 최적화 |

#### 미해결 판정 로직

```
미해결(unresolved) 조건:
1. 봇 응답에 "답변을 드리기 어렵습니다" 포함
2. 봇 응답에 "고객센터" + 전화번호 패턴이 포함되면서
   직전 사용자 질문이 FAQ 키워드와 매칭되지 않는 경우
3. 봇 응답이 error 카테고리인 경우
```

---

### 2.2 adminAuth.js - 인증 미들웨어

**파일 위치**: `backend/src/middleware/adminAuth.js`

#### 인증 플로우

```
┌──────────┐     POST /api/admin/login     ┌──────────┐
│ 관리자    │  ──────────────────────────►  │ Backend  │
│ 브라우저  │     { password }              │          │
│          │  ◄──────────────────────────  │          │
│          │     { token } (JWT, 24h)      │          │
└──────────┘                               └──────────┘

이후 모든 /api/admin/* 요청:
  Authorization: Bearer <token>
  → adminAuth 미들웨어가 검증
  → 실패 시 401 Unauthorized
```

#### 설계

```js
// 환경변수
ADMIN_PASSWORD=설정할비밀번호
JWT_SECRET=랜덤시크릿키

// 로그인 API
POST /api/admin/login
  Request:  { "password": "..." }
  Success:  { "token": "jwt...", "expiresIn": "24h" }
  Fail:     401 { "error": "인증 실패" }

// 미들웨어 동작
adminAuth(req, res, next)
  1. Authorization 헤더에서 Bearer 토큰 추출
  2. jwt.verify(token, JWT_SECRET)
  3. 성공 → next()
  4. 실패 → 401 응답
```

#### 보안 규칙

| 항목 | 설계 |
|------|------|
| 비밀번호 저장 | 환경변수 (.env), 코드에 하드코딩 금지 |
| JWT 만료 | 24시간 (갱신 불필요, 재로그인) |
| 브루트포스 방지 | 5회 연속 실패 시 1분 대기 |
| CORS | 관리자 페이지 origin만 허용 |

---

### 2.3 admin.js - 관리자 API 라우트

**파일 위치**: `backend/src/routes/admin.js`

#### 엔드포인트 상세 설계

```
┌────────────────────────────────────────────────────────────────┐
│  POST /api/admin/login                                          │
├────────────────────────────────────────────────────────────────┤
│  Request:  { "password": "string" }                             │
│  Response: { "token": "jwt-string", "expiresIn": "24h" }       │
│  Error:    401 { "error": "인증 실패" }                          │
│  인증: 불필요 (로그인 엔드포인트)                                  │
└────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────┐
│  GET /api/admin/sessions                                        │
├────────────────────────────────────────────────────────────────┤
│  Query Parameters:                                              │
│    page      (number, default: 1)                               │
│    limit     (number, default: 20, max: 100)                    │
│    search    (string) 메시지 내용 키워드 검색                      │
│    category  (string) opening|product|terms|cs|general           │
│    dateFrom  (string) YYYY-MM-DD                                │
│    dateTo    (string) YYYY-MM-DD                                │
│    status    (string) completed|active|unresolved               │
│    sort      (string) latest|oldest|messages                    │
│                                                                 │
│  Response:                                                      │
│  {                                                              │
│    "sessions": [                                                │
│      {                                                          │
│        "sessionId": "session_xxx",                              │
│        "startedAt": "ISO-date",                                 │
│        "lastMessageAt": "ISO-date",                             │
│        "messageCount": 12,                                      │
│        "userMessageCount": 6,                                   │
│        "botMessageCount": 6,                                    │
│        "primaryCategory": "opening",                            │
│        "status": "completed",                                   │
│        "hasUnresolved": false,                                  │
│        "firstUserMessage": "셀프개통 하려면..."                   │
│      }                                                          │
│    ],                                                           │
│    "pagination": {                                              │
│      "page": 1,                                                 │
│      "limit": 20,                                               │
│      "total": 150,                                              │
│      "totalPages": 8                                            │
│    }                                                            │
│  }                                                              │
│  인증: 필요 (Bearer token)                                       │
└────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────┐
│  GET /api/admin/sessions/:sessionId                             │
├────────────────────────────────────────────────────────────────┤
│  Response:                                                      │
│  {                                                              │
│    "sessionId": "session_xxx",                                  │
│    "startedAt": "ISO-date",                                     │
│    "messages": [                                                │
│      {                                                          │
│        "id": "msg_xxx",                                         │
│        "timestamp": "ISO-date",                                 │
│        "role": "user" | "bot",                                  │
│        "content": "메시지 내용",                                 │
│        "metadata": {                                            │
│          "category": "opening",                                 │
│          "responseTimeMs": 2341,        // bot만                │
│          "tokensUsed": { "input": 850, "output": 230 } // bot만│
│        }                                                        │
│      }                                                          │
│    ],                                                           │
│    "stats": {                                                   │
│      "totalMessages": 12,                                       │
│      "avgResponseTimeMs": 2150,                                 │
│      "categories": { "opening": 4, "product": 2 }              │
│    }                                                            │
│  }                                                              │
│  Error: 404 { "error": "세션을 찾을 수 없습니다" }                │
│  인증: 필요                                                      │
└────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────┐
│  DELETE /api/admin/sessions/:sessionId                          │
├────────────────────────────────────────────────────────────────┤
│  Response: { "success": true, "message": "세션이 삭제되었습니다" }│
│  Error:    404 { "error": "세션을 찾을 수 없습니다" }             │
│  인증: 필요                                                      │
└────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────┐
│  GET /api/admin/stats                                           │
├────────────────────────────────────────────────────────────────┤
│  Response:                                                      │
│  {                                                              │
│    "overview": {                                                │
│      "totalSessions": 150,                                      │
│      "todaySessions": 47,                                       │
│      "activeSessions": 3,                                       │
│      "unresolvedCount": 2,                                      │
│      "totalMessages": 1840,                                     │
│      "avgResponseTimeMs": 2150                                  │
│    },                                                           │
│    "categoryDistribution": {                                    │
│      "opening": 45,                                             │
│      "product": 38,                                             │
│      "terms": 12,                                               │
│      "cs": 20,                                                  │
│      "general": 35                                              │
│    },                                                           │
│    "todayHourly": [                                             │
│      { "hour": 9, "count": 5 },                                │
│      { "hour": 10, "count": 12 },                              │
│      ...                                                        │
│    ]                                                            │
│  }                                                              │
│  인증: 필요                                                      │
└────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────┐
│  GET /api/admin/stats/daily                                     │
├────────────────────────────────────────────────────────────────┤
│  Query: from (YYYY-MM-DD), to (YYYY-MM-DD)                     │
│  Default: 최근 30일                                              │
│  Response:                                                      │
│  {                                                              │
│    "daily": [                                                   │
│      { "date": "2026-03-25", "sessions": 47, "messages": 380 },│
│      { "date": "2026-03-24", "sessions": 35, "messages": 290 } │
│    ]                                                            │
│  }                                                              │
│  인증: 필요                                                      │
└────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────┐
│  GET /api/admin/unresolved                                      │
├────────────────────────────────────────────────────────────────┤
│  Query: page, limit                                             │
│  Response:                                                      │
│  {                                                              │
│    "items": [                                                   │
│      {                                                          │
│        "sessionId": "session_xxx",                              │
│        "timestamp": "ISO-date",                                 │
│        "userMessage": "질문 내용",                               │
│        "botResponse": "답변 내용 (답변 불가 포함)",               │
│        "category": "general"                                    │
│      }                                                          │
│    ],                                                           │
│    "total": 12                                                  │
│  }                                                              │
│  인증: 필요                                                      │
└────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────┐
│  GET /api/admin/popular                                         │
├────────────────────────────────────────────────────────────────┤
│  Query: limit (default: 10)                                     │
│  Response:                                                      │
│  {                                                              │
│    "questions": [                                               │
│      { "question": "셀프개통 하려면...", "count": 28,            │
│        "category": "opening" },                                 │
│      { "question": "요금제 추천...", "count": 22,                │
│        "category": "product" }                                  │
│    ]                                                            │
│  }                                                              │
│  인증: 필요                                                      │
└────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────┐
│  GET /api/admin/export                                          │
├────────────────────────────────────────────────────────────────┤
│  Query:                                                         │
│    format   (csv|json, default: json)                           │
│    from     (YYYY-MM-DD)                                        │
│    to       (YYYY-MM-DD)                                        │
│    category (string)                                            │
│  Response:                                                      │
│    format=json → application/json 다운로드                       │
│    format=csv  → text/csv 다운로드                               │
│  Header: Content-Disposition: attachment; filename="export..."   │
│  인증: 필요                                                      │
└────────────────────────────────────────────────────────────────┘
```

---

## 3. 관리자 Frontend 설계

### 3.1 페이지 라우팅

```
/admin                    → 리다이렉트 → /admin/login 또는 /admin/dashboard
/admin/login              → LoginPage
/admin/dashboard          → Dashboard (통계 요약)
/admin/sessions           → SessionList (세션 목록 + 검색/필터)
/admin/sessions/:id       → SessionDetail (대화 상세 뷰)
/admin/unresolved         → UnresolvedList (미해결 질문)
/admin/export             → ExportPage (내보내기)
```

### 3.2 컴포넌트 트리

```
<AdminApp>
├── <LoginPage />                        # 로그인 화면
│
└── <AdminLayout>                        # 인증 후 레이아웃
    ├── <Sidebar />                      # 좌측 네비게이션
    │   ├── 📊 대시보드
    │   ├── 💬 세션 목록
    │   ├── ❓ 미해결 질문
    │   └── 📤 내보내기
    │
    └── <MainContent>                    # 우측 콘텐츠 영역
        │
        ├── <Dashboard>                  # 대시보드
        │   ├── <StatCards />            # 오늘 상담/진행중/미해결 카드
        │   ├── <CategoryChart />        # 카테고리 분포 (도넛 차트)
        │   ├── <HourlyChart />          # 시간대별 추이 (라인 차트)
        │   └── <RecentSessions />       # 최근 세션 5건
        │
        ├── <SessionList>                # 세션 목록
        │   ├── <SearchFilters />        # 검색 + 필터 바
        │   │   ├── 키워드 검색 입력
        │   │   ├── 카테고리 드롭다운
        │   │   ├── 날짜 범위 선택
        │   │   └── 상태 필터 (전체/완료/미해결)
        │   ├── <SessionTable />         # 세션 테이블
        │   │   ├── 세션ID (클릭 → 상세)
        │   │   ├── 시작 시간
        │   │   ├── 메시지 수
        │   │   ├── 카테고리 뱃지
        │   │   ├── 상태 아이콘
        │   │   └── 첫 질문 미리보기
        │   └── <Pagination />           # 페이지네이션
        │
        ├── <SessionDetail>              # 세션 상세
        │   ├── <SessionHeader />        # 세션 요약 정보
        │   │   ├── 세션ID, 시작시간
        │   │   ├── 메시지 수, 평균 응답시간
        │   │   ├── 카테고리 뱃지 목록
        │   │   └── [JSON 내보내기] [삭제] 버튼
        │   └── <ConversationView />     # 대화 내역 (핵심 컴포넌트)
        │       ├── <UserMessage />      # 👤 고객 메시지 (좌측)
        │       │   ├── 타임스탬프
        │       │   ├── 메시지 내용
        │       │   └── 카테고리 태그
        │       └── <BotMessage />       # 🤖 봇 메시지 (우측)
        │           ├── 타임스탬프
        │           ├── 메시지 내용
        │           ├── 응답시간 뱃지
        │           ├── 토큰 사용량
        │           └── 카테고리 태그
        │
        └── <UnresolvedList>             # 미해결 질문
            ├── <UnresolvedItem />       # 미해결 건별 카드
            │   ├── 고객 질문
            │   ├── 봇 응답
            │   ├── 타임스탬프
            │   └── [세션 보기] 링크
            └── <Pagination />
```

### 3.3 ConversationView 상세 설계 (핵심 컴포넌트)

화자별 분리 표시의 핵심 컴포넌트:

```
┌──────────────────────────────────────────────────────────────┐
│ ConversationView                                              │
│                                                               │
│  messages.map(msg => {                                        │
│    if (msg.role === 'user')                                   │
│      return <UserMessage>                                     │
│        ┌─ 좌측 정렬                                           │
│        ├─ 👤 아바타 + "고객" 라벨                              │
│        ├─ 말풍선 (회색 배경, 좌하단 꼬리)                       │
│        ├─ 타임스탬프 (10:30:05)                                │
│        └─ 카테고리 태그 [개통]                                  │
│                                                               │
│    if (msg.role === 'bot')                                    │
│      return <BotMessage>                                      │
│        ┌─ 우측 정렬                                           │
│        ├─ 🤖 아바타 + "봇" 라벨                               │
│        ├─ 말풍선 (핑크 배경, 우하단 꼬리)                       │
│        ├─ 타임스탬프 (10:30:08)                                │
│        ├─ 메타 정보 바                                         │
│        │   ├─ ⏱ 응답시간: 2.3초                               │
│        │   ├─ 📊 토큰: 850 → 230                              │
│        │   └─ 🏷 카테고리: [개통]                              │
│        └─ 미해결 경고 (해당 시) ⚠️ 답변 불가 건                 │
│  })                                                           │
│                                                               │
└──────────────────────────────────────────────────────────────┘
```

#### 색상 체계

| 요소 | 색상 | 용도 |
|------|------|------|
| 고객 메시지 배경 | `#f0f0f0` (밝은 회색) | 고객 말풍선 |
| 봇 메시지 배경 | `#fce4ec` (밝은 핑크) | 봇 말풍선 (프리티 브랜드) |
| 카테고리 뱃지 | 카테고리별 색상 | 시각적 구분 |
| 미해결 경고 | `#ff9800` (주황) | 주의 환기 |
| 에러 메시지 | `#f44336` (빨강) | 오류 표시 |

#### 카테고리 뱃지 색상

```
opening  → #2196f3 (파랑)    "개통"
product  → #4caf50 (초록)    "요금제"
terms    → #9c27b0 (보라)    "약관"
cs       → #ff9800 (주황)    "고객센터"
general  → #607d8b (회색)    "일반"
error    → #f44336 (빨강)    "오류"
```

### 3.4 대시보드 차트 설계

#### 카테고리 분포 (도넛 차트)

```
    ┌───────────┐
    │           │
    │  개통 30% │──── 파랑 (#2196f3)
    │  요금 25% │──── 초록 (#4caf50)
    │  약관  8% │──── 보라 (#9c27b0)
    │  고객 13% │──── 주황 (#ff9800)
    │  일반 24% │──── 회색 (#607d8b)
    │           │
    └───────────┘
```

#### 시간대별 추이 (바 차트)

```
 상담 수
  15 │      ▓▓
  12 │   ▓▓ ▓▓ ▓▓
   9 │   ▓▓ ▓▓ ▓▓ ▓▓
   6 │▓▓ ▓▓ ▓▓ ▓▓ ▓▓ ▓▓
   3 │▓▓ ▓▓ ▓▓ ▓▓ ▓▓ ▓▓ ▓▓
   0 └──────────────────────
     9  10  11  12  13  14  15  16  17  (시)
```

---

## 4. 상태 관리 설계 (Frontend)

### 4.1 useAdmin 훅 설계

```
useAdmin()
├── auth
│   ├── token (string | null)
│   ├── isAuthenticated (boolean)
│   ├── login(password) → Promise
│   └── logout()
│
├── sessions
│   ├── list (Session[])
│   ├── pagination ({ page, total, totalPages })
│   ├── isLoading (boolean)
│   ├── fetchSessions(filters) → Promise
│   └── deleteSession(id) → Promise
│
├── currentSession
│   ├── data (SessionDetail | null)
│   ├── isLoading (boolean)
│   └── fetchSession(id) → Promise
│
└── stats
    ├── overview (StatsOverview | null)
    ├── isLoading (boolean)
    └── fetchStats() → Promise
```

### 4.2 인증 상태 유지

```
로그인 성공 → JWT를 localStorage에 저장
페이지 로드 → localStorage에서 토큰 확인
  ├── 토큰 있음 → API 호출 시 Authorization 헤더 첨부
  │   └── 401 응답 시 → 로그인 페이지로 리다이렉트
  └── 토큰 없음 → 로그인 페이지 표시
로그아웃 → localStorage에서 토큰 삭제
```

---

## 5. 구현 순서

```
Phase 1: 저장 시스템 (Day 1)
  1-1. conversationStore.js 생성 (init, saveMessage, createSession)
  1-2. aiService.js 수정 (saveMessage 호출 추가)
  1-3. 저장 동작 확인 (채팅 → JSON 파일 생성 확인)

Phase 2: 관리자 API (Day 2)
  2-1. adminAuth.js 미들웨어 생성
  2-2. admin.js 라우트 생성 (login, sessions, stats)
  2-3. app.js에 admin 라우트 등록
  2-4. API 동작 확인 (curl 테스트)

Phase 3: 관리자 Frontend - 기본 (Day 3)
  3-1. admin/ React 앱 생성 (Vite)
  3-2. LoginPage 구현
  3-3. AdminLayout + Sidebar 구현
  3-4. SessionList + SessionDetail(ConversationView) 구현

Phase 4: 관리자 Frontend - 고급 (Day 4)
  4-1. Dashboard (통계 카드 + 차트)
  4-2. SearchFilters (검색/필터)
  4-3. UnresolvedList (미해결 질문)
  4-4. ExportPage (내보내기)

Phase 5: 통합 테스트 (Day 5)
  5-1. 전체 플로우 테스트 (채팅 → 저장 → 관리자 조회)
  5-2. 스타일 보정 + 반응형 확인
  5-3. 보안 점검 (인증 우회 불가 확인)
```

---

## 6. 환경변수 추가

```env
# backend/.env (추가)
ADMIN_PASSWORD=freet_admin_2026
JWT_SECRET=your-random-secret-key-here
```

---

## 7. 의존성 추가

```json
// backend/package.json에 추가
"jsonwebtoken": "^9.0.2",
"uuid": "^11.1.0"

// admin/package.json (신규)
"react": "^19.0.0",
"react-dom": "^19.0.0",
"react-router-dom": "^7.4.0",
"recharts": "^2.15.0",
"date-fns": "^4.1.0"
```
