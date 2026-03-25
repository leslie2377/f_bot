import React, { useEffect, useState } from 'react';
import { useSessions } from '../hooks/useAdmin.js';

const CAT_LABELS = { opening: '개통', product: '요금제', terms: '약관', cs: '고객센터', general: '일반' };

function SessionList({ onSelectSession }) {
  const { list, pagination, isLoading, fetchSessions } = useSessions();
  const [filters, setFilters] = useState({ page: 1, search: '', category: '', status: '', sort: 'latest' });

  useEffect(() => { fetchSessions(filters); }, [filters, fetchSessions]);

  const updateFilter = (key, value) => setFilters(prev => ({ ...prev, [key]: value, page: 1 }));

  const formatTime = (iso) => {
    if (!iso) return '-';
    const d = new Date(iso);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    const time = d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
    return isToday ? `오늘 ${time}` : `${d.getMonth() + 1}/${d.getDate()} ${time}`;
  };

  return (
    <div className="session-list-page">
      <h2 className="page-title">세션 목록</h2>

      <div className="filters-bar">
        <input
          type="text"
          placeholder="메시지 검색..."
          value={filters.search}
          onChange={(e) => updateFilter('search', e.target.value)}
          className="filter-input"
        />
        <select value={filters.category} onChange={(e) => updateFilter('category', e.target.value)} className="filter-select">
          <option value="">전체 카테고리</option>
          <option value="opening">개통</option>
          <option value="product">요금제</option>
          <option value="terms">약관</option>
          <option value="cs">고객센터</option>
          <option value="general">일반</option>
        </select>
        <select value={filters.status} onChange={(e) => updateFilter('status', e.target.value)} className="filter-select">
          <option value="">전체 상태</option>
          <option value="active">진행 중</option>
          <option value="completed">완료</option>
          <option value="unresolved">미해결</option>
        </select>
        <select value={filters.sort} onChange={(e) => updateFilter('sort', e.target.value)} className="filter-select">
          <option value="latest">최신순</option>
          <option value="oldest">오래된순</option>
          <option value="messages">메시지 많은순</option>
        </select>
      </div>

      {isLoading ? (
        <div className="loading">로딩 중...</div>
      ) : list.length === 0 ? (
        <div className="no-data">세션이 없습니다.</div>
      ) : (
        <>
          <table className="session-table">
            <thead>
              <tr>
                <th>시작 시간</th>
                <th>첫 질문</th>
                <th>메시지</th>
                <th>카테고리</th>
                <th>상태</th>
                <th>응답시간</th>
              </tr>
            </thead>
            <tbody>
              {list.map((s) => (
                <tr key={s.sessionId} onClick={() => onSelectSession(s.sessionId)} className="session-row">
                  <td className="time-cell">{formatTime(s.startedAt)}</td>
                  <td className="question-cell">{s.firstUserMessage || '-'}</td>
                  <td className="count-cell">
                    <span className="msg-count">{s.messageCount}</span>
                    <span className="msg-detail">({s.userMessageCount}↔{s.botMessageCount})</span>
                  </td>
                  <td>
                    {s.categories.map(c => (
                      <span key={c} className={`cat-badge cat-${c}`}>{CAT_LABELS[c] || c}</span>
                    ))}
                    {s.categories.length === 0 && <span className="cat-badge cat-general">일반</span>}
                  </td>
                  <td>
                    {s.hasUnresolved ? <span className="status-badge unresolved">⚠️ 미해결</span>
                      : s.status === 'active' ? <span className="status-badge active">🟢 진행중</span>
                      : <span className="status-badge completed">✅ 완료</span>}
                  </td>
                  <td>{s.avgResponseTimeMs ? `${(s.avgResponseTimeMs / 1000).toFixed(1)}s` : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="pagination">
            <button disabled={pagination.page <= 1} onClick={() => setFilters(p => ({ ...p, page: p.page - 1 }))}>← 이전</button>
            <span>{pagination.page} / {pagination.totalPages} ({pagination.total}건)</span>
            <button disabled={pagination.page >= pagination.totalPages} onClick={() => setFilters(p => ({ ...p, page: p.page + 1 }))}>다음 →</button>
          </div>
        </>
      )}
    </div>
  );
}

export default SessionList;
