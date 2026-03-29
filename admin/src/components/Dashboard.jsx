import React, { useEffect } from 'react';
import { useStats } from '../hooks/useAdmin.js';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';

const CAT_COLORS = {
  opening: '#2196f3', product: '#4caf50', terms: '#9c27b0',
  cs: '#ff9800', general: '#607d8b', error: '#f44336', payment: '#795548'
};
const CAT_LABELS = {
  opening: '개통', product: '요금제', terms: '약관',
  cs: '고객센터', general: '일반', error: '오류', payment: '결제'
};

function Dashboard() {
  const { overview, isLoading, fetchStats } = useStats();

  useEffect(() => { fetchStats(); }, [fetchStats]);

  if (isLoading || !overview) return <div className="loading">로딩 중...</div>;

  const ov = overview.overview || {};
  const categoryDistribution = overview.categoryDistribution || {};
  const sourceDistribution = overview.sourceDistribution || {};
  const todayHourly = overview.todayHourly || [];

  // snake_case/camelCase 모두 호환
  const totalSessions = ov.totalSessions ?? ov.total_sessions ?? 0;
  const todaySessions = ov.todaySessions ?? ov.today_sessions ?? 0;
  const activeSessions = ov.activeSessions ?? ov.active_sessions ?? 0;
  const unresolvedCount = ov.unresolvedCount ?? ov.unresolved_count ?? 0;
  const totalMessages = ov.totalMessages ?? ov.total_messages ?? 0;
  const avgResponseMs = ov.avgResponseTimeMs ?? ov.avg_response_ms ?? 0;
  const avgQuality = ov.avgQuality ?? ov.avg_quality ?? 0;
  const feedbackGood = ov.totalFeedbackGood ?? ov.total_feedback_good ?? 0;
  const feedbackBad = ov.totalFeedbackBad ?? ov.total_feedback_bad ?? 0;

  const catData = Object.entries(categoryDistribution).map(([key, value]) => ({
    name: CAT_LABELS[key] || key, value, color: CAT_COLORS[key] || '#607d8b'
  }));

  const sourceData = Object.entries(sourceDistribution).map(([key, value]) => {
    const labels = { faq_direct: 'FAQ 직접', cache_exact: '캐시', cache_similar: '캐시(유사)', rag: 'RAG AI' };
    return { name: labels[key] || key, value };
  });

  return (
    <div className="dashboard">
      <h2 className="page-title">대시보드</h2>

      <div className="stat-cards">
        <div className="stat-card">
          <div className="stat-value">{totalSessions}</div>
          <div className="stat-label">전체 상담</div>
        </div>
        <div className="stat-card highlight">
          <div className="stat-value">{todaySessions}</div>
          <div className="stat-label">오늘 상담</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{activeSessions}</div>
          <div className="stat-label">진행 중</div>
        </div>
        <div className="stat-card warn">
          <div className="stat-value">{unresolvedCount}</div>
          <div className="stat-label">미해결</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{totalMessages}</div>
          <div className="stat-label">전체 메시지</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{avgResponseMs > 0 ? (avgResponseMs / 1000).toFixed(1) + 's' : '-'}</div>
          <div className="stat-label">평균 응답</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{avgQuality > 0 ? Math.round(avgQuality) : '-'}</div>
          <div className="stat-label">평균 품질</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">👍{feedbackGood} 👎{feedbackBad}</div>
          <div className="stat-label">피드백</div>
        </div>
      </div>

      <div className="charts-row">
        <div className="chart-card">
          <h3>카테고리 분포</h3>
          {catData.length > 0 ? (
            <ResponsiveContainer width="100%" height={250}>
              <PieChart>
                <Pie data={catData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                  {catData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          ) : <div className="no-data">데이터 없음</div>}
        </div>

        <div className="chart-card">
          <h3>오늘 시간대별 상담</h3>
          {todayHourly.length > 0 ? (
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={todayHourly}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="hour" tickFormatter={(h) => `${h}시`} />
                <YAxis allowDecimals={false} />
                <Tooltip labelFormatter={(h) => `${h}시`} />
                <Bar dataKey="count" fill="#e91e63" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : <div className="no-data">오늘 데이터 없음</div>}
        </div>
      </div>

      {sourceData.length > 0 && (
        <div className="chart-card" style={{ marginTop: 16 }}>
          <h3>응답 소스 분포 (FAQ / 캐시 / RAG)</h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={sourceData} layout="vertical" margin={{ left: 80 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" allowDecimals={false} />
              <YAxis dataKey="name" type="category" width={80} />
              <Tooltip />
              <Bar dataKey="value" fill="#e91e63" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

export default Dashboard;
