const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onRequest } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const nodemailer = require("nodemailer");
const axios = require("axios");
const cors = require("cors")({ origin: true });
const admin = require("firebase-admin");

// Firebase Admin 설정
admin.initializeApp();
const db = admin.firestore();

// API 설정 (환경 변수에서 가져옴)
const APP_KEY = process.env.KIS_APP_KEY;
const APP_SECRET = process.env.KIS_APP_SECRET;
const BASE_URL = process.env.KIS_BASE_URL || "https://openapi.koreainvestment.com:9443";
const ALERT_EMAIL = "resmile@gmail.com";
const GMAIL_USER = "resmile@gmail.com";
const GMAIL_PASS = process.env.GMAIL_APP_PASSWORD;

async function getAccessToken() {
    // 1. Firestore에서 토큰 조회
    const tokenDoc = await db.collection("config").doc("kis_token").get();
    if (tokenDoc.exists) {
        const data = tokenDoc.data();
        // 만료 5분 전까지는 기존 토큰 사용
        if (data.access_token && Date.now() < (data.expiry - 300000)) {
            return data.access_token;
        }
    }

    // 2. 새로운 토큰 발급 (Firestore에 유효한 게 없을 때만)
    try {
        logger.info("Requesting new KIS Access Token...");
        const response = await axios.post(`${BASE_URL}/oauth2/tokenP`, {
            grant_type: "client_credentials",
            appkey: APP_KEY,
            appsecret: APP_SECRET
        });

        if (response.data.access_token) {
            const token = response.data.access_token;
            const expiry = Date.now() + (response.data.expires_in * 1000);

            // 3. Firestore에 저장
            await db.collection("config").doc("kis_token").set({
                access_token: token,
                expiry: expiry,
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });

            return token;
        }
    } catch (error) {
        logger.error("Token Error:", error.response?.data || error.message);
        throw error;
    }
}

async function sendEmail(stock) {
    const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: { user: GMAIL_USER, pass: GMAIL_PASS }
    });
    const mailOptions = {
        from: GMAIL_USER,
        to: ALERT_EMAIL,
        subject: `[강력종목 포착] ${stock.name} (${stock.symbol})`,
        html: `
            <h2>🚀 강력 종목이 포착되었습니다!</h2>
            <p><strong>종목명:</strong> ${stock.name} (${stock.symbol})</p>
            <p><strong>현재가:</strong> $${stock.price}</p>
            <p><strong>등락률:</strong> ${stock.rate}%</p>
            <p><strong>거래량:</strong> ${stock.vol.toLocaleString()}</p>
            <br>
            <h3>✅ 포착 조건</h3>
            <ul>
                <li>거래량 상위 (NAS 상위 20위 내)</li>
                <li>우상향 추세 (30분 고점 돌파 및 눌림목 회복)</li>
                <li>상승 샅바 (최근 5분 내 강력한 매수 캔들 발생)</li>
            </ul>
        `
    };
    try {
        await transporter.sendMail(mailOptions);
        logger.info(`Email sent for ${stock.symbol}`);
    } catch (error) {
        logger.error("Email error:", error);
    }
}

// 1분마다 실행되는 스캐너 함수
exports.marketScanner = onSchedule({
    schedule: "every 1 minutes",
    region: "asia-northeast3",
    timeoutSeconds: 300,
    memory: "256MiB"
}, async (event) => {
    logger.info("Starting Market Scan...");
    if (!GMAIL_PASS) {
        logger.error("GMAIL_PASS is not set");
        return;
    }
    try {
        const token = await getAccessToken();
        const rankResp = await axios.get(`${BASE_URL}/uapi/overseas-stock/v1/ranking/trade-vol`, {
            params: { EXCD: "NAS", GUBN: "0" },
            headers: { authorization: `Bearer ${token}`, appkey: APP_KEY, appsecret: APP_SECRET, tr_id: "HHDFS76310010", custtype: "P" }
        });

        const stocks = (rankResp.data.output2 || []).slice(0, 20);
        logger.info(`Found ${stocks.length} stocks to scan`);

        // 2. 종목별 분봉 데이터 조회 및 스캔
        for (const stock of stocks) {
            try {
                // API 과부하 방지를 위한 지연 (KIS API 제한: 초당 2건)
                await new Promise(resolve => setTimeout(resolve, 500));

                const chartResp = await axios.get(`${BASE_URL}/uapi/overseas-price/v1/quotations/inquire-time-itemchartprice`, {
                    params: {
                        AUTH: "",
                        EXCD: stock.excd || "NAS",
                        SYMB: stock.symb,
                        NMIN: "1",      // 1분봉
                        PINC: "0",      // 당일 데이터
                        NEXT: "",
                        NREC: "120",    // 120개 조회
                        FILL: "",
                        KEYB: ""
                    },
                    headers: {
                        'content-type': 'application/json; charset=utf-8',
                        authorization: `Bearer ${token}`,
                        appkey: APP_KEY,
                        appsecret: APP_SECRET,
                        tr_id: "HHDFS76950200", // 해외주식 분봉조회 TR_ID
                        custtype: "P"
                    },
                    timeout: 5000
                });

                const history = chartResp.data.output2 || [];
                if (history.length < 30) continue;

                const prices30 = history.slice(0, 30).map(h => Number(h.last));
                const current = prices30[0];
                const high30 = Math.max(...prices30);
                const low30 = Math.min(...prices30);
                // 15~30분 평균 (중간값)
                const midAvg = (prices30[14] + prices30[15] + prices30[16]) / 3;

                // 조건 1: 우상향 (최근 30분 내 고점 부근 및 저점 대비 반등)
                const isUpward = (current >= high30 * 0.995) &&
                    (current > low30 * 1.002) &&
                    (current > midAvg);

                // 조건 2: 상승 샅바 (최근 3분 내 발생 여부)
                const recent3 = history.slice(0, 3);
                const isBeltHold = recent3.some(c => {
                    const o = Number(c.open);
                    const l = Number(c.last);
                    const h = Number(c.high);
                    const lw = Number(c.low);
                    const bodySize = l - o;
                    const totalSize = h - lw || 0.0001;

                    return (l > o) && // 양봉
                        (o <= lw + (totalSize * 0.15)) && // 아래꼬리 매우 작음
                        (l >= h - (totalSize * 0.15)) && // 위꼬리 매우 작음
                        (bodySize > totalSize * 0.7); // 몸통이 70% 이상
                });

                if (isUpward && isBeltHold) {
                    logger.info(`Target Found: ${stock.symb} (${stock.name}) - Price: ${current}`);
                    await sendEmail({
                        symbol: stock.symb,
                        name: stock.name,
                        price: current,
                        rate: stock.rate,
                        vol: Number(stock.tvol)
                    });
                }
            } catch (itemError) {
                logger.error(`Error scanning ${stock.symb}:`, itemError.message);
            }
        }
    } catch (e) {
        logger.error("Scanner Main Error:", e.message);
    }
});

// 브라우저용 API 프록시 함수
exports.apiProxy = onRequest({
    region: "asia-northeast3",
    memory: "256MiB",
    maxInstances: 10
}, (req, res) => {
    cors(req, res, async () => {
        const targetUrl = `${BASE_URL}${req.path}?${new URLSearchParams(req.query).toString()}`;
        try {
            const response = await axios({
                method: req.method,
                url: targetUrl,
                data: req.body,
                headers: {
                    ...req.headers,
                    host: new URL(BASE_URL).host,
                    referer: BASE_URL,
                    origin: BASE_URL,
                    "x-forwarded-for": undefined,
                    "x-forwarded-proto": undefined,
                    "x-forwarded-host": undefined
                }
            });
            res.status(response.status).send(response.data);
        } catch (error) {
            res.status(error.response?.status || 500).send(error.response?.data || error.message);
        }
    });
});

// 수동 스캐너 (디버깅용)
exports.testScan = onRequest({
    region: "asia-northeast3",
    memory: "256MiB"
}, (req, res) => {
    cors(req, res, async () => {
        logger.info("Test Scan Triggered");
        const results = [];
        let sampleData = null;
        try {
            const token = await getAccessToken();
            const rankResp = await axios.get(`${BASE_URL}/uapi/overseas-stock/v1/ranking/trade-vol`, {
                params: { EXCD: "NAS", GUBN: "0" },
                headers: {
                    'content-type': 'application/json; charset=utf-8',
                    authorization: `Bearer ${token}`,
                    appkey: APP_KEY,
                    appsecret: APP_SECRET,
                    tr_id: "HHDFS76310010",
                    custtype: "P"
                }
            });

            const stocks = (rankResp.data.output2 || []).slice(0, 10);
            for (const stock of stocks) {
                await new Promise(resolve => setTimeout(resolve, 500));

                try {
                    const chartResp = await axios.get(`${BASE_URL}/uapi/overseas-price/v1/quotations/inquire-time-itemchartprice`, {
                        params: {
                            AUTH: "",
                            EXCD: "NAS",
                            SYMB: stock.symb,
                            NMIN: "1",
                            PINC: "0",
                            NEXT: "",
                            NREC: "120",
                            FILL: "",
                            KEYB: ""
                        },
                        headers: {
                            'content-type': 'application/json; charset=utf-8',
                            authorization: `Bearer ${token}`,
                            appkey: APP_KEY,
                            appsecret: APP_SECRET,
                            tr_id: "HHDFS76950200",
                            custtype: "P"
                        },
                        timeout: 5000
                    });

                    const history = chartResp.data.output2 || [];
                    if (history.length < 5) {
                        results.push({ symbol: stock.symb, error: "Insufficient data", msg: chartResp.data.msg1 });
                        continue;
                    }

                    const prices = history.map(h => Number(h.last)).filter(p => !isNaN(p) && p > 0);
                    if (prices.length < 5) continue;

                    if (!sampleData) {
                        sampleData = {
                            symbol: stock.symb,
                            first_candle: history[0],
                            prices_count: prices.length
                        };
                    }

                    const current = prices[0];
                    const high30 = Math.max(...prices.slice(0, 30));
                    const low30 = Math.min(...prices.slice(0, 30));
                    const avg20 = prices.slice(0, Math.min(20, prices.length)).reduce((a, b) => a + b, 0) / Math.min(20, prices.length);

                    const isUpward = (current > avg20) && (current >= high30 * 0.993);
                    const isBeltHold = history.slice(0, 3).some(c => {
                        const o = Number(c.open);
                        const l = Number(c.last);
                        const h = Number(c.high);
                        const lw = Number(c.low);
                        const body = l - o;
                        const total = h - lw || 0.0001;
                        return (body > 0) && (body > total * 0.7) && (o <= lw + (total * 0.15)) && (l >= h - (total * 0.15));
                    });

                    results.push({
                        symbol: stock.symb,
                        name: stock.name,
                        price: current,
                        match: isUpward && isBeltHold,
                        conditions: { isUpward, isBeltHold },
                        data: { high30, low30, avg20 }
                    });

                    if (isUpward && isBeltHold) {
                        await sendEmail({ symbol: stock.symb, name: stock.name, price: current, rate: stock.rate, vol: Number(stock.tvol) });
                    }
                } catch (itemError) {
                    results.push({ symbol: stock.symb, error: itemError.message });
                }
            }
            res.send({
                success: true,
                sample: sampleData,
                matches: results.filter(r => r.match),
                results
            });
        } catch (e) {
            res.status(500).send({ error: e.message });
        }
    });
});

