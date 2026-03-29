import { useState, useRef, useCallback } from 'react';

const API_URL = '/api';

export function useChat() {
  const [messages, setMessages] = useState([
    {
      role: 'bot',
      content: '안녕하세요! 프리티 셀프개통 상담 AI입니다 😊\n\n궁금한 점을 물어보시거나, 아래 자주 묻는 질문을 선택해주세요!',
      quickButtons: [
        '셀프개통 방법',
        '요금제 추천',
        '준비물 확인',
        '고객센터 연결',
        '유심/eSIM 안내',
        '번호이동 방법'
      ]
    }
  ]);
  const [isLoading, setIsLoading] = useState(false);
  const sessionIdRef = useRef(`session_${Date.now()}`);

  const sendMessage = useCallback(async (text) => {
    if (!text.trim() || isLoading) return;

    setMessages(prev => [...prev, { role: 'user', content: text }]);
    setIsLoading(true);

    try {
      const res = await fetch(`${API_URL}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, sessionId: sessionIdRef.current })
      });

      const data = await res.json();
      sessionIdRef.current = data.sessionId || sessionIdRef.current;

      setMessages(prev => [...prev, {
        role: 'bot',
        content: data.reply,
        quickButtons: data.quickButtons || [],
        messageId: data.messageId || null,
        qualityScore: data.qualityScore || null,
        feedback: null
      }]);
    } catch {
      setMessages(prev => [...prev, {
        role: 'bot',
        content: '죄송합니다. 연결에 문제가 발생했습니다.\n\n고객센터: SKT 1661-2207 / KT 1577-4551 / U+ 1588-3615',
        quickButtons: ['다시 시도']
      }]);
    } finally {
      setIsLoading(false);
    }
  }, [isLoading]);

  const sendFeedback = useCallback(async (messageId, feedback) => {
    try {
      await fetch(`${API_URL}/chat/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageId, feedback })
      });
      // UI에 피드백 상태 반영
      setMessages(prev => prev.map(m =>
        m.messageId === messageId ? { ...m, feedback } : m
      ));
    } catch { /* 무시 */ }
  }, []);

  return { messages, isLoading, sendMessage, sendFeedback };
}
