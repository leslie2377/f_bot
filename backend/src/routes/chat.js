const express = require('express');
const router = express.Router();
const { chat } = require('../services/aiService');
const dbQ = require('../db/queries');

router.post('/', async (req, res) => {
  try {
    const { message, sessionId } = req.body;
    if (!message || !message.trim()) return res.status(400).json({ error: '메시지를 입력해주세요.' });

    const sid = sessionId || `session_${Date.now()}`;
    const { reply, category, source, tokensUsed, qualityScore, messageId } = await chat(message.trim(), sid);

    // 응답 내용 기반으로 선택 옵션 생성
    const options = detectOptions(reply, message);
    const quickButtons = options ? null : getQuickButtons(category);

    res.json({ reply, category, sessionId: sid, quickButtons, options, source, tokensUsed, qualityScore, messageId });
  } catch (error) {
    console.error('Chat error:', error.message, error.stack);
    res.status(500).json({
      reply: '죄송합니다. 일시적인 오류가 발생했습니다.\n\n고객센터: SKT 1661-2207 / KT 1577-4551 / U+ 1588-3615',
      category: 'error'
    });
  }
});

// 피드백 API
router.post('/feedback', (req, res) => {
  const { messageId, feedback } = req.body;
  if (!messageId || !['good', 'bad'].includes(feedback)) {
    return res.status(400).json({ error: 'messageId와 feedback(good/bad)이 필요합니다.' });
  }
  const updated = dbQ.saveFeedback(messageId, feedback);
  if (!updated) return res.status(404).json({ error: '메시지를 찾을 수 없습니다.' });
  res.json({ success: true });
});

// 봇 응답에서 선택 옵션 감지
function detectOptions(reply, userMessage) {
  const lower = reply.toLowerCase();

  // 통화량 질문 감지
  if (lower.includes('통화량') && lower.includes('데이터') && lower.includes('예산')) {
    return [
      {
        title: '📞 통화량',
        items: [
          { label: '거의 안함', value: '통화 거의 안해요' },
          { label: '100분 이하', value: '통화 100분 정도 써요' },
          { label: '300분', value: '통화 300분 정도 써요' },
          { label: '500분 이상', value: '통화 500분 이상 써요' },
          { label: '무제한', value: '통화 무제한이 필요해요' },
        ]
      },
      {
        title: '📊 데이터',
        items: [
          { label: '3GB 이하', value: '데이터 3GB면 충분해요' },
          { label: '5GB', value: '데이터 5GB 필요해요' },
          { label: '10GB', value: '데이터 10GB 필요해요' },
          { label: '15~20GB', value: '데이터 20GB 정도 써요' },
          { label: '50GB 이상', value: '데이터 50GB 이상 필요해요' },
          { label: '무제한', value: '데이터 무제한이 필요해요' },
        ]
      },
      {
        title: '💰 월 예산',
        items: [
          { label: '1만원 이하', value: '예산은 1만원 이하에요' },
          { label: '1~2만원', value: '예산은 2만원 정도에요' },
          { label: '2~3만원', value: '예산은 3만원 정도에요' },
          { label: '3~5만원', value: '예산은 5만원 정도에요' },
          { label: '상관없음', value: '예산은 상관없어요' },
        ]
      },
      {
        title: '📡 통신망',
        items: [
          { label: 'SKT', value: 'SKT 요금제로 부탁해요' },
          { label: 'KT', value: 'KT 요금제로 부탁해요' },
          { label: 'LG U+', value: 'LG U+ 요금제로 부탁해요' },
          { label: '상관없음', value: '통신망은 상관없어요' },
        ]
      }
    ];
  }

  return null;
}

function getQuickButtons(category) {
  const buttons = {
    opening: ['요금제 보기', '준비물 확인', '고객센터 연결'],
    product: ['셀프개통 방법', '통신망 비교', '고객센터 연결'],
    terms: ['셀프개통 방법', '요금제 보기', '고객센터 연결'],
    cs: ['셀프개통 방법', '요금제 보기', '자주묻는질문'],
    general: ['셀프개통 방법', '요금제 보기', '고객센터 연결'],
    error: ['다시 시도', '고객센터 연결']
  };
  return buttons[category] || buttons.general;
}

module.exports = router;
