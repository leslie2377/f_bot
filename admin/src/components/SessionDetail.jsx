import React, { useEffect } from 'react';
import { useSessionDetail, useSessions } from '../hooks/useAdmin.js';

const CAT_COLORS = { opening: '#2196f3', product: '#4caf50', terms: '#9c27b0', cs: '#ff9800', general: '#607d8b', error: '#f44336' };
const CAT_LABELS = { opening: '개통', product: '요금제', terms: '약관', cs: '고객센터', general: '일반', error: '오류' };

function SessionDetail({ sessionId, onBack }) {
  const { data, isLoading, fetchSession } = useSessionDetail();
  const { deleteSession } = useSessions();

  useEffect(() => { if (sessionId) fetchSession(sessionId); }, [sessionId, fetchSession]);

  const handleDelete = async () => {
    if (!confirm('이 세션을 삭제하시겠습니까?')) return;
    await deleteSession(sessionId);
    onBack();
  };

  const handleExport = () => {
    if (!data) return;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${sessionId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const formatTime = (iso) => {
    const d = new Date(iso);
    return d.toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  if (isLoading) return <div className="loading">로딩 중...</div>;
  if (!data) return <div className="no-data">세션을 찾을 수 없습니다.</div>;

  return (
    <div className="session-detail">
      <div className="detail-header">
        <button className="back-btn" onClick={onBack}>← 목록</button>
        <div className="detail-info">
          <h2>세션 상세</h2>
          <div className="detail-meta">
            <span>📅 {formatTime(data.startedAt)}</span>
            <span>💬 메시지 {data.stats.totalMessages}건</span>
            <span>⏱ 평균 {(data.stats.avgResponseTimeMs / 1000).toFixed(1)}초</span>
            {Object.entries(data.stats.categories).map(([cat, count]) => (
              <span key={cat} className={`cat-badge cat-${cat}`}>{CAT_LABELS[cat] || cat} ({count})</span>
            ))}
          </div>
        </div>
        <div className="detail-actions">
          <button className="export-btn" onClick={handleExport}>📤 JSON</button>
          <button className="delete-btn" onClick={handleDelete}>🗑 삭제</button>
        </div>
      </div>

      <div className="conversation-view">
        {data.messages.map((msg) => (
          <div key={msg.id} className={`conv-message ${msg.role}`}>
            <div className="conv-avatar">
              {msg.role === 'user' ? '👤' : '🤖'}
            </div>
            <div className="conv-bubble-wrap">
              <div className="conv-role-label">
                {msg.role === 'user' ? '고객' : '봇'}
                <span className="conv-time">{formatTime(msg.timestamp)}</span>
              </div>
              <div className={`conv-bubble ${msg.role}`}>
                <MessageContent content={msg.content} />
              </div>
              {msg.role === 'bot' && (
                <div className="conv-meta">
                  {msg.metadata.responseTimeMs > 0 && (
                    <span className="meta-tag">⏱ {(msg.metadata.responseTimeMs / 1000).toFixed(1)}초</span>
                  )}
                  {msg.metadata.tokensUsed && (
                    <span className="meta-tag">📊 {msg.metadata.tokensUsed.input}→{msg.metadata.tokensUsed.output}</span>
                  )}
                  <span className="meta-tag" style={{ background: CAT_COLORS[msg.metadata.category] || '#607d8b', color: '#fff' }}>
                    {CAT_LABELS[msg.metadata.category] || msg.metadata.category}
                  </span>
                </div>
              )}
              {msg.role === 'user' && msg.metadata.category && msg.metadata.category !== 'general' && (
                <div className="conv-meta">
                  <span className="meta-tag" style={{ background: CAT_COLORS[msg.metadata.category] || '#607d8b', color: '#fff' }}>
                    {CAT_LABELS[msg.metadata.category] || msg.metadata.category}
                  </span>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MessageContent({ content }) {
  const lines = content.split('\n');
  return (
    <div>
      {lines.map((line, i) => {
        const segments = line.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '___LINK[$1]($2)___').split(/(___LINK\[.*?\]\(.*?\)___)/g);
        return (
          <div key={i} style={{ minHeight: line === '' ? '8px' : 'auto' }}>
            {segments.map((seg, idx) => {
              const m = seg.match(/___LINK\[(.*?)\]\((.*?)\)___/);
              if (m) return <a key={idx} href={m[2]} target="_blank" rel="noopener noreferrer" style={{ color: '#e91e63', textDecoration: 'underline' }}>{m[1]}</a>;
              return seg.split(/\*\*(.*?)\*\*/g).map((p, j) => j % 2 === 1 ? <strong key={`${idx}-${j}`}>{p}</strong> : p);
            })}
          </div>
        );
      })}
    </div>
  );
}

export default SessionDetail;
