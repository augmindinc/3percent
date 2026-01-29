
import { useState, useEffect } from 'react';
import { signInWithPopup, signOut, onAuthStateChanged } from 'firebase/auth';
import type { User } from 'firebase/auth';
import { auth, googleProvider } from './firebase';
import { getDomesticBalance, getOverseasBalance, getOverseasCash } from './kisService';
import './App.css';

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [balances, setBalances] = useState<any>({ overseas: null, overseasCash: null, domesticCash: null });
  const [balanceLoading, setBalanceLoading] = useState(false);

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

      console.log('Overseas Data:', overseas);
      console.log('Domestic Cash Raw:', domesticCash);
      console.log('Overseas Cash Raw:', overseasCash);

      setBalances({ overseas, domesticCash, overseasCash });
    } catch (err) {
      console.error('잔고 조회 실패:', err);
    } finally {
      setBalanceLoading(false);
    }
  };

  useEffect(() => {
    if (user) {
      fetchBalances();
    }
  }, [user]);

  if (loading) {
    return <div className="auth-container"><div className="loading">로딩 중...</div></div>;
  }

  return (
    <div className="auth-container">
      {!user ? (
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
      ) : (
        <div className="dashboard">
          <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
            <div>
              <h1 style={{ margin: 0, textAlign: 'left' }}>Dashboard</h1>
              <p className="subtitle" style={{ margin: 0 }}>안녕하세요, {user.displayName}님</p>
            </div>
            <button className="refresh-btn" onClick={handleLogout} style={{ background: 'transparent', border: 'none', color: '#94a3b8' }}>로그아웃</button>
          </header>

          <div style={{ marginBottom: '2rem', textAlign: 'left' }}>
            <button className={`refresh-btn ${balanceLoading ? 'loading' : ''}`} onClick={fetchBalances} disabled={balanceLoading}>
              {balanceLoading ? '조회 중...' : '자산 새로고침'}
            </button>
          </div>

          <div className="account-grid">
            {/* 해외 계좌 */}
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
              ) : <p>데이터를 불러오는 중입니다...</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
