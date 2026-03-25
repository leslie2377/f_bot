const express = require('express');
const router = express.Router();
const { chat } = require('../services/aiService');

router.post('/', async (req, res) => {
  try {
    const { message, sessionId } = req.body;

    if (!message || !message.trim()) {
      return res.status(400).json({ error: '메시지를 입력해주세요.' });
    }

    const sid = sessionId || `session_${Date.now()}`;
    const { reply, category, source, tokensUsed } = await chat(message.trim(), sid);

    const quickButtons = getQuickButtons(category);

    res.json({ reply, category, sessionId: sid, quickButtons, source, tokensUsed });
  } catch (error) {
    console.error('Chat error:', error.message);
    res.status(500).json({
      reply: '죄송합니다. 일시적인 오류가 발생했습니다. 잠시 후 다시 시도해주세요.\n\n고객센터: SKT 1661-2207 / KT 1577-4551 / U+ 1588-3615',
      category: 'error'
    });
  }
});

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
