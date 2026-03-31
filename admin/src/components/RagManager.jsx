import React, { useEffect, useState, useCallback } from 'react';

const API = '/api/admin';
const TYPE_COLORS = { faq: '#2196f3', product: '#4caf50', guide: '#ff9800', terms: '#9c27b0', manual: '#607d8b' };
const TYPE_LABELS = { faq: 'FAQ', product: '요금제', guide: '가이드', terms: '약관', manual: '기타' };

function RagManager({ initialTab, initialFilter } = {}) {
  // 검색
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchK, setSearchK] = useState(5);
  const [isSearching, setIsSearching] = useState(false);

  // 통계
  const [ragStats, setRagStats] = useState(null);
  const [isReindexing, setIsReindexing] = useState(false);

  // 수동 추가
  const [addContent, setAddContent] = useState('');
  const [addType, setAddType] = useState('faq');
  const [addResult, setAddResult] = useState(null);
  const [isAdding, setIsAdding] = useState(false);

  // 추가 이력
  const [documents, setDocuments] = useState([]);
  const [docTotal, setDocTotal] = useState(0);
  const [docFilter, setDocFilter] = useState('');
  const [docPage, setDocPage] = useState(1);

  // 현재 탭
  const [activeTab, setActiveTab] = useState(initialTab || 'search');
  // 벡터 검색 결과 (타입별)
  const [typeSearchResults, setTypeSearchResults] = useState([]);
  const [typeSearchType, setTypeSearchType] = useState('');

  const token = localStorage.getItem('admin_token');
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const fetchStats = useCallback(async () => {
    const res = await fetch(`${API}/rag/stats`, { headers });
    if (res.ok) setRagStats(await res.json());
  }, []);

  // 타입별 벡터 검색
  const searchByType = useCallback(async (type) => {
    const typeQueries = {
      faq: 'FAQ 질문 답변',
      products: '요금제 통신망 판매가 데이터',
      guide: '셀프개통 절차 안내',
      terms: '약관 계약 해지',
      pdf: '프리텔레콤 이용약관'
    };
    const query = typeQueries[type] || type;
    const res = await fetch(`${API}/rag/search?query=${encodeURIComponent(query)}&k=10`, { headers });
    if (res.ok) {
      const data = await res.json();
      // 해당 타입만 필터
      const filtered = data.results.filter(d => {
        if (type === 'products') return d.metadata.type === 'product';
        if (type === 'pdf') return d.metadata.type === 'terms' && d.metadata.source?.includes('pdf');
        return d.metadata.type === type;
      });
      setTypeSearchResults(filtered.length > 0 ? filtered : data.results.slice(0, 10));
      setTypeSearchType(type);
      setActiveTab('typeview');
    }
  }, []);

  const fetchDocuments = useCallback(async () => {
    const params = new URLSearchParams({ page: docPage, limit: 10 });
    if (docFilter) params.set('type', docFilter);
    const res = await fetch(`${API}/rag/documents?${params}`, { headers });
    if (res.ok) {
      const data = await res.json();
      setDocuments(data.items);
      setDocTotal(data.total);
    }
  }, [docPage, docFilter]);

  useEffect(() => { fetchStats(); }, [fetchStats]);
  useEffect(() => { if (activeTab === 'documents') fetchDocuments(); }, [activeTab, fetchDocuments]);

  // 벡터 검색
  const handleSearch = async (e) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    setIsSearching(true);
    try {
      const res = await fetch(`${API}/rag/search?query=${encodeURIComponent(searchQuery)}&k=${searchK}`, { headers });
      setSearchResults((await res.json()).results || []);
    } finally { setIsSearching(false); }
  };

  // 재인덱싱
  const handleReindex = async () => {
    if (!confirm('전체 데이터를 재인덱싱합니다. 계속하시겠습니까?')) return;
    setIsReindexing(true);
    try {
      const res = await fetch(`${API}/rag/reindex`, { method: 'POST', headers });
      const data = await res.json();
      if (data.success) { setRagStats(data.stats); alert(`재인덱싱 완료! ${data.stats.totalDocuments}개 문서`); }
    } catch (err) { alert('실패: ' + err.message); }
    finally { setIsReindexing(false); }
  };

  // 문서 수동 추가
  const handleAdd = async (e) => {
    e.preventDefault();
    if (!addContent.trim()) return;
    setIsAdding(true);
    setAddResult(null);
    try {
      const res = await fetch(`${API}/rag/add`, {
        method: 'POST', headers,
        body: JSON.stringify({ content: addContent, type: addType })
      });
      const data = await res.json();
      if (data.success) {
        setAddResult({ success: true, record: data.record, stats: data.stats });
        setAddContent('');
        setRagStats(data.stats);
        if (activeTab === 'documents') fetchDocuments();
      } else {
        setAddResult({ success: false, error: data.error });
      }
    } catch (err) {
      setAddResult({ success: false, error: err.message });
    } finally { setIsAdding(false); }
  };

  // 문서 삭제
  const handleDeleteDoc = async (id) => {
    if (!confirm('이 문서를 삭제하시겠습니까?')) return;
    await fetch(`${API}/rag/documents/${id}`, { method: 'DELETE', headers });
    fetchDocuments();
  };

  const formatTime = (iso) => iso ? new Date(iso).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-';

  return (
    <div className="rag-manager-page">
      <h2 className="page-title">RAG 벡터 검색 관리</h2>

      {/* 통계 카드 (클릭하여 조회) */}
      <div className="stat-cards">
        <div className="stat-card highlight clickable" onClick={() => { setActiveTab('search'); }}>
          <div className="stat-value">{ragStats?.totalDocuments || 0}</div>
          <div className="stat-label">전체 벡터</div>
        </div>
        <div className="stat-card clickable" onClick={() => searchByType('faq')}>
          <div className="stat-value">{ragStats?.faq || 0}</div><div className="stat-label">FAQ</div>
        </div>
        <div className="stat-card clickable" onClick={() => searchByType('products')}>
          <div className="stat-value">{ragStats?.products || 0}</div><div className="stat-label">요금제</div>
        </div>
        <div className="stat-card clickable" onClick={() => searchByType('guide')}>
          <div className="stat-value">{ragStats?.guide || 0}</div><div className="stat-label">가이드</div>
        </div>
        <div className="stat-card clickable" onClick={() => searchByType('terms')}>
          <div className="stat-value">{ragStats?.terms || 0}</div><div className="stat-label">약관</div>
        </div>
        <div className="stat-card clickable" onClick={() => searchByType('pdf')}>
          <div className="stat-value">{ragStats?.pdf || 0}</div><div className="stat-label">PDF</div>
        </div>
        {ragStats?.manual > 0 && <div className="stat-card clickable" onClick={() => { setDocFilter('manual'); setActiveTab('documents'); }}>
          <div className="stat-value">{ragStats.manual}</div><div className="stat-label">수동추가</div>
        </div>}
      </div>

      {/* 탭 메뉴 */}
      <div className="rag-tabs">
        <button className={`rag-tab ${activeTab === 'search' ? 'active' : ''}`} onClick={() => setActiveTab('search')}>🔍 벡터 검색</button>
        <button className={`rag-tab ${activeTab === 'typeview' ? 'active' : ''}`} onClick={() => setActiveTab('typeview')}>📄 타입별 조회</button>
        <button className={`rag-tab ${activeTab === 'add' ? 'active' : ''}`} onClick={() => setActiveTab('add')}>➕ 문서 추가</button>
        <button className={`rag-tab ${activeTab === 'documents' ? 'active' : ''}`} onClick={() => setActiveTab('documents')}>📋 추가 이력 ({docTotal})</button>
        <button className={`rag-tab ${activeTab === 'reindex' ? 'active' : ''}`} onClick={() => setActiveTab('reindex')}>🔄 재인덱싱</button>
      </div>

      {/* ── 벡터 검색 ── */}
      {activeTab === 'search' && (
        <div className="rag-section">
          <p className="section-desc">질문을 입력하면 벡터 DB에서 유사한 문서를 검색합니다.</p>
          <form onSubmit={handleSearch} className="search-form">
            <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="검색할 질문 입력... (예: eSIM 개통 방법, CGV 요금제)" className="filter-input" style={{ flex: 1 }} />
            <select value={searchK} onChange={(e) => setSearchK(parseInt(e.target.value))} className="filter-select">
              <option value={3}>Top 3</option><option value={5}>Top 5</option><option value={10}>Top 10</option>
            </select>
            <button type="submit" className="action-btn primary" disabled={isSearching}>{isSearching ? '검색 중...' : '검색'}</button>
          </form>
          {searchResults.length > 0 && (
            <div className="search-results">
              <div className="result-header">검색 결과: {searchResults.length}건</div>
              {searchResults.map((r, idx) => (
                <div key={idx} className="result-card">
                  <div className="result-top">
                    <span className="result-rank">#{idx + 1}</span>
                    <span className="result-type" style={{ background: TYPE_COLORS[r.metadata.type] || '#607d8b' }}>{TYPE_LABELS[r.metadata.type] || r.metadata.type}</span>
                    {r.metadata.source && <span className="result-source">{r.metadata.source}</span>}
                    {r.metadata.category && <span className="result-category">{r.metadata.category}</span>}
                    {r.metadata.name && <span className="result-name">{r.metadata.name}</span>}
                    {r.metadata.network && <span className="result-category">{r.metadata.network}</span>}
                    {r.metadata.monthlyFee > 0 && <span className="result-name">{Number(r.metadata.monthlyFee).toLocaleString()}원</span>}
                  </div>
                  <div className="result-content">{r.content}</div>
                  {r.metadata.detailUrl && <a href={r.metadata.detailUrl} target="_blank" rel="noopener noreferrer" className="result-link">🔗 상세 페이지</a>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── 문서 추가 ── */}
      {activeTab === 'add' && (
        <div className="rag-section">
          <p className="section-desc">새 문서를 벡터 DB + JSON 원본에 동시 반영합니다.</p>
          <form onSubmit={handleAdd} className="add-form">
            <div className="add-type-row">
              <label>문서 타입:</label>
              <div className="add-type-buttons">
                {Object.entries(TYPE_LABELS).map(([key, label]) => (
                  <button key={key} type="button" className={`type-btn ${addType === key ? 'active' : ''}`}
                    style={addType === key ? { background: TYPE_COLORS[key], color: '#fff' } : {}}
                    onClick={() => setAddType(key)}>{label}</button>
                ))}
              </div>
            </div>
            <textarea value={addContent} onChange={(e) => setAddContent(e.target.value)}
              placeholder={addType === 'faq'
                ? '질문: 여기에 질문을 입력하세요\n답변: 여기에 답변을 입력하세요'
                : addType === 'product'
                ? '요금제: 요금제명\n통신망: SKT\n월요금: 10000\n데이터: 10GB\n통화: 무제한'
                : '내용을 입력하세요...'}
              className="add-textarea" rows={6} />
            <div className="add-actions">
              <button type="submit" className="action-btn primary" disabled={isAdding || !addContent.trim()}>
                {isAdding ? '추가 중...' : '벡터 DB + 원본 반영'}
              </button>
            </div>
          </form>

          {/* 추가 결과 */}
          {addResult && (
            <div className={`add-result ${addResult.success ? 'success' : 'error'}`}>
              {addResult.success ? (
                <>
                  <div className="add-result-title">✅ 추가 완료</div>
                  <div className="add-result-detail">
                    <span>타입: <strong>{TYPE_LABELS[addResult.record.type]}</strong></span>
                    <span>ID: {addResult.record.id}</span>
                    <span>시간: {formatTime(addResult.record.createdAt)}</span>
                  </div>
                  <div className="add-result-detail">
                    전체 벡터: <strong>{addResult.stats.totalDocuments}</strong>개
                    {' | '}FAQ: {addResult.stats.faq} | 요금제: {addResult.stats.products} | 약관: {addResult.stats.terms}
                  </div>
                </>
              ) : (
                <div className="add-result-title">❌ 추가 실패: {addResult.error}</div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── 추가 이력 ── */}
      {activeTab === 'documents' && (
        <div className="rag-section">
          <div className="filters-bar" style={{ marginBottom: 12 }}>
            <select value={docFilter} onChange={(e) => { setDocFilter(e.target.value); setDocPage(1); }} className="filter-select">
              <option value="">전체 타입</option>
              {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <span className="section-desc" style={{ margin: 'auto 0' }}>총 {docTotal}건</span>
          </div>

          {documents.length === 0 ? (
            <div className="no-data">수동 추가된 문서가 없습니다.</div>
          ) : (
            <>
              {documents.map((doc) => (
                <div key={doc.id} className="doc-card">
                  <div className="doc-header">
                    <span className="result-type" style={{ background: TYPE_COLORS[doc.type] || '#607d8b' }}>{TYPE_LABELS[doc.type] || doc.type}</span>
                    <span className="doc-time">{formatTime(doc.createdAt)}</span>
                    <span className="doc-id">{doc.id}</span>
                    <button className="doc-delete-btn" onClick={() => handleDeleteDoc(doc.id)}>🗑</button>
                  </div>
                  <div className="doc-content">{doc.content.length > 300 ? doc.content.slice(0, 300) + '...' : doc.content}</div>
                </div>
              ))}
              {docTotal > 10 && (
                <div className="pagination">
                  <button disabled={docPage <= 1} onClick={() => setDocPage(p => p - 1)}>← 이전</button>
                  <span>{docPage} / {Math.ceil(docTotal / 10)}</span>
                  <button disabled={docPage >= Math.ceil(docTotal / 10)} onClick={() => setDocPage(p => p + 1)}>다음 →</button>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── 타입별 조회 ── */}
      {activeTab === 'typeview' && (
        <div className="rag-section">
          {typeSearchType && (
            <div className="result-header" style={{ marginBottom: 12 }}>
              📄 <strong>{TYPE_LABELS[typeSearchType] || typeSearchType}</strong> 벡터 문서 ({typeSearchResults.length}건)
            </div>
          )}
          {typeSearchResults.length === 0 ? (
            <div className="no-data">위 통계 카드를 클릭하면 해당 타입의 문서를 조회합니다.</div>
          ) : (
            typeSearchResults.map((r, idx) => (
              <div key={idx} className="result-card">
                <div className="result-top">
                  <span className="result-rank">#{idx + 1}</span>
                  <span className="result-type" style={{ background: TYPE_COLORS[r.metadata.type] || '#607d8b' }}>{TYPE_LABELS[r.metadata.type] || r.metadata.type}</span>
                  {r.metadata.name && <span className="result-name">{r.metadata.name}</span>}
                  {r.metadata.network && <span className="result-category">{r.metadata.network}</span>}
                  {r.metadata.monthlyFee > 0 && <span className="result-name">{Number(r.metadata.monthlyFee).toLocaleString()}원</span>}
                </div>
                <div className="result-content">{r.content}</div>
                {r.metadata.detailUrl && <a href={r.metadata.detailUrl} target="_blank" rel="noopener noreferrer" className="result-link">🔗 상세 페이지</a>}
              </div>
            ))
          )}
        </div>
      )}

      {/* ── 재인덱싱 ── */}
      {activeTab === 'reindex' && (
        <div className="rag-section">
          <p className="section-desc">
            FAQ({ragStats?.faq || 0}), 요금제({ragStats?.products || 0}), 가이드({ragStats?.guide || 0}), 약관({ragStats?.terms || 0}), PDF({ragStats?.pdf || 0})를 다시 읽어 벡터 DB를 재구축합니다.
            {ragStats?.createdAt && <span className="last-index"> (마지막: {new Date(ragStats.createdAt).toLocaleString('ko-KR')})</span>}
          </p>
          <button className="action-btn danger" onClick={handleReindex} disabled={isReindexing}>
            {isReindexing ? '재인덱싱 진행 중...' : '전체 재인덱싱 실행'}
          </button>
        </div>
      )}
    </div>
  );
}

export default RagManager;
