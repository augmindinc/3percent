const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onRequest } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const nodemailer = require("nodemailer");
const axios = require("axios");
const cors = require("cors")({ origin: true });

// API 설정 (환경 변수에서 가져옴)
const APP_KEY = process.env.KIS_APP_KEY;
const APP_SECRET = process.env.KIS_APP_SECRET;
const BASE_URL = process.env.KIS_BASE_URL || "https://openapi.koreainvestment.com:9443";
const ALERT_EMAIL = "resmile@gmail.com";
const GMAIL_USER = "resmile@gmail.com";
const GMAIL_PASS = process.env.GMAIL_APP_PASSWORD;

let cachedToken = null;
let tokenExpiry = 0;

async function getAccessToken() {
    if (cachedToken && Date.now() < tokenExpiry) {
        return cachedToken;
    }
    try {
        const response = await axios.post(`${BASE_URL}/oauth2/tokenP`, {
            grant_type: "client_credentials",
            appkey: APP_KEY,
            appsecret: APP_SECRET
        });
        if (response.data.access_token) {
            cachedToken = response.data.access_token;
            tokenExpiry = Date.now() + 2 * 60 * 60 * 1000;
            return cachedToken;
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
    if (!GMAIL_PASS) return;
    try {
        const token = await getAccessToken();
        const rankResp = await axios.get(`${BASE_URL}/uapi/overseas-stock/v1/ranking/trade-vol`, {
            params: { EXCD: "NAS", GUBN: "0" },
            headers: { authorization: `Bearer ${token}`, appkey: APP_KEY, appsecret: APP_SECRET, tr_id: "HHDFS76310010", custtype: "P" }
        });
        const stocks = (rankResp.data.output2 || []).slice(0, 20);
        for (const stock of stocks) {
            const chartResp = await axios.get(`${BASE_URL}/uapi/overseas-price/v1/quotations/inquire-time-itemchartprice`, {
                params: { EXCD: "NAS", SYMB: stock.symb, TM_GUBW: "0" },
                headers: { authorization: `Bearer ${token}`, appkey: APP_KEY, appsecret: APP_SECRET, tr_id: "HHDFS76410000", custtype: "P" }
            });
            const history = chartResp.data.output2 || [];
            if (history.length < 30) continue;
            const prices30 = history.slice(0, 30).map(h => Number(h.last));
            const current = prices30[0];
            const high30 = Math.max(...prices30);
            const low30 = Math.min(...prices30);
            const isUpward = (current >= high30 * 0.997) && (current > low30 * 1.0015) && (current > (prices30[14] + prices30[15] + prices30[16]) / 3);
            const recent5 = history.slice(0, 5);
            const isBeltHold = recent5.some(c => (Number(c.last) > Number(c.open)) && (Number(c.open) <= Number(c.low) * 1.0015) && (Number(c.last) >= Number(c.high) * 0.9985));
            if (isUpward && isBeltHold) {
                await sendEmail({ symbol: stock.symb, name: stock.name, price: stock.last, rate: stock.rate, vol: Number(stock.tvol) });
            }
        }
    } catch (e) { logger.error(e.message); }
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
