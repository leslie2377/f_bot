import { useState, useRef, useCallback } from 'react';

const API_URL = '/api';

export function useChat() {
  const [messages, setMessages] = useState([
    {
      role: 'bot',
      content: '안녕하세요! 프리티 셀프개통 상담 AI입니다 😊\n\n셀프개통, 요금제, 약관 등 궁금한 점을 물어보세요!',
      quickButtons: ['셀프개통 방법', '요금제 보기', '고객센터 연결']
    }
  ]);
  const [isLoading, setIsLoading] = useState(false);
  const sessionIdRef = useRef(`session_${Date.now()}`);

  const sendMessage = useCallback(async (text) => {
    if (!text.trim() || isLoading) return;

    const userMessage = { role: 'user', content: text };
    setMessages(prev => [...prev, userMessage]);
    setIsLoading(true);

    try {
      const res = await fetch(`${API_URL}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          sessionId: sessionIdRef.current
        })
      });

      const data = await res.json();
      sessionIdRef.current = data.sessionId || sessionIdRef.current;

      setMessages(prev => [...prev, {
        role: 'bot',
        content: data.reply,
        quickButtons: data.quickButtons || []
      }]);
    } catch {
      setMessages(prev => [...prev, {
        role: 'bot',
        content: '죄송합니다. 연결에 문제가 발생했습니다. 잠시 후 다시 시도해주세요.\n\n고객센터: SKT 1661-2207 / KT 1577-4551 / U+ 1588-3615',
        quickButtons: ['다시 시도']
      }]);
    } finally {
      setIsLoading(false);
    }
  }, [isLoading]);

  return { messages, isLoading, sendMessage };
}
