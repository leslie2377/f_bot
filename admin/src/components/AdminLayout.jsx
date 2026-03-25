import React, { useState } from 'react';
import Dashboard from './Dashboard.jsx';
import SessionList from './SessionList.jsx';
import SessionDetail from './SessionDetail.jsx';
import UnresolvedList from './UnresolvedList.jsx';

function AdminLayout({ onLogout }) {
  const [currentPage, setCurrentPage] = useState('dashboard');
  const [selectedSessionId, setSelectedSessionId] = useState(null);

  const navigate = (page, sessionId = null) => {
    setCurrentPage(page);
    if (sessionId) setSelectedSessionId(sessionId);
  };

  const renderContent = () => {
    switch (currentPage) {
      case 'dashboard':
        return <Dashboard />;
      case 'sessions':
        return <SessionList onSelectSession={(id) => navigate('detail', id)} />;
      case 'detail':
        return <SessionDetail sessionId={selectedSessionId} onBack={() => navigate('sessions')} />;
      case 'unresolved':
        return <UnresolvedList onSelectSession={(id) => navigate('detail', id)} />;
      default:
        return <Dashboard />;
    }
  };

  return (
    <div className="admin-layout">
      <aside className="sidebar">
        <div className="sidebar-header">
          <span className="sidebar-logo">🤖</span>
          <span className="sidebar-title">프리티 관리자</span>
        </div>
        <nav className="sidebar-nav">
          <button className={`nav-item ${currentPage === 'dashboard' ? 'active' : ''}`} onClick={() => navigate('dashboard')}>
            📊 대시보드
          </button>
          <button className={`nav-item ${currentPage === 'sessions' || currentPage === 'detail' ? 'active' : ''}`} onClick={() => navigate('sessions')}>
            💬 세션 목록
          </button>
          <button className={`nav-item ${currentPage === 'unresolved' ? 'active' : ''}`} onClick={() => navigate('unresolved')}>
            ❓ 미해결 질문
          </button>
        </nav>
        <div className="sidebar-footer">
          <button className="logout-btn" onClick={onLogout}>로그아웃</button>
        </div>
      </aside>
      <main className="main-content">
        {renderContent()}
      </main>
    </div>
  );
}

export default AdminLayout;
