import React from 'react';
import ChatWidget from './components/ChatWidget.jsx';

function App() {
  return (
    <div>
      {/* 프리텔레콤 웹사이트 콘텐츠 영역 (데모) */}
      <div style={{
        maxWidth: 800,
        margin: '60px auto',
        padding: '0 20px',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
      }}>
        <h1 style={{ color: '#e91e63' }}>프리티 모바일</h1>
        <p style={{ color: '#666', lineHeight: 1.8 }}>
          안녕하세요! 프리텔레콤(프리티)입니다.<br />
          SKT, KT, LG U+ 3개 통신망 알뜰폰 서비스를 제공합니다.<br />
          셀프개통으로 대기 없이 빠르게 개통하세요!
        </p>
        <p style={{ color: '#999', marginTop: 40 }}>
          👉 우측 하단 채팅 버튼을 눌러 상담을 시작하세요.
        </p>
      </div>

      {/* 채팅 위젯 */}
      <ChatWidget />
    </div>
  );
}

export default App;
