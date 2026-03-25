import React, { useState, useRef, useEffect } from 'react';
import { useChat } from '../hooks/useChat.js';
import '../styles/chat.css';

function ChatWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState('');
  const { messages, isLoading, sendMessage } = useChat();
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  useEffect(() => {
    if (isOpen) inputRef.current?.focus();
  }, [isOpen]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!input.trim()) return;
    sendMessage(input);
    setInput('');
  };

  const handleQuickButton = (text) => {
    sendMessage(text);
  };

  return (
    <div className="chat-widget">
      {/* 채팅 패널 */}
      {isOpen && (
        <div className="chat-panel">
          {/* 헤더 */}
          <div className="chat-header">
            <div className="chat-header-info">
              <div className="chat-header-avatar">🤖</div>
              <div>
                <div className="chat-header-title">프리티 상담봇</div>
                <div className="chat-header-subtitle">셀프개통 전문 AI 상담</div>
              </div>
            </div>
            <button className="chat-close-btn" onClick={() => setIsOpen(false)}>✕</button>
          </div>

          {/* 메시지 영역 */}
          <div className="chat-messages">
            {messages.map((msg, idx) => (
              <div key={idx} className={`chat-message ${msg.role}`}>
                {msg.role === 'bot' && <div className="bot-avatar">🤖</div>}
                <div className={`message-bubble ${msg.role}`}>
                  <MessageContent content={msg.content} />
                </div>
              </div>
            ))}

            {/* 로딩 표시 */}
            {isLoading && (
              <div className="chat-message bot">
                <div className="bot-avatar">🤖</div>
                <div className="message-bubble bot loading-bubble">
                  <div className="typing-indicator">
                    <span></span><span></span><span></span>
                  </div>
                </div>
              </div>
            )}

            {/* 빠른 질문 버튼 */}
            {!isLoading && messages.length > 0 && messages[messages.length - 1].quickButtons && (
              <div className="quick-buttons">
                {messages[messages.length - 1].quickButtons.map((btn, idx) => (
                  <button key={idx} className="quick-btn" onClick={() => handleQuickButton(btn)}>
                    {btn}
                  </button>
                ))}
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* 입력 영역 */}
          <form className="chat-input-area" onSubmit={handleSubmit}>
            <input
              ref={inputRef}
              type="text"
              className="chat-input"
              placeholder="궁금한 점을 물어보세요..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={isLoading}
            />
            <button type="submit" className="chat-send-btn" disabled={isLoading || !input.trim()}>
              ➤
            </button>
          </form>
        </div>
      )}

      {/* 플로팅 버튼 */}
      <button
        className={`floating-btn ${isOpen ? 'open' : ''}`}
        onClick={() => setIsOpen(!isOpen)}
      >
        {isOpen ? '✕' : '💬'}
      </button>
    </div>
  );
}

function MessageContent({ content }) {
  const lines = content.split('\n');
  return (
    <div>
      {lines.map((line, i) => {
        // 링크 + 볼드 처리
        const processed = processLine(line);
        return (
          <div key={i} style={{ minHeight: line === '' ? '8px' : 'auto' }}>
            {processed}
          </div>
        );
      })}
    </div>
  );
}

// 마크다운 링크 + 볼드 처리
function processLine(line) {
  // [텍스트](URL) 패턴을 링크로 변환
  const linkRegex = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g;
  const boldRegex = /\*\*(.*?)\*\*/g;

  const parts = [];
  let lastIndex = 0;
  let match;

  // 링크 먼저 처리
  const combined = line.replace(linkRegex, '___LINK[$1]($2)___');
  const segments = combined.split(/(___LINK\[.*?\]\(.*?\)___)/g);

  return segments.map((seg, idx) => {
    const linkMatch = seg.match(/___LINK\[(.*?)\]\((.*?)\)___/);
    if (linkMatch) {
      return (
        <a key={idx} href={linkMatch[2]} target="_blank" rel="noopener noreferrer"
          style={{ color: '#f0543a', textDecoration: 'underline', fontWeight: 600 }}>
          {linkMatch[1]}
        </a>
      );
    }
    // 볼드 처리
    const boldParts = seg.split(/\*\*(.*?)\*\*/g);
    return boldParts.map((part, j) =>
      j % 2 === 1 ? <strong key={`${idx}-${j}`}>{part}</strong> : part
    );
  });
}

export default ChatWidget;
