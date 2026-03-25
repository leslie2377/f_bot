import React, { useEffect } from 'react';
import { useStats } from '../hooks/useAdmin.js';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, PieChart, Pie, Cell, ResponsiveContainer } from 'recharts';

const CAT_COLORS = {
  opening: '#2196f3', product: '#4caf50', terms: '#9c27b0',
  cs: '#ff9800', general: '#607d8b', error: '#f44336'
};
const CAT_LABELS = {
  opening: '개통', product: '요금제', terms: '약관',
  cs: '고객센터', general: '일반', error: '오류'
};

function Dashboard() {
  const { overview, isLoading, fetchStats } = useStats();

  useEffect(() => { fetchStats(); }, [fetchStats]);

  if (isLoading || !overview) return <div className="loading">로딩 중...</div>;

  const { overview: ov, categoryDistribution, todayHourly } = overview;

  const catData = Object.entries(categoryDistribution).map(([key, value]) => ({
    name: CAT_LABELS[key] || key, value, color: CAT_COLORS[key] || '#607d8b'
  }));

  return (
    <div className="dashboard">
      <h2 className="page-title">대시보드</h2>

      <div className="stat-cards">
        <div className="stat-card">
          <div className="stat-value">{ov.totalSessions}</div>
          <div className="stat-label">전체 상담</div>
        </div>
        <div className="stat-card highlight">
          <div className="stat-value">{ov.todaySessions}</div>
          <div className="stat-label">오늘 상담</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{ov.activeSessions}</div>
          <div className="stat-label">진행 중</div>
        </div>
        <div className="stat-card warn">
          <div className="stat-value">{ov.unresolvedCount}</div>
          <div className="stat-label">미해결</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{ov.totalMessages}</div>
          <div className="stat-label">전체 메시지</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{(ov.avgResponseTimeMs / 1000).toFixed(1)}s</div>
          <div className="stat-label">평균 응답시간</div>
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
    </div>
  );
}

export default Dashboard;
