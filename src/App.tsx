
import { useState, useEffect } from 'react';
import { signInWithPopup, signOut, onAuthStateChanged } from 'firebase/auth';
import type { User } from 'firebase/auth';
import { auth, googleProvider } from './firebase';
import { getOverseasBalance, getOverseasCash, getOverseasVolumeRanking, getOverseasMinuteChart } from './kisService';
import './App.css';

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [balances, setBalances] = useState<any>({ overseas: null, overseasCash: null, domesticCash: null });
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'scanner'>('dashboard');

  // Scanner state
  const [scannedStocks, setScannedStocks] = useState<any[]>([]);
  const [scanLoading, setScanLoading] = useState(false);
  const [scanStatus, setScanStatus] = useState('');
  const [scanProgress, setScanProgress] = useState(0);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const handleGoogleLogin = async () => {
    setAuthError(null);
    try {
      const result = await signInWithPopup(auth, googleProvider);
      setUser(result.user);
    } catch (err: any) {
      console.error(err);
      setAuthError(err.message || '로그인 중 오류가 발생했습니다.');
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setBalances({ overseas: null, overseasCash: null, domesticCash: null });
    } catch (err) {
      console.error(err);
    }
  };

  const fetchBalances = async () => {
    setBalanceLoading(true);
    try {
      const overseas = await getOverseasBalance(import.meta.env.VITE_KIS_OVERSEAS_ACCOUNT);
      const domesticCash = await getOverseasCash(import.meta.env.VITE_KIS_DOMESTIC_ACCOUNT);
      const overseasCash = await getOverseasCash(import.meta.env.VITE_KIS_OVERSEAS_ACCOUNT);
      setBalances({ overseas, domesticCash, overseasCash });
    } catch (err) {
      console.error('잔고 조회 실패:', err);
    } finally {
      setBalanceLoading(false);
    }
  };

  const runScanner = async () => {
    if (scanLoading) return;

    setScanLoading(true);
    setScanProgress(0);
    setScanStatus('시장 주도주 랭킹 데이터를 가져오는 중...');

    try {
      const rankingData = await getOverseasVolumeRanking('NAS');
      const topStocks = rankingData.output2 || [];
      const targetCount = Math.min(topStocks.length, 20);

      if (topStocks.length === 0) {
        setScanStatus('선별된 주도주 데이터가 없습니다.');
        setScanLoading(false);
        return;
      }

      setScannedStocks([]);
      const tempAnalyzed: any[] = [];

      for (let i = 0; i < targetCount; i++) {
        const stock = topStocks[i];
        const symbol = stock.symb || '';
        const name = stock.name || '';
        if (!symbol) continue;

        setScanStatus(`[${i + 1}/${targetCount}] ${name} 분석 중...`);
        setScanProgress(((i + 1) / targetCount) * 100);

        try {
          const chartData = await getOverseasMinuteChart('NAS', symbol);
          const history = chartData.output2 || [];

          if (history.length < 30) continue; // 30분치 데이터 필수

          const vol = Number(stock.tvol || stock.vol || 0);

          // --- [강화된 분석 로직: 30분 트렌드 및 5분간의 패턴 추적] ---
          const prices30 = history.slice(0, 30).map((h: any) => Number(h.last));
          const current = prices30[0];
          const high30 = Math.max(...prices30);
          const low30 = Math.min(...prices30);

          // 1. 우상향 추세 (고점 부근 횡보 혹은 돌파)
          const atHigh = current >= high30 * 0.997;
          const recovered = current > low30 * 1.0015;
          const trendOk = current > (prices30[14] + prices30[15] + prices30[16]) / 3;
          const isUpward = atHigh && recovered && trendOk;

          // 2. 상승 샅바 (Belt-hold) - 최근 5분 이내에 발생했는지 확인
          const recent5 = history.slice(0, 5);
          const isBeltHoldInLast5 = recent5.some((candle: any) => {
            const c_open = Number(candle.open);
            const c_low = Number(candle.low);
            const c_high = Number(candle.high);
            const c_last = Number(candle.last);

            const isPos = c_last > c_open;
            const tinyTail = c_open <= c_low * 1.0015;
            const fullBody = c_last >= c_high * 0.9985;
            const sizeOk = (c_last - c_open) / c_open >= 0.0008;

            return isPos && tinyTail && fullBody && sizeOk;
          });

          const analyzedResult = {
            symbol,
            name,
            price: Number(stock.last || 0),
            rate: stock.rate || '0',
            vol,
            criteria: {
              volume: true,
              upward: isUpward,
              beltHold: isBeltHoldInLast5
            },
            score: (1 + (isUpward ? 1.5 : 0) + (isBeltHoldInLast5 ? 2 : 0))
          };

          tempAnalyzed.push(analyzedResult);
          setScannedStocks([...tempAnalyzed].sort((a, b) => b.score - a.score));

        } catch (e) {
          console.error(`Analysis failed for ${symbol}:`, e);
        }
      }

      setScanStatus('실시간 분석 완료 (1분 후 자동 갱신)');
    } catch (err) {
      console.error('스캔 작업 중 오류:', err);
      setScanStatus('데이터를 가져오는 중 오류가 발생했습니다.');
    } finally {
      setScanLoading(false);
    }
  };

  useEffect(() => {
    let interval: any;
    if (user && activeTab === 'scanner') {
      runScanner();
      interval = setInterval(() => {
        runScanner();
      }, 60000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [user, activeTab]);

  useEffect(() => {
    if (user && activeTab === 'dashboard') {
      fetchBalances();
    }
  }, [user, activeTab]);

  if (loading) {
    return <div className="auth-container"><div className="loading">로딩 중...</div></div>;
  }

  if (!user) {
    return (
      <div className="auth-container">
        <div className="auth-card">
          <div className="logo-area">
            <div className="logo-icon">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h1>3Percent</h1>
            <p className="subtitle">투자 자산 관리의 시작</p>
          </div>
          <button className="google-btn" onClick={handleGoogleLogin}>
            <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" className="google-icon" />
            Google로 로그인
          </button>
          {authError && <p style={{ color: '#ef4444', marginTop: '1rem', fontSize: '0.875rem' }}>{authError}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="layout-container">
      <aside className="sidebar">
        <div className="logo-area" style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '0 0.5rem', marginBottom: '1rem' }}>
          <div className="logo-icon" style={{ width: '32px', height: '32px', margin: 0, borderRadius: '8px' }}>
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" style={{ width: '18px', height: '18px' }}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h2 style={{ fontSize: '1.1rem', fontWeight: 800, margin: 0, letterSpacing: '-0.02em' }}>3Percent</h2>
        </div>

        <nav className="nav-menu">
          <button className={`nav-item ${activeTab === 'dashboard' ? 'active' : ''}`} onClick={() => setActiveTab('dashboard')}>
            <svg className="nav-icon" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg>
            대시보드
          </button>
          <button className={`nav-item ${activeTab === 'scanner' ? 'active' : ''}`} onClick={() => setActiveTab('scanner')}>
            <svg className="nav-icon" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
            강력종목 발굴
          </button>
        </nav>

        <div style={{ marginTop: 'auto' }}>
          <button className="nav-item" onClick={handleLogout} style={{ color: '#ef4444' }}>
            로그아웃
          </button>
        </div>
      </aside>

      <main className="main-content">
        {activeTab === 'dashboard' ? (
          <div className="dashboard-view">
            <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
              <div>
                <h1 style={{ margin: 0, textAlign: 'left' }}>Dashboard</h1>
                <p className="subtitle" style={{ margin: 0 }}>안녕하세요, {user.displayName}님</p>
              </div>
              <button className={`refresh-btn ${balanceLoading ? 'loading' : ''}`} onClick={fetchBalances} disabled={balanceLoading}>
                {balanceLoading ? '조회 중...' : '자산 새로고침'}
              </button>
            </header>

            <div className="account-grid">
              <div className="account-card">
                <div className="account-type">해외 주식 (미국)</div>
                <div className="account-number">{import.meta.env.VITE_KIS_OVERSEAS_ACCOUNT}</div>
                {balances.overseas ? (
                  <>
                    <div className="balance-amount">
                      ${(
                        Number(balances.overseas.output2?.tot_evlu_amt || 0) +
                        Number(balances.overseasCash?.output2?.[0]?.frcr_buy_psbl_amt || balances.overseasCash?.output2?.[0]?.frcr_dncl_amt_2 || 0)
                      ).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                    <div style={{ fontSize: '0.8rem', color: '#94a3b8', marginBottom: '1rem' }}>
                      주식 평가: ${Number(balances.overseas.output2?.tot_evlu_amt || 0).toLocaleString()} <br />
                      원화 예수금: {Number(balances.overseasCash?.output3?.tot_dncl_amt || 0).toLocaleString()}원 <br />
                      외화 예수금: ${Number(balances.overseasCash?.output2?.[0]?.frcr_buy_psbl_amt || balances.overseasCash?.output2?.[0]?.frcr_dncl_amt_2 || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </div>
                    <div className="stock-list">
                      {balances.overseas.output1 && balances.overseas.output1.length > 0 ? (
                        balances.overseas.output1.map((stock: any, i: number) => (
                          <div key={i} className="stock-item">
                            <span className="stock-name">{stock.ovrs_item_name}</span>
                            <span className={`stock-profit ${Number(stock.evlu_pfls_amt || 0) >= 0 ? 'profit-plus' : 'profit-minus'}`}>
                              {Number(stock.evlu_pfls_rt || 0).toFixed(2)}%
                            </span>
                          </div>
                        ))
                      ) : (
                        <p className="subtitle" style={{ fontSize: '0.8rem' }}>보유 종목이 없습니다.</p>
                      )}
                    </div>
                  </>
                ) : <div className="loading">데이터를 불러오는 중...</div>}
              </div>
            </div>
          </div>
        ) : (
          <div className="scanner-view">
            <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
              <div>
                <h1 style={{ margin: 0, textAlign: 'left' }}>Market Scanner</h1>
                <p className="subtitle" style={{ margin: 0 }}>실시간 거래량 및 기술적 지표 기반 강력 종목 발굴</p>
              </div>
              <button className={`refresh-btn ${scanLoading ? 'loading' : ''}`} onClick={runScanner} disabled={scanLoading}>
                {scanLoading ? '스캔 중...' : '새로 고침'}
              </button>
            </header>

            {scanLoading && (
              <div style={{ marginBottom: '2rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem', fontSize: '0.9rem' }}>
                  <span>{scanStatus}</span>
                  <span>{Math.round(scanProgress)}%</span>
                </div>
                <div className="scan-progress">
                  <div className="scan-bar" style={{ width: `${scanProgress}%` }}></div>
                </div>
              </div>
            )}

            <div className="scanner-grid">
              {scannedStocks.map((stock, i) => (
                <div key={i} className="stock-card">
                  {stock.score >= 3 && <div className="strong-badge" style={{ position: 'absolute', top: '1.25rem', right: '1.25rem' }}>HOT</div>}
                  <div className="account-type">{stock.symbol}</div>
                  <h3 style={{ margin: '0.25rem 0 1rem' }}>{stock.name}</h3>

                  <div className="stock-info">
                    <div className="stock-price">${Number(stock.price).toLocaleString()}</div>
                    <div className={`stock-profit ${Number(stock.rate) >= 0 ? 'profit-plus' : 'profit-minus'}`}>
                      {Number(stock.rate) > 0 && !stock.rate.toString().includes('+') ? '+' : ''}{stock.rate}%
                    </div>
                  </div>

                  <div className="criteria-list">
                    <div className="criteria-item">
                      <div className={`criteria-dot ${stock.criteria.volume ? 'active' : ''}`}></div>
                      거래량 상위 (관심/자본 유입)
                    </div>
                    <div className="criteria-item">
                      <div className={`criteria-dot ${stock.criteria.upward ? 'active' : ''}`}></div>
                      우상향 추세 (눌림 후 고점 갱신)
                    </div>
                    <div className="criteria-item">
                      <div className={`criteria-dot ${stock.criteria.beltHold ? 'active' : ''}`}></div>
                      상승 샅바 (강력한 매수 버티기)
                    </div>
                  </div>

                  <div className="stock-vol" style={{ marginTop: '1.5rem', textAlign: 'right' }}>
                    오늘 거래량: {Number(stock.vol).toLocaleString()}
                  </div>
                </div>
              ))}
              {scannedStocks.length === 0 && !scanLoading && (
                <div style={{ gridColumn: '1 / -1', textAlign: 'center', padding: '4rem', color: '#64748b' }}>
                  현재 기준에 부합하는 종목을 찾는 중입니다...
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
