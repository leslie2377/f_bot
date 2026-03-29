import React, { useEffect, useState } from 'react';
import { useSessions } from '../hooks/useAdmin.js';

const CAT_LABELS = { opening: '개통', product: '요금제', terms: '약관', cs: '고객센터', general: '일반', payment: '결제' };

function SessionList({ onSelectSession }) {
  const { list, pagination, isLoading, fetchSessions } = useSessions();
  const [filters, setFilters] = useState({ page: 1, search: '', category: '', status: '', sort: 'latest' });

  useEffect(() => { fetchSessions(filters); }, [filters, fetchSessions]);

  const updateFilter = (key, value) => setFilters(prev => ({ ...prev, [key]: value, page: 1 }));

  const formatTime = (str) => {
    if (!str) return '-';
    // DB에서 "2026-03-30 00:10:53" 형식으로 옴
    const d = new Date(str.replace(' ', 'T'));
    if (isNaN(d)) return str;
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    const time = d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
    return isToday ? `오늘 ${time}` : `${d.getMonth() + 1}/${d.getDate()} ${time}`;
  };

  // DB snake_case → 안전하게 접근
  const getId = (s) => s.session_id || s.sessionId;
  const getStarted = (s) => s.started_at || s.startedAt;
  const getFirstMsg = (s) => s.first_user_msg || s.firstUserMessage || '';
  const getMsgCount = (s) => s.message_count || s.messageCount || 0;
  const getUserCount = (s) => s.user_msg_count || s.userMessageCount || 0;
  const getBotCount = (s) => s.bot_msg_count || s.botMessageCount || 0;
  const getCategory = (s) => s.primary_category || s.primaryCategory || 'general';
  const getUnresolved = (s) => s.has_unresolved || s.hasUnresolved || 0;
  const getStatus = (s) => s.status || 'active';
  const getAvgMs = (s) => s.avg_response_ms || s.avgResponseTimeMs || 0;
  const getQuality = (s) => Math.round(s.avg_quality || s.avgQuality || 0);
  const getFbGood = (s) => s.feedback_good || 0;
  const getFbBad = (s) => s.feedback_bad || 0;

  return (
    <div className="session-list-page">
      <h2 className="page-title">세션 목록</h2>

      <div className="filters-bar">
        <input type="text" placeholder="메시지 검색..." value={filters.search}
          onChange={(e) => updateFilter('search', e.target.value)} className="filter-input" />
        <select value={filters.category} onChange={(e) => updateFilter('category', e.target.value)} className="filter-select">
          <option value="">전체 카테고리</option>
          <option value="opening">개통</option>
          <option value="product">요금제</option>
          <option value="terms">약관</option>
          <option value="cs">고객센터</option>
          <option value="payment">결제</option>
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
                <th>품질</th>
                <th>상태</th>
                <th>응답시간</th>
              </tr>
            </thead>
            <tbody>
              {list.map((s) => (
                <tr key={getId(s)} onClick={() => onSelectSession(getId(s))} className="session-row">
                  <td className="time-cell">{formatTime(getStarted(s))}</td>
                  <td className="question-cell">{getFirstMsg(s) || '-'}</td>
                  <td className="count-cell">
                    <span className="msg-count">{getMsgCount(s)}</span>
                    <span className="msg-detail">({getUserCount(s)}↔{getBotCount(s)})</span>
                  </td>
                  <td>
                    <span className={`cat-badge cat-${getCategory(s)}`}>{CAT_LABELS[getCategory(s)] || getCategory(s)}</span>
                  </td>
                  <td>
                    <span style={{
                      color: getQuality(s) >= 80 ? '#4caf50' : getQuality(s) >= 50 ? '#ff9800' : '#f44336',
                      fontWeight: 700, fontSize: 13
                    }}>{getQuality(s) || '-'}</span>
                    {getFbGood(s) > 0 && <span style={{ fontSize: 11, marginLeft: 4 }}>👍{getFbGood(s)}</span>}
                    {getFbBad(s) > 0 && <span style={{ fontSize: 11, marginLeft: 4 }}>👎{getFbBad(s)}</span>}
                  </td>
                  <td>
                    {getUnresolved(s) ? <span className="status-badge unresolved">⚠️ 미해결</span>
                      : getStatus(s) === 'active' ? <span className="status-badge active">🟢 진행중</span>
                      : <span className="status-badge completed">✅ 완료</span>}
                  </td>
                  <td>{getAvgMs(s) ? `${(getAvgMs(s) / 1000).toFixed(1)}s` : '-'}</td>
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
