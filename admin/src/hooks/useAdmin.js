import { useState, useCallback, useEffect } from 'react';

const API = '/api/admin';

function getToken() { return localStorage.getItem('admin_token'); }
function setToken(t) { localStorage.setItem('admin_token', t); }
function removeToken() { localStorage.removeItem('admin_token'); }

function authHeaders() {
  const t = getToken();
  return t ? { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };
}

async function fetchApi(url, options = {}) {
  const res = await fetch(url, { ...options, headers: { ...authHeaders(), ...options.headers } });
  if (res.status === 401) { removeToken(); window.location.reload(); return null; }
  return res;
}

export function useAuth() {
  const [isAuthenticated, setIsAuthenticated] = useState(!!getToken());

  const login = useCallback(async (password) => {
    const res = await fetch(`${API}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    });
    if (!res.ok) { const data = await res.json(); throw new Error(data.error); }
    const { token } = await res.json();
    setToken(token);
    setIsAuthenticated(true);
  }, []);

  const logout = useCallback(() => { removeToken(); setIsAuthenticated(false); }, []);

  return { isAuthenticated, login, logout };
}

export function useSessions() {
  const [list, setList] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, total: 0, totalPages: 0 });
  const [isLoading, setIsLoading] = useState(false);

  const fetchSessions = useCallback(async (filters = {}) => {
    setIsLoading(true);
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => { if (v) params.set(k, v); });
    try {
      const res = await fetchApi(`${API}/sessions?${params}`);
      if (!res) return;
      const data = await res.json();
      setList(data.sessions);
      setPagination(data.pagination);
    } finally { setIsLoading(false); }
  }, []);

  const deleteSession = useCallback(async (id) => {
    await fetchApi(`${API}/sessions/${id}`, { method: 'DELETE' });
  }, []);

  return { list, pagination, isLoading, fetchSessions, deleteSession };
}

export function useSessionDetail() {
  const [data, setData] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  const fetchSession = useCallback(async (id) => {
    setIsLoading(true);
    try {
      const res = await fetchApi(`${API}/sessions/${id}`);
      if (!res) return;
      if (res.status === 404) { setData(null); return; }
      setData(await res.json());
    } finally { setIsLoading(false); }
  }, []);

  return { data, isLoading, fetchSession };
}

export function useStats() {
  const [overview, setOverview] = useState(null);
  const [daily, setDaily] = useState([]);
  const [isLoading, setIsLoading] = useState(false);

  const fetchStats = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetchApi(`${API}/stats`);
      if (!res) return;
      setOverview(await res.json());
    } finally { setIsLoading(false); }
  }, []);

  const fetchDaily = useCallback(async (from, to) => {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    const res = await fetchApi(`${API}/stats/daily?${params}`);
    if (!res) return;
    const data = await res.json();
    setDaily(data.daily);
  }, []);

  return { overview, daily, isLoading, fetchStats, fetchDaily };
}

export function useUnresolved() {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(false);

  const fetchUnresolved = useCallback(async (page = 1) => {
    setIsLoading(true);
    try {
      const res = await fetchApi(`${API}/unresolved?page=${page}`);
      if (!res) return;
      const data = await res.json();
      setItems(data.items);
      setTotal(data.total);
    } finally { setIsLoading(false); }
  }, []);

  return { items, total, isLoading, fetchUnresolved };
}
