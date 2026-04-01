import { useState, useRef, useCallback } from 'react';

const API_URL = '/api';

export function useChat() {
  const [messages, setMessages] = useState([
    {
      role: 'bot',
      content: '안녕하세요, 고객님!\n고객님의 편리한 친구 프리티 챗봇입니다.\n무엇을 도와드릴까요?',
      menuGrid: [
        { icon: '📱', label: '요금제 추천', value: '요금제 추천해주세요' },
        { icon: '🔄', label: '셀프개통', value: '셀프개통 절차 안내해주세요' },
        { icon: '📋', label: '요금제 보기', value: '저렴한 후불 요금제 보기' },
        { icon: '💳', label: '요금조회/납부', value: '요금 납부 방법 알려주세요' },
        { icon: '📞', label: '고객센터', value: '고객센터 연락처 알려주세요' },
        { icon: '💬', label: '유심/eSIM', value: '유심 eSIM 안내해주세요' },
        { icon: '🔀', label: '번호이동', value: '번호이동 방법 알려주세요' },
        { icon: '📄', label: '약관/정책', value: '약관 및 정책 안내해주세요' },
        { icon: '📦', label: '준비물 확인', value: '셀프개통 준비물 알려주세요' },
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
        options: data.options || null,
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
