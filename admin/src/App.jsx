import React from 'react';
import { useAuth } from './hooks/useAdmin.js';
import LoginPage from './components/LoginPage.jsx';
import AdminLayout from './components/AdminLayout.jsx';
import './styles/admin.css';

function App() {
  const { isAuthenticated, login, logout } = useAuth();

  if (!isAuthenticated) {
    return <LoginPage onLogin={login} />;
  }

  return <AdminLayout onLogout={logout} />;
}

export default App;
