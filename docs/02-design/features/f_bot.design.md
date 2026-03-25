# Design: f_bot - 프리텔레콤 셀프개통 상담 챗봇

## Executive Summary

| 항목 | 내용 |
|------|------|
| Feature | 프리텔레콤(프리티) 셀프개통 AI 상담 챗봇 |
| Plan 참조 | docs/01-plan/features/f_bot.plan.md |
| 작성일 | 2026-03-22 |

---

## 1. API 설계

### 1.1 채팅 API

```
POST /api/chat
Content-Type: application/json

Request:
{
  "message": "셀프개통 하려면 뭐가 필요해요?",
  "sessionId": "uuid-string"   // 대화 히스토리 관리
}

Response:
{
  "reply": "셀프개통을 위해서는 다음이 필요합니다:\n1. 신분증...",
  "category": "faq",
  "quickButtons": ["요금제 보기", "개통 절차", "고객센터"]
}
```

### 1.2 요금제 API

```
GET /api/products?network=skt&sort=price

Response:
{
  "products": [
    {
      "id": "plan_001",
      "name": "음성기본데이터5G",
      "network": "SKT",
      "monthlyFee": 2750,
      "data": "5GB",
      "voice": "무제한",
      "sms": "150건"
    }
  ],
  "total": 10
}
```

### 1.3 FAQ API

```
GET /api/faq?category=opening

Response:
{
  "faqs": [
    {
      "id": "faq_001",
      "category": "opening",
      "question": "셀프개통은 어떻게 하나요?",
      "answer": "..."
    }
  ]
}
```

---

## 2. 데이터 스키마

### 2.1 faq.json
```json
[
  {
    "id": "faq_001",
    "category": "opening|usim|plan|payment|cancel|etc",
    "question": "string",
    "answer": "string",
    "keywords": ["string"]
  }
]
```

### 2.2 products.json
```json
[
  {
    "id": "plan_001",
    "name": "string",
    "network": "SKT|KT|LGU",
    "monthlyFee": "number",
    "originalFee": "number|null",
    "data": "string",
    "voice": "string",
    "sms": "string",
    "promo": "boolean",
    "promoEndDate": "string|null",
    "partner": "string|null",
    "features": ["string"]
  }
]
```

### 2.3 terms.json
```json
[
  {
    "id": "term_001",
    "section": "string",
    "title": "string",
    "summary": "string",
    "details": "string"
  }
]
```

### 2.4 guide.json
```json
{
  "selfActivation": {
    "steps": [...],
    "requirements": {...},
    "hours": {...},
    "restrictions": {...},
    "troubleshooting": [...]
  },
  "customerService": {
    "skt": "1661-2207",
    "kt": "1577-4551",
    "lgu": "1588-3615",
    "complaint": "02-3489-7351"
  }
}
```

---

## 3. 컴포넌트 설계

### 3.1 Frontend 컴포넌트 트리

```
<App>
  └── <ChatWidget>
        ├── <FloatingButton />       // 채팅 열기/닫기 버튼
        └── <ChatPanel>              // 채팅 패널 (조건부 렌더링)
              ├── <ChatHeader />     // 헤더 (타이틀 + 닫기)
              ├── <MessageList>      // 메시지 영역
              │     ├── <BotMessage />
              │     └── <UserMessage />
              ├── <QuickButtons />   // 빠른 질문 버튼
              └── <ChatInput />      // 입력창 + 전송 버튼
```

### 3.2 Backend 모듈 구조

```
app.js (Express 진입점)
├── routes/
│   ├── chat.js          POST /api/chat
│   ├── products.js      GET /api/products
│   └── faq.js           GET /api/faq
├── services/
│   ├── aiService.js     Claude API 호출 + 프롬프트 관리
│   └── dataService.js   JSON 데이터 로드 + 검색
└── data/
    ├── faq.json
    ├── products.json
    ├── terms.json
    └── guide.json
```

---

## 4. AI 프롬프트 설계

### 4.1 System Prompt

```
당신은 프리텔레콤(프리티) 공식 셀프개통 상담 AI입니다.

역할:
- 프리텔레콤 셀프개통, 요금제, 약관에 대해 정확히 안내합니다.
- 제공된 데이터만을 기반으로 답변합니다.
- 모르는 내용은 고객센터를 안내합니다.

톤앤매너:
- 친절하고 전문적인 상담원 톤
- 존댓말 사용
- 핵심 정보를 먼저, 부가 설명은 뒤에

응답 규칙:
1. 요금제 질문 → products 데이터 기반 안내
2. 개통 절차 → guide 데이터 기반 단계별 안내
3. 약관 질문 → terms 데이터 기반 요약 설명
4. FAQ 질문 → faq 데이터 기반 답변
5. 답변 불가 → 고객센터 번호 안내
```

### 4.2 컨텍스트 주입

사용자 메시지와 함께 관련 데이터를 Claude API에 전달:
```
[System Prompt]
+ [관련 FAQ 데이터]
+ [요금제 데이터]
+ [약관 요약]
+ [개통 가이드]
+ [대화 히스토리 (최근 10턴)]
```

---

## 5. 구현 순서

1. 데이터 JSON 파일 작성
2. Backend: Express 서버 + 라우트 설정
3. Backend: Claude API 연동 (aiService)
4. Backend: 데이터 서비스 (dataService)
5. Frontend: 채팅 위젯 컴포넌트
6. Frontend ↔ Backend 연동
7. 스타일링 및 반응형 처리
