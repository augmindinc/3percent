
const fs = require('fs');
const path = require('path');

// .env 파일 파싱
const envPath = path.join(__dirname, '.env');
const envContent = fs.readFileSync(envPath, 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
    const [key, ...value] = line.split('=');
    if (key && value) {
        env[key.trim()] = value.join('=').trim().replace(/^"(.*)"$/, '$1');
    }
});

const APP_KEY = env.VITE_KIS_APP_KEY;
const APP_SECRET = env.VITE_KIS_APP_SECRET;
const BASE_URL = env.VITE_KIS_BASE_URL;
const DOMESTIC_ACCOUNT = env.VITE_KIS_DOMESTIC_ACCOUNT;
const OVERSEAS_ACCOUNT = env.VITE_KIS_OVERSEAS_ACCOUNT;

async function getAccessToken() {
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

    const data = await response.json();
    if (response.ok && data.access_token) {
        return data.access_token;
    } else {
        throw new Error(data.error_description || '토큰 발급 실패');
    }
}

async function getDomesticBalance(account, token) {
    const [cano, acntPrdtCd] = account.split('-');
    // OVR_FLPR_YN -> OFL_YN 변경
    const url = `${BASE_URL}/uapi/domestic-stock/v1/trading/inquire-balance?CANO=${cano}&ACNT_PRDT_CD=${acntPrdtCd}&AFHR_FLPR_YN=N&OFL_YN=N&INQR_DVSN=02&UNPR_DVSN=01&FUND_STTL_ICLD_YN=N&FNCG_AMT_AUTO_RDPT_YN=N&PRCS_DVSN=01&CTX_AREA_FK100=&CTX_AREA_NK100=`;

    const response = await fetch(url, {
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

    return await response.json();
}

async function getOverseasBalance(account, token) {
    const [cano, acntPrdtCd] = account.split('-');
    const url = `${BASE_URL}/uapi/overseas-stock/v1/trading/inquire-balance?CANO=${cano}&ACNT_PRDT_CD=${acntPrdtCd}&OVRS_EXCG_CD=NASD&TR_CRCY_CD=USD&CTX_AREA_FK200=&CTX_AREA_NK200=`;

    const response = await fetch(url, {
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

    return await response.json();
}

async function main() {
    try {
        console.log('Access 토큰 발급 중...');
        const token = await getAccessToken();

        console.log('\n--- 국내 잔고 조회 ---');
        console.log(`계좌: ${DOMESTIC_ACCOUNT}`);
        const domestic = await getDomesticBalance(DOMESTIC_ACCOUNT, token);
        if (domestic.rt_cd === '0') {
            console.log('총 평가금액:', domestic.output2[0].tot_evlu_amt, '원');
            console.log('종목 리스트:');
            domestic.output1.forEach(stock => {
                if (parseInt(stock.hldg_qty) > 0) {
                    console.log(`- ${stock.prdt_name}: ${stock.hldg_qty}주 (수익률: ${stock.evlu_pfls_rt}%)`);
                }
            });
        } else {
            console.log('국내 잔고 조회 실패:', domestic.msg1);
            console.log('전체 응답:', JSON.stringify(domestic));
        }

        console.log('\n--- 해외 잔고 조회 ---');
        console.log(`계좌: ${OVERSEAS_ACCOUNT}`);
        const overseas = await getOverseasBalance(OVERSEAS_ACCOUNT, token);
        if (overseas.rt_cd === '0') {
            const totalEval = overseas.output2.tot_evlu_amt || overseas.output2.evlu_amt_smtl || '0';
            console.log('총 평가금액:', totalEval, 'USD');
            console.log('종목 리스트:');
            if (overseas.output1 && Array.isArray(overseas.output1)) {
                overseas.output1.forEach(stock => {
                    if (parseFloat(stock.ovrs_cblc_qty) > 0) {
                        console.log(`- ${stock.ovrs_item_name}: ${stock.ovrs_cblc_qty} (수익률: ${stock.evlu_pfls_rt}%)`);
                    }
                });
            } else {
                console.log('보유 종목 없음');
            }
        } else {
            console.log('해외 잔고 조회 실패:', overseas.msg1);
        }

    } catch (error) {
        console.error('Error:', error.message);
    }
}

main();
