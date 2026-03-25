import React, { useEffect } from 'react';
import { useUnresolved } from '../hooks/useAdmin.js';

function UnresolvedList({ onSelectSession }) {
  const { items, total, isLoading, fetchUnresolved } = useUnresolved();

  useEffect(() => { fetchUnresolved(); }, [fetchUnresolved]);

  const formatTime = (iso) => {
    const d = new Date(iso);
    return d.toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="unresolved-page">
      <h2 className="page-title">미해결 질문 ({total}건)</h2>

      {isLoading ? (
        <div className="loading">로딩 중...</div>
      ) : items.length === 0 ? (
        <div className="no-data success">모든 질문이 해결되었습니다! 🎉</div>
      ) : (
        <div className="unresolved-list">
          {items.map((item, idx) => (
            <div key={idx} className="unresolved-card" onClick={() => onSelectSession(item.sessionId)}>
              <div className="unresolved-header">
                <span className="unresolved-time">{formatTime(item.timestamp)}</span>
                <span className="cat-badge cat-general">{item.category}</span>
              </div>
              <div className="unresolved-question">
                <span className="role-icon">👤</span>
                <span>{item.userMessage}</span>
              </div>
              <div className="unresolved-answer">
                <span className="role-icon">🤖</span>
                <span className="unresolved-text">{item.botResponse}</span>
              </div>
              <div className="unresolved-action">세션 상세 보기 →</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default UnresolvedList;
