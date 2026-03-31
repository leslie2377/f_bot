import React, { useEffect, useState } from 'react';
import { useSessionDetail, useSessions } from '../hooks/useAdmin.js';

const API = '/api/admin';
const CAT_COLORS = { opening: '#2196f3', product: '#4caf50', terms: '#9c27b0', cs: '#ff9800', general: '#607d8b', error: '#f44336' };
const CAT_LABELS = { opening: '개통', product: '요금제', terms: '약관', cs: '고객센터', general: '일반', error: '오류' };

function SessionDetail({ sessionId, onBack }) {
  const { data, isLoading, fetchSession } = useSessionDetail();
  const { deleteSession } = useSessions();
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState('');
  const [editResult, setEditResult] = useState(null);
  const [addToFaq, setAddToFaq] = useState(false);

  // 새 답변 직접 등록
  const [showAddForm, setShowAddForm] = useState(false);
  const [addQuestion, setAddQuestion] = useState('');
  const [addReply, setAddReply] = useState('');
  const [addFaq, setAddFaq] = useState(true);
  const [addResult, setAddResult] = useState(null);

  const token = localStorage.getItem('admin_token');
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

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
    a.href = url; a.download = `${sessionId}.json`; a.click();
    URL.revokeObjectURL(url);
  };

  // 응답 수정
  const startEdit = (msg) => {
    setEditingId(msg.id);
    setEditText(msg.content);
    setEditResult(null);
    setAddToFaq(false);
  };

  const cancelEdit = () => { setEditingId(null); setEditText(''); setEditResult(null); };

  const submitCorrection = async () => {
    if (!editText.trim()) return;
    const res = await fetch(`${API}/messages/${editingId}/correct`, {
      method: 'POST', headers, body: JSON.stringify({ correctedReply: editText })
    });
    const result = await res.json();
    if (result.success) {
      // FAQ에도 등록
      if (addToFaq && result.userQuestion) {
        await fetch(`${API}/responses/add`, {
          method: 'POST', headers,
          body: JSON.stringify({ question: result.userQuestion, reply: editText, addToFaq: true })
        });
      }
      setEditResult({ success: true, faq: addToFaq });
      fetchSession(sessionId); // 새로고침
      setTimeout(() => { setEditingId(null); setEditResult(null); }, 2000);
    } else {
      setEditResult({ success: false, error: result.error });
    }
  };

  // 새 답변 직접 등록
  const submitNewResponse = async () => {
    if (!addQuestion.trim() || !addReply.trim()) return;
    const res = await fetch(`${API}/responses/add`, {
      method: 'POST', headers,
      body: JSON.stringify({ question: addQuestion, reply: addReply, addToFaq: addFaq })
    });
    const result = await res.json();
    setAddResult(result);
    if (result.success) {
      setAddQuestion(''); setAddReply('');
      setTimeout(() => setAddResult(null), 3000);
    }
  };

  const formatTime = (str) => {
    if (!str) return '-';
    const d = new Date(str.includes('T') ? str : str.replace(' ', 'T'));
    if (isNaN(d)) return str;
    return d.toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  const getStarted = () => data?.started_at || data?.startedAt || '';

  if (isLoading) return <div className="loading">로딩 중...</div>;
  if (!data) return <div className="no-data">세션을 찾을 수 없습니다.</div>;

  return (
    <div className="session-detail">
      <div className="detail-header">
        <button className="back-btn" onClick={onBack}>← 목록</button>
        <div className="detail-info">
          <h2>세션 상세</h2>
          <div className="detail-meta">
            <span>📅 {formatTime(getStarted())}</span>
            <span>💬 {data.stats?.totalMessages || 0}건</span>
            <span>⭐ 품질 {data.stats?.avgQuality || 0}점</span>
            {data.stats?.categories && Object.entries(data.stats.categories).map(([cat, count]) => (
              <span key={cat} className={`cat-badge cat-${cat}`}>{CAT_LABELS[cat] || cat} ({count})</span>
            ))}
          </div>
        </div>
        <div className="detail-actions">
          <button className="action-btn primary" onClick={() => setShowAddForm(!showAddForm)}>
            {showAddForm ? '닫기' : '✏️ 답변 등록'}
          </button>
          <button className="export-btn" onClick={handleExport}>📤 JSON</button>
          <button className="delete-btn" onClick={handleDelete}>🗑</button>
        </div>
      </div>

      {/* 답변 직접 등록 폼 */}
      {showAddForm && (
        <div className="correct-form" style={{ margin: '0 0 16px', background: '#fff3e0', borderRadius: 10, padding: 16 }}>
          <h4 style={{ margin: '0 0 10px', color: '#e65100' }}>✏️ 올바른 답변 직접 등록</h4>
          <input type="text" value={addQuestion} onChange={e => setAddQuestion(e.target.value)}
            placeholder="고객 질문 (예: 추천 요금제 알려줘)" className="filter-input" style={{ marginBottom: 8, width: '100%' }} />
          <textarea value={addReply} onChange={e => setAddReply(e.target.value)}
            placeholder="올바른 답변을 작성하세요..." className="add-textarea" rows={4} />
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 8 }}>
            <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 4 }}>
              <input type="checkbox" checked={addFaq} onChange={e => setAddFaq(e.target.checked)} /> FAQ + 벡터DB에도 등록
            </label>
            <button className="action-btn primary" onClick={submitNewResponse} disabled={!addQuestion.trim() || !addReply.trim()}>등록</button>
          </div>
          {addResult && (
            <div style={{ marginTop: 8, fontSize: 13, color: addResult.success ? '#4caf50' : '#f44336' }}>
              {addResult.success ? `✅ ${addResult.faqAdded ? '캐시 + FAQ + 벡터DB' : '캐시'} 반영 완료` : `❌ ${addResult.error}`}
            </div>
          )}
        </div>
      )}

      {/* 대화 내역 */}
      <div className="conversation-view">
        {data.messages.map((msg) => (
          <div key={msg.id} className={`conv-message ${msg.role}`}>
            <div className="conv-avatar">{msg.role === 'user' ? '👤' : '🤖'}</div>
            <div className="conv-bubble-wrap">
              <div className="conv-role-label">
                {msg.role === 'user' ? '고객' : '봇'}
                <span className="conv-time">{formatTime(msg.timestamp)}</span>
                {msg.role === 'bot' && msg.metadata?.qualityScore > 0 && (
                  <span style={{
                    fontSize: 11, fontWeight: 700, marginLeft: 6,
                    color: msg.metadata.qualityScore >= 80 ? '#4caf50' : msg.metadata.qualityScore >= 50 ? '#ff9800' : '#f44336'
                  }}>품질:{msg.metadata.qualityScore}</span>
                )}
                {msg.role === 'bot' && msg.metadata?.source && (
                  <span style={{ fontSize: 10, color: '#aaa', marginLeft: 4 }}>{msg.metadata.source}</span>
                )}
                {msg.metadata?.feedback && (
                  <span style={{ fontSize: 12, marginLeft: 4 }}>{msg.metadata.feedback === 'good' ? '👍' : '👎'}</span>
                )}
              </div>

              {/* 수정 모드 */}
              {editingId === msg.id ? (
                <div className="correct-form">
                  <textarea value={editText} onChange={e => setEditText(e.target.value)} className="add-textarea" rows={6} />
                  <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
                    <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 4 }}>
                      <input type="checkbox" checked={addToFaq} onChange={e => setAddToFaq(e.target.checked)} /> FAQ에도 등록
                    </label>
                    <button className="action-btn primary" onClick={submitCorrection}>저장 (즉시 반영)</button>
                    <button className="action-btn" style={{ background: '#eee', color: '#333' }} onClick={cancelEdit}>취소</button>
                  </div>
                  {editResult && (
                    <div style={{ marginTop: 6, fontSize: 13, color: editResult.success ? '#4caf50' : '#f44336' }}>
                      {editResult.success ? `✅ 수정 완료${editResult.faq ? ' + FAQ 등록' : ''}` : `❌ ${editResult.error}`}
                    </div>
                  )}
                </div>
              ) : (
                <>
                  <div className={`conv-bubble ${msg.role}`}>
                    <MessageContent content={msg.content} />
                  </div>
                  {msg.role === 'bot' && (
                    <div className="conv-meta">
                      {msg.metadata?.responseTimeMs > 0 && <span className="meta-tag">⏱ {(msg.metadata.responseTimeMs / 1000).toFixed(1)}초</span>}
                      <span className="meta-tag" style={{ background: CAT_COLORS[msg.metadata?.category] || '#607d8b', color: '#fff' }}>
                        {CAT_LABELS[msg.metadata?.category] || msg.metadata?.category}
                      </span>
                      <button className="correct-btn" onClick={() => startEdit(msg)}>✏️ 수정</button>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MessageContent({ content }) {
  const blocks = parseBlocks(content);
  return (
    <div>
      {blocks.map((block, i) => {
        if (block.type === 'table') return <AdminTable key={i} headers={block.headers} rows={block.rows} />;
        return <div key={i} style={{ minHeight: block.text === '' ? '8px' : 'auto' }}>{processInline(block.text)}</div>;
      })}
    </div>
  );
}

function parseBlocks(content) {
  const lines = content.split('\n');
  const blocks = [];
  let i = 0;
  while (i < lines.length) {
    if (lines[i].trim().startsWith('|') && lines[i].includes('|', 1)) {
      const tl = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) { tl.push(lines[i]); i++; }
      if (tl.length >= 2) {
        const headers = tl[0].split('|').filter(c => c.trim()).map(c => c.trim());
        const startRow = tl[1].includes('---') ? 2 : 1;
        const rows = tl.slice(startRow).map(l => l.split('|').filter(c => c.trim()).map(c => c.trim()));
        blocks.push({ type: 'table', headers, rows });
      } else { tl.forEach(l => blocks.push({ type: 'line', text: l })); }
    } else { blocks.push({ type: 'line', text: lines[i] }); i++; }
  }
  return blocks;
}

function AdminTable({ headers, rows }) {
  const cellRender = (text) => {
    if (typeof text !== 'string') return text;
    const lines = text.split(/<br\s*\/?>/gi);
    if (lines.length <= 1) return processInline(text);
    return lines.map((l, i) => <span key={i}>{i > 0 && <br />}{processInline(l.trim())}</span>);
  };
  return (
    <div style={{ overflow: 'auto', margin: '8px 0', borderRadius: 8, border: '1px solid #e0e0e0' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead><tr>{headers.map((h, i) => <th key={i} style={{ padding: '7px 10px', background: '#1a1a2e', color: '#fff', fontWeight: 700, textAlign: 'center', whiteSpace: 'nowrap' }}>{cellRender(h)}</th>)}</tr></thead>
        <tbody>{rows.map((row, ri) => (
          <tr key={ri} style={{ background: ri % 2 === 0 ? '#fff' : '#f8f8fc' }}>
            {row.map((cell, ci) => <td key={ci} style={{ padding: '6px 10px', borderBottom: '1px solid #eee', textAlign: ci === 0 ? 'left' : 'center', fontWeight: ci === 0 ? 600 : 400 }}>{cellRender(cell)}</td>)}
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function processInline(text) {
  if (typeof text !== 'string') return text;
  const combined = text.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '___LINK[$1]($2)___');
  return combined.split(/(___LINK\[.*?\]\(.*?\)___)/g).map((seg, idx) => {
    const m = seg.match(/___LINK\[(.*?)\]\((.*?)\)___/);
    if (m) return <a key={idx} href={m[2]} target="_blank" rel="noopener noreferrer" style={{ color: '#e91e63', textDecoration: 'underline' }}>{m[1]}</a>;
    return seg.split(/\*\*(.*?)\*\*/g).map((p, j) => j % 2 === 1 ? <strong key={`${idx}-${j}`}>{p}</strong> : p);
  });
}

export default SessionDetail;
