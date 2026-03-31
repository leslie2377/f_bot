import React, { useState, useRef, useEffect } from 'react';
import { useChat } from '../hooks/useChat.js';
import '../styles/chat.css';

function ChatWidget() {
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState('');
  const { messages, isLoading, sendMessage, sendFeedback } = useChat();
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
                <div className="message-bubble-wrap">
                  <div className={`message-bubble ${msg.role}`}>
                    <MessageContent content={msg.content} />
                  </div>
                  {msg.role === 'bot' && msg.messageId && (
                    <div className="feedback-buttons">
                      <button
                        className={`feedback-btn ${msg.feedback === 'good' ? 'active' : ''}`}
                        onClick={() => sendFeedback(msg.messageId, 'good')}
                        disabled={!!msg.feedback}
                      >👍</button>
                      <button
                        className={`feedback-btn ${msg.feedback === 'bad' ? 'active bad' : ''}`}
                        onClick={() => sendFeedback(msg.messageId, 'bad')}
                        disabled={!!msg.feedback}
                      >👎</button>
                    </div>
                  )}
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

            {/* 선택 옵션 (요금제 추천 대화) */}
            {!isLoading && messages.length > 0 && messages[messages.length - 1].options && (
              <OptionSelector
                options={messages[messages.length - 1].options}
                onSubmit={(text) => sendMessage(text)}
              />
            )}

            {/* 빠른 질문 버튼 */}
            {!isLoading && messages.length > 0 && messages[messages.length - 1].quickButtons && !messages[messages.length - 1].options && (
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
  const blocks = parseBlocks(content);

  // 연속 테이블을 카드 그룹으로 묶기
  const grouped = [];
  let tableGroup = [];
  blocks.forEach((block, i) => {
    if (block.type === 'table') {
      tableGroup.push(block);
    } else {
      if (tableGroup.length > 1) {
        grouped.push({ type: 'card-slider', tables: [...tableGroup] });
        tableGroup = [];
      } else if (tableGroup.length === 1) {
        grouped.push(tableGroup[0]);
        tableGroup = [];
      }
      grouped.push(block);
    }
  });
  if (tableGroup.length > 1) grouped.push({ type: 'card-slider', tables: tableGroup });
  else if (tableGroup.length === 1) grouped.push(tableGroup[0]);

  return (
    <div>
      {grouped.map((block, i) => {
        if (block.type === 'card-slider') return <CardSlider key={i} tables={block.tables} />;
        if (block.type === 'table') return <ChatTable key={i} headers={block.headers} rows={block.rows} />;
        if (block.type === 'line') return <div key={i} style={{ minHeight: block.text === '' ? '8px' : 'auto' }}>{processLine(block.text)}</div>;
        return null;
      })}
    </div>
  );
}

// 마크다운 테이블 감지 및 블록 파싱
function parseBlocks(content) {
  const lines = content.split('\n');
  const blocks = [];
  let i = 0;

  while (i < lines.length) {
    // 테이블 감지: | 로 시작하는 연속 라인
    if (lines[i].trim().startsWith('|') && lines[i].includes('|', 1)) {
      const tableLines = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        tableLines.push(lines[i]);
        i++;
      }
      if (tableLines.length >= 2) {
        const headers = tableLines[0].split('|').filter(c => c.trim()).map(c => c.trim());
        // 구분선(---|---) 스킵
        const startRow = tableLines[1].includes('---') ? 2 : 1;
        const rows = tableLines.slice(startRow).map(line =>
          line.split('|').filter(c => c.trim()).map(c => c.trim())
        );
        blocks.push({ type: 'table', headers, rows });
      } else {
        tableLines.forEach(l => blocks.push({ type: 'line', text: l }));
      }
    } else {
      blocks.push({ type: 'line', text: lines[i] });
      i++;
    }
  }
  return blocks;
}

// 카드 슬라이더 (좌우 스와이프)
function CardSlider({ tables }) {
  const [current, setCurrent] = React.useState(0);
  const total = tables.length;

  return (
    <div className="card-slider">
      <div className="card-slider-header">
        <button className="card-nav-btn" disabled={current <= 0} onClick={() => setCurrent(c => c - 1)}>◀</button>
        <span className="card-counter">{current + 1} / {total}</span>
        <button className="card-nav-btn" disabled={current >= total - 1} onClick={() => setCurrent(c => c + 1)}>▶</button>
      </div>
      <div className="card-slider-track" style={{ transform: `translateX(-${current * 100}%)` }}>
        {tables.map((t, i) => (
          <div key={i} className="card-slide">
            <ChatTable headers={t.headers} rows={t.rows} />
          </div>
        ))}
      </div>
      <div className="card-dots">
        {tables.map((_, i) => (
          <span key={i} className={`card-dot ${i === current ? 'active' : ''}`} onClick={() => setCurrent(i)} />
        ))}
      </div>
    </div>
  );
}

// 테이블 컴포넌트
function ChatTable({ headers, rows }) {
  return (
    <div className="chat-table-wrap">
      <table className="chat-table">
        <thead>
          <tr>{headers.map((h, i) => <th key={i}>{processCell(h)}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri}>{row.map((cell, ci) => <td key={ci}>{processCell(cell)}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// 테이블 셀 처리: <br> 줄바꿈 + 마크다운 인라인
function processCell(text) {
  if (typeof text !== 'string') return text;
  // <br> 또는 <br/> → 줄바꿈 분리
  const lines = text.split(/<br\s*\/?>/gi);
  if (lines.length <= 1) return processLine(text);
  return lines.map((line, i) => (
    <React.Fragment key={i}>
      {i > 0 && <br />}
      <span>{processLine(line.trim())}</span>
    </React.Fragment>
  ));
}

// 선택 옵션 컴포넌트
function OptionSelector({ options, onSubmit }) {
  const [selected, setSelected] = React.useState({});

  const handleSelect = (groupIdx, item) => {
    setSelected(prev => ({ ...prev, [groupIdx]: item }));
  };

  const handleSubmit = () => {
    const values = Object.values(selected);
    if (values.length === 0) return;
    const text = values.map(v => v.value).join(', ');
    onSubmit(text);
  };

  const selectedCount = Object.keys(selected).length;

  return (
    <div className="option-selector">
      {options.map((group, gi) => (
        <div key={gi} className="option-group">
          <div className="option-title">{group.title}</div>
          <div className="option-items">
            {group.items.map((item, ii) => (
              <button
                key={ii}
                className={`option-btn ${selected[gi]?.label === item.label ? 'selected' : ''}`}
                onClick={() => handleSelect(gi, item)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
      ))}
      {selectedCount > 0 && (
        <div className="option-summary">
          <div className="option-selected-text">
            {Object.entries(selected).map(([gi, item]) => (
              <span key={gi} className="option-chip">{options[gi].title.replace(/[📞📊💰📡]/g,'').trim()}: {item.label}</span>
            ))}
          </div>
          <button className="option-submit" onClick={handleSubmit}>
            {selectedCount >= 2 ? '🔍 맞춤 요금제 검색' : '선택을 더 해주세요'}
          </button>
        </div>
      )}
    </div>
  );
}

// 인라인 마크다운 처리 (링크 + tel링크 + 볼드 + 전화번호 자동감지)
function processLine(line) {
  if (typeof line !== 'string') return line;

  // 마크다운 링크: [텍스트](URL) 또는 [텍스트](tel:번호)
  const combined = line
    .replace(/\[([^\]]+)\]\(((?:https?:\/\/|tel:)[^)]+)\)/g, '___LINK[$1]($2)___');

  const segments = combined.split(/(___LINK\[.*?\]\(.*?\)___)/g);

  return segments.map((seg, idx) => {
    const linkMatch = seg.match(/___LINK\[(.*?)\]\((.*?)\)___/);
    if (linkMatch) {
      const href = linkMatch[2];
      const isTel = href.startsWith('tel:');
      return (
        <a key={idx} href={href}
          target={isTel ? '_self' : '_blank'}
          rel={isTel ? undefined : 'noopener noreferrer'}
          className={isTel ? 'tel-link' : 'web-link'}>
          {isTel ? '📞 ' : ''}{linkMatch[1]}
        </a>
      );
    }

    // 볼드 처리 + 전화번호 자동 감지 (마크다운 링크가 아닌 일반 텍스트)
    const boldParts = seg.split(/\*\*(.*?)\*\*/g);
    return boldParts.map((part, j) => {
      if (j % 2 === 1) return <strong key={`${idx}-${j}`}>{part}</strong>;
      // 전화번호 패턴 자동 감지 (1661-2207, 1577-4551, 114 등)
      return autoLinkPhones(part, idx, j);
    });
  });
}

// 텍스트 내 전화번호를 자동으로 tel: 링크로 변환
function autoLinkPhones(text, idx, j) {
  const phoneRegex = /((?:0\d{1,2}-?\d{3,4}-?\d{4})|(?:1\d{3}-\d{4})|(?:15\d{2}-\d{4})|(?:16\d{2}-\d{4})|(?:18\d{2}-\d{4}))/g;
  const parts = text.split(phoneRegex);

  if (parts.length <= 1) return text;

  return parts.map((p, pi) => {
    if (phoneRegex.test(p)) {
      // 리셋 lastIndex
      phoneRegex.lastIndex = 0;
    }
    const clean = p.replace(/-/g, '');
    if (/^(0\d{8,10}|1\d{7})$/.test(clean)) {
      return (
        <a key={`${idx}-${j}-${pi}`} href={`tel:${p}`} className="tel-link">
          📞 {p}
        </a>
      );
    }
    return p;
  });
}

export default ChatWidget;
