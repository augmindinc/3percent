
interface TokenResponse {
    access_token: string;
    token_type: string;
    expires_in: number;
    error_description?: string;
    error_code?: string;
    access_token_token_expired?: string;
}

// 환경 변수 처리 (따옴표 제거 및 공백 제거)
const APP_KEY = import.meta.env.VITE_KIS_APP_KEY?.replace(/['"]/g, '').trim();
const APP_SECRET = import.meta.env.VITE_KIS_APP_SECRET?.replace(/['"]/g, '').trim();
const BASE_URL = ''; // Vite의 proxy 설정을 사용하기 위해 빈 값으로 설정합니다.

export async function getAccessToken(): Promise<string> {
    const cachedToken = localStorage.getItem('kis_access_token');
    const tokenExpiry = localStorage.getItem('kis_token_expiry');

    if (cachedToken && tokenExpiry && Date.now() < parseInt(tokenExpiry)) {
        return cachedToken;
    }

    // 공식 샘플 규격에 맞춘 요청
    const response = await fetch(`${BASE_URL}/oauth2/tokenP`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'text/plain',
            'User-Agent': 'Mozilla/5.0'
        },
        body: JSON.stringify({
            grant_type: 'client_credentials',
            appkey: APP_KEY,
            appsecret: APP_SECRET
        })
    });

    const data: TokenResponse = await response.json();

    if (response.ok && data.access_token) {
        localStorage.setItem('kis_access_token', data.access_token);
        // 만료 시간 설정
        localStorage.setItem('kis_token_expiry', (Date.now() + 2 * 60 * 60 * 1000).toString());
        return data.access_token;
    } else {
        // 상세 로그 출력
        console.group('KIS Token Auth Failed');
        console.error('Status:', response.status);
        console.error('Data:', data);
        console.groupEnd();

        throw new Error(data.error_description || `토큰 발급 실패 (${data.error_code || response.status})`);
    }
}

export async function getDomesticBalance(account: string) {
    const token = await getAccessToken();
    const [cano, acntPrdtCd] = account.split('-');

    const response = await fetch(`${BASE_URL}/uapi/domestic-stock/v1/trading/inquire-balance?CANO=${cano}&ACNT_PRDT_CD=${acntPrdtCd}&AFHR_FLPR_YN=N&OFL_YN=N&INQR_DVSN=02&UNPR_DVSN=01&FUND_STTL_ICLD_YN=N&FNCG_AMT_AUTO_RDPT_YN=N&PRCS_DVSN=01&CTX_AREA_FK100=&CTX_AREA_NK100=`, {
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'authorization': `Bearer ${token}`,
            'appkey': APP_KEY,
            'appsecret': APP_SECRET,
            'tr_id': 'TTTC8434R',
            'custtype': 'P',
            'Accept': 'text/plain'
        }
    });

    const result = await response.json();
    if (!response.ok || (result.rt_cd && result.rt_cd !== '0')) {
        console.error('Domestic Balance Error:', result);
        throw new Error(result.msg1 || '국내 잔고 조회 실패');
    }
    return result;
}

export async function getOverseasBalance(account: string) {
    const token = await getAccessToken();
    const [cano, acntPrdtCd] = account.split('-');

    const response = await fetch(`${BASE_URL}/uapi/overseas-stock/v1/trading/inquire-balance?CANO=${cano}&ACNT_PRDT_CD=${acntPrdtCd}&OVRS_EXCG_CD=NASD&TR_CRCY_CD=USD&CTX_AREA_FK200=&CTX_AREA_NK200=`, {
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'authorization': `Bearer ${token}`,
            'appkey': APP_KEY,
            'appsecret': APP_SECRET,
            'tr_id': 'TTTS3012R',
            'custtype': 'P',
            'Accept': 'text/plain'
        }
    });

    const result = await response.json();
    if (!response.ok || (result.rt_cd && result.rt_cd !== '0')) {
        console.error('Overseas Balance Error:', result);
        throw new Error(result.msg1 || '해외 잔고 조회 실패');
    }
    return result;
}

export async function getOverseasCash(account: string) {
    const token = await getAccessToken();
    const [cano, acntPrdtCd] = account.split('-');

    const response = await fetch(`${BASE_URL}/uapi/overseas-stock/v1/trading/inquire-present-balance?CANO=${cano}&ACNT_PRDT_CD=${acntPrdtCd}&WCRC_FRCR_DVSN_CD=02&NATN_CD=840&TR_CRCY_CD=USD&TR_MKET_CD=00&INQR_DVSN_CD=00`, {
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'authorization': `Bearer ${token}`,
            'appkey': APP_KEY,
            'appsecret': APP_SECRET,
            'tr_id': 'CTRP6504R',
            'custtype': 'P',
            'Accept': 'text/plain'
        }
    });

    const result = await response.json();
    if (!response.ok || (result.rt_cd && result.rt_cd !== '0')) {
        console.error('Overseas Cash Error:', result);
        throw new Error(result.msg1 || '해외 외화현금 조회 실패');
    }
    return result;
}

export async function getOverseasVolumeRanking(excd: string = 'NAS') {
    const token = await getAccessToken();
    // HHDFS76200200: 해외주식 거래량순위
    const response = await fetch(`${BASE_URL}/uapi/overseas-stock/v1/quotations/volume-rank?AUTH=&EXCD=${excd}&GUBN=0&QTY=&VOL=&PRC=&TR_CONT=`, {
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'authorization': `Bearer ${token}`,
            'appkey': APP_KEY,
            'appsecret': APP_SECRET,
            'tr_id': 'HHDFS76200200',
            'custtype': 'P',
            'Accept': 'text/plain'
        }
    });

    const result = await response.json();
    if (!response.ok || (result.rt_cd && result.rt_cd !== '0')) {
        console.error('Volume Rank Error:', result);
        throw new Error(result.msg1 || '해외 거래량 순위 조회 실패');
    }
    return result;
}

export async function getOverseasMinuteChart(excd: string, symbol: string) {
    const token = await getAccessToken();
    // HHDFS76410000: 해외주식 분봉조회
    const response = await fetch(`${BASE_URL}/uapi/overseas-stock/v1/quotations/inquire-time-itemchartprice?AUTH=&EXCD=${excd}&SYMB=${symbol}&TM_GUBW=0&TR_CONT=`, {
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'authorization': `Bearer ${token}`,
            'appkey': APP_KEY,
            'appsecret': APP_SECRET,
            'tr_id': 'HHDFS76410000',
            'custtype': 'P',
            'Accept': 'text/plain'
        }
    });

    const result = await response.json();
    if (!response.ok || (result.rt_cd && result.rt_cd !== '0')) {
        console.error('Price Chart Error:', result);
        throw new Error(result.msg1 || '해외 분봉 조회 실패');
    }
    return result;
}
