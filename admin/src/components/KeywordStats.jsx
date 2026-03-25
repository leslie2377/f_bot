import React, { useEffect, useState, useCallback } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';

const API = '/api/admin';
const CAT_COLORS = { opening: '#2196f3', product: '#4caf50', terms: '#9c27b0', cs: '#ff9800', payment: '#795548', trouble: '#f44336', general: '#607d8b' };
const CAT_LABELS = { opening: '개통', product: '요금제', terms: '약관', cs: '고객센터', payment: '결제', trouble: '장애', general: '일반' };

function KeywordStats() {
  const [keywords, setKeywords] = useState([]);
  const [total, setTotal] = useState(0);
  const [totalSearches, setTotalSearches] = useState(0);
  const [cacheStats, setCacheStats] = useState(null);
  const [filter, setFilter] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const token = localStorage.getItem('admin_token');
  const headers = { Authorization: `Bearer ${token}` };

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams({ limit: '50' });
      if (filter) params.set('category', filter);
      const [kwRes, cacheRes] = await Promise.all([
        fetch(`${API}/keywords?${params}`, { headers }),
        fetch(`${API}/cache`, { headers })
      ]);
      const kwData = await kwRes.json();
      const cacheData = await cacheRes.json();
      setKeywords(kwData.keywords);
      setTotal(kwData.total);
      setTotalSearches(kwData.totalSearches);
      setCacheStats(cacheData);
    } finally { setIsLoading(false); }
  }, [filter]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // 카테고리별 그룹핑
  const catGroups = {};
  keywords.forEach(kw => {
    const cat = kw.category || 'general';
    if (!catGroups[cat]) catGroups[cat] = 0;
    catGroups[cat] += kw.count;
  });
  const catData = Object.entries(catGroups).map(([key, value]) => ({
    name: CAT_LABELS[key] || key, value, color: CAT_COLORS[key] || '#607d8b'
  })).sort((a, b) => b.value - a.value);

  // Top 20 키워드 바 차트
  const top20 = keywords.slice(0, 20).map(kw => ({
    name: kw.word,
    count: kw.count,
    fill: CAT_COLORS[kw.category] || '#607d8b'
  }));

  if (isLoading) return <div className="loading">로딩 중...</div>;

  return (
    <div className="keyword-stats-page">
      <h2 className="page-title">문의 키워드 통계</h2>

      {/* 요약 카드 */}
      <div className="stat-cards">
        <div className="stat-card">
          <div className="stat-value">{total}</div>
          <div className="stat-label">고유 키워드</div>
        </div>
        <div className="stat-card highlight">
          <div className="stat-value">{totalSearches}</div>
          <div className="stat-label">총 검색 횟수</div>
        </div>
        {cacheStats && (
          <>
            <div className="stat-card">
              <div className="stat-value">{cacheStats.cacheSize}</div>
              <div className="stat-label">캐시 항목</div>
            </div>
            <div className="stat-card" style={{ borderLeft: '4px solid #4caf50' }}>
              <div className="stat-value">{cacheStats.totalHits}</div>
              <div className="stat-label">캐시 히트 (토큰 절약)</div>
            </div>
          </>
        )}
      </div>

      {/* 차트 영역 */}
      <div className="charts-row">
        <div className="chart-card">
          <h3>카테고리별 키워드 분포</h3>
          {catData.length > 0 ? (
            <ResponsiveContainer width="100%" height={250}>
              <PieChart>
                <Pie data={catData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90}
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                  {catData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          ) : <div className="no-data">데이터 없음</div>}
        </div>

        <div className="chart-card">
          <h3>Top 20 키워드</h3>
          {top20.length > 0 ? (
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={top20} layout="vertical" margin={{ left: 60 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" allowDecimals={false} />
                <YAxis dataKey="name" type="category" width={80} tick={{ fontSize: 12 }} />
                <Tooltip />
                <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                  {top20.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : <div className="no-data">데이터 없음</div>}
        </div>
      </div>

      {/* 필터 */}
      <div className="filters-bar" style={{ marginTop: 16 }}>
        <select value={filter} onChange={(e) => setFilter(e.target.value)} className="filter-select">
          <option value="">전체 카테고리</option>
          <option value="opening">개통</option>
          <option value="product">요금제</option>
          <option value="terms">약관</option>
          <option value="cs">고객센터</option>
          <option value="payment">결제</option>
          <option value="trouble">장애</option>
          <option value="general">일반</option>
        </select>
      </div>

      {/* 키워드 테이블 */}
      <table className="session-table">
        <thead>
          <tr>
            <th>#</th>
            <th>키워드</th>
            <th>횟수</th>
            <th>카테고리</th>
            <th>최근 검색</th>
          </tr>
        </thead>
        <tbody>
          {keywords.map((kw, idx) => (
            <tr key={kw.word}>
              <td style={{ color: '#aaa' }}>{idx + 1}</td>
              <td style={{ fontWeight: 600 }}>{kw.word}</td>
              <td>
                <span style={{ background: '#e91e63', color: '#fff', padding: '2px 10px', borderRadius: 12, fontSize: 13, fontWeight: 700 }}>
                  {kw.count}
                </span>
              </td>
              <td>
                <span className={`cat-badge cat-${kw.category}`}>
                  {CAT_LABELS[kw.category] || kw.category}
                </span>
              </td>
              <td style={{ fontSize: 12, color: '#888' }}>
                {kw.lastSeen ? new Date(kw.lastSeen).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-'}
              </td>
            </tr>
          ))}
          {keywords.length === 0 && (
            <tr><td colSpan="5" style={{ textAlign: 'center', padding: 40, color: '#aaa' }}>키워드 데이터가 없습니다</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export default KeywordStats;
