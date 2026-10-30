/* Bildol Gold Terminal — giao diện kiểu RyanFX.
   Giá realtime: Binance XAUUSDT perp (dự phòng PAXG/USDT; kline có taker-buy volume => CVD theo phe chủ động).
   Mốc Options / vĩ mô: backend /api/state, làm mới mỗi 20 giây.
   Lớp phủ (canvas) vẽ mốc GC bên trái, GLD bên phải, đường cong Net GEX ngay trên chart.
   SMC (smc.js): cấu trúc H4 + khung chart, OTE/Extreme, thanh khoản, nến quét, CL1 Buy/Sell hồi & CL2 thuận (KB1/KB2/KB3). */
"use strict";

const $ = (s) => document.querySelector(s);
const LC = window.LightweightCharts;
const TZ = 7 * 3600; // trục thời gian theo giờ Việt Nam
const TF_SEC = { "1m": 60, "3m": 180, "5m": 300, "15m": 900, "30m": 1800, "1h": 3600, "4h": 14400, "1d": 86400 };
const C = { gc: "#e0a83a", gld: "#a78bfa", up: "#26b384", down: "#e5534b", vp: "#6b8aa8", muted: "#85909c", fg: "#e4e1d9", flip: "#c4b5fd", mag: "#f2b84b", bg: "#0b0e12" };
const PAPER_KEY = "bildol.paper.v1";
// Bản web tĩnh (GitHub Pages / điện thoại): đọc file JSON do máy đẩy lên thay cho API của engine; không gửi gì về máy.
const STATIC = !!window.BILDOL_STATIC;
const API = (p) => {
  if (!STATIC) return p;
  const [path, q] = p.split("?");
  if (path === "/api/klines") return `klines_${new URLSearchParams(q).get("tf")}.json`;
  return ({ "/api/state": "state.json", "/api/tv": "tv.json", "/api/journal": "journal.json" })[path] || p;
};

const S = {
  state: null, cfg: null, tf: "5m", candles: [], ws: null, demoTimer: null,
  signals: [], lastSigIdx: -1e9, primary: "GC", profSrc: "GC", profScrolled: false, tenor: "all",
  paper: null, planLines: [],
  h4: [], smc: null, h4Ts: 0,
};

// ─────────────────────────── tiện ích ───────────────────────────
const fmt = (x, d = 2) => (x == null || !isFinite(x) ? "—" : Number(x).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }));
const fmtK = (v) => {
  if (v == null || !isFinite(v)) return "—";
  const a = Math.abs(v);
  return a >= 1e9 ? (v / 1e9).toFixed(2) + "B" : a >= 1e6 ? (v / 1e6).toFixed(1) + "M" : a >= 1e3 ? (v / 1e3).toFixed(1) + "K" : String(Math.round(v));
};
const sgn = (x, d = 1) => (x == null || !isFinite(x) ? "—" : (x >= 0 ? "+" : "") + x.toFixed(d));
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const vnClock = (t) => new Date((t + TZ) * 1000).toISOString().slice(11, 16);
const vnDate = (t) => new Date((t + TZ) * 1000).toISOString().slice(0, 10);
const nowSec = () => Math.floor(Date.now() / 1000);
function chip(sel, cls, text) { const el = $(sel); el.className = "chip " + cls; el.lastChild.textContent = text; }
const opt = (src) => S.state?.options?.[src] || null;
const prim = () => opt(S.primary) || opt(S.primary === "GC" ? "GLD" : "GC");
// Bước 3: ô chọn kỳ hạn chỉ đổi phần XEM (Strike Profile + mốc vẽ trên chart); tín hiệu & Agent luôn dùng "Mọi kỳ hạn"
const optV = (src) => { const o = opt(src); return !o || S.tenor === "all" ? o : (o.by_tenor?.[S.tenor] || o); };
const primV = () => optV(S.primary) || optV(S.primary === "GC" ? "GLD" : "GC");
const TENOR_TXT = { all: "Mọi kỳ hạn", short: "0DTE + Tuần (≤ 7 ngày)", month: "> 7 ngày (Tháng)" };
function lastPrice() { const c = S.candles; return c.length ? c[c.length - 1].close : null; }

// ─────────────────────────── chart ───────────────────────────
function baseOpts() {
  return {
    autoSize: true,
    layout: { background: { type: "solid", color: C.bg }, textColor: C.muted, fontFamily: "IBM Plex Mono, monospace", fontSize: 11 },
    grid: { vertLines: { color: "#141a20" }, horzLines: { color: "#141a20" } },
    rightPriceScale: { borderColor: "#232b35", scaleMargins: { top: 0.08, bottom: 0.08 } },
    timeScale: { borderColor: "#232b35", timeVisible: true, secondsVisible: false, rightOffset: 30 },
    crosshair: { mode: 0 },
  };
}
let chart, candleS, cvdChart, cvdLine, deltaHist, bigLine, bigBuyLine, bigSellLine;
function initCharts() {
  chart = LC.createChart($("#chart"), baseOpts());
  candleS = chart.addCandlestickSeries({ upColor: C.up, downColor: C.down, borderVisible: false, wickUpColor: C.up, wickDownColor: C.down, priceFormat: { type: "price", precision: 2, minMove: 0.01 } });
  cvdChart = LC.createChart($("#cvd"), baseOpts());
  deltaHist = cvdChart.addHistogramSeries({ priceScaleId: "delta", priceFormat: { type: "volume" } });
  cvdChart.priceScale("delta").applyOptions({ scaleMargins: { top: 0.55, bottom: 0 } });
  cvdLine = cvdChart.addLineSeries({ color: C.gc, lineWidth: 2, priceFormat: { type: "volume" } });
  // CVD lệnh lớn (oz) – thang riêng bên trái
  bigLine = cvdChart.addLineSeries({ color: C.gld, lineWidth: 2, priceScaleId: "big", priceFormat: { type: "volume" }, title: "Ròng lớn" });
  bigBuyLine = cvdChart.addLineSeries({ color: C.up, lineWidth: 1, lineStyle: 2, priceScaleId: "big", priceFormat: { type: "volume" }, title: "Mua lớn" });
  bigSellLine = cvdChart.addLineSeries({ color: C.down, lineWidth: 1, lineStyle: 2, priceScaleId: "big", priceFormat: { type: "volume" }, title: "Bán lớn" });
  cvdChart.priceScale("big").applyOptions({ visible: true, scaleMargins: { top: 0.08, bottom: 0.5 } });
  cvdChart.applyOptions({ leftPriceScale: { visible: false } });
  let syncing = false;
  const link = (a, b) => a.timeScale().subscribeVisibleLogicalRangeChange((r) => {
    if (syncing || !r) return; syncing = true; b.timeScale().setVisibleLogicalRange(r); syncing = false;
  });
  link(chart, cvdChart); link(cvdChart, chart);
}

// ─────────────────────────── dữ liệu giá ───────────────────────────
// Nến lấy từ Binance (XAUUSDT) rồi cộng chênh lệch về XAUUSD giao ngay (S.basis) để khớp giá TradingView/broker
const mk = (openMs, o, h, l, c, v, takerBuy) => { const b = S.basis || 0; return { time: Math.floor(openMs / 1000), open: o + b, high: h + b, low: l + b, close: c + b, vol: v, delta: 2 * takerBuy - v }; };
function basisNow() { const b = S.state?.basis; return b && isFinite(b.value) ? b.value : 0; }
const sessKey = (t) => Math.floor((t + 2 * 3600) / 86400); // phiên vàng mở 05:00 giờ VN
const shift = (c) => ({ time: c.time + TZ, open: c.open, high: c.high, low: c.low, close: c.close });
const dcol = (d) => (d >= 0 ? "rgba(38,179,132,.55)" : "rgba(229,83,75,.55)");

function recomputeCvd(from = 0) {
  const c = S.candles;
  for (let i = Math.max(0, from); i < c.length; i++) {
    const p = c[i - 1];
    c[i].cvd = (p && sessKey(p.time) === sessKey(c[i].time) ? p.cvd : 0) + c[i].delta;
  }
}

function feeds() {
  const f = S.cfg.price_feeds;
  if (f && f.length) return f;
  return S.cfg.binance_rest.map((h, i) => ({ symbol: S.cfg.price_symbol, name: S.cfg.price_symbol, rest: h, kpath: "/api/v3/klines", ws: S.cfg.binance_ws[i % S.cfg.binance_ws.length] }));
}
// ── Khớp nến với TradingView (FXCM:XAUUSD) ──
// Binance chạy 24/7 còn FXCM nghỉ cuối tuần + 17:00–18:00 New York mỗi ngày -> bỏ các nến ngoài giờ đó.
// Nến H4/D1 của TradingView neo 18:00 New York (không phải 00:00 UTC như Binance) -> gộp lại từ nến 1h.
const AGG = { "4h": 14400, "1d": 86400 };
const h4From = () => Math.floor(Date.parse(S.cfg?.smc?.h4_from || "2026-06-01T00:00:00+07:00") / 1000);
async function fetchRange(f, interval, fromSec) {
  const out = [], lim = /fapi/.test(f.kpath) ? 1500 : 1000;
  let from = fromSec * 1000;
  for (let page = 0; page < 14; page++) {
    const r = await fetch(`${f.rest}${f.kpath}?symbol=${f.symbol}&interval=${interval}&limit=${lim}&startTime=${from}`);
    if (!r.ok) throw new Error("HTTP " + r.status);
    const a = await r.json();
    out.push(...a);
    if (a.length < lim) break;
    from = a[a.length - 1][0] + 1;
  }
  return out.map((k) => mk(k[0], +k[1], +k[2], +k[3], +k[4], +k[5], +k[9])).filter((k) => SMC.fxOpen(k.time));
}
async function loadTF(f, tf, fromSec) {
  if (AGG[tf]) { const h1 = await fetchRange(f, "1h", fromSec); return { rows: SMC.aggregate(h1, AGG[tf]), h1 }; }
  return { rows: await fetchRange(f, tf, fromSec), h1: null };
}
// giữ từ nến ngay TRƯỚC mốc t0 (nến mồi, giống Pine: trạng thái khởi tạo bằng nến này, xử lý từ nến kế tiếp)
const fromSeed = (a, t0) => { const k = a.findIndex((x) => x.time >= t0); return k < 0 ? a : a.slice(Math.max(0, k - 1)); };
async function loadHistory() {
  // mốc bắt đầu cấu trúc khung chart: CÙNG công thức với Pine (00:00 giờ VN, theo ltf_bars), không sớm hơn mốc H4
  const t0 = SMC.ltfStart(nowSec(), TF_SEC[S.tf], S.cfg?.smc?.ltf_bars ?? 1000, h4From());
  for (const f of feeds()) {
    try {
      S.basis = f.symbol === feeds()[0].symbol ? basisNow() : 0; // chênh lệch chỉ đo cho nguồn chính
      const { rows, h1 } = await loadTF(f, S.tf, t0 - 3 * 86400); // lùi 3 ngày để có nến mồi kể cả qua cuối tuần
      if (rows.length < 30) continue;
      S.candles = fromSeed(rows, t0); S.h1 = h1; S.ltfT0 = t0;
      S.feed = f;
      $("#sym").textContent = S.basis ? `XAUUSD (${f.symbol} ${S.basis >= 0 ? "+" : ""}${S.basis.toFixed(2)})` : f.symbol;
      return true;
    } catch (e) { /* thử nguồn khác */ }
  }
  return false;
}

// ─────────────────────────── SMC: nến H4 + phân tích ───────────────────────────
const H4_SEC = 14400;
function smcCfg() {
  const m = S.cfg?.smc || {}, sc = S.cfg?.signals || {};
  return {
    oteLo: m.ote_lo ?? 0.705, oteHi: m.ote_hi ?? 0.79, eqTol: m.eq_tol ?? 1.5, trendline: m.trendline ?? true,
    sweepWin: m.sweep_window ?? 6, slBuf: Math.min(5, m.sl_buffer ?? 3), tol: m.touch_tol ?? sc.touch_tol ?? 2, expiryH4: m.expiry_h4 ?? 6, kb3Atr: m.kb3_atr ?? 2, kb2Once: m.kb2_once ?? true,
    kb2: [300, 900].includes(TF_SEC[S.tf]),   // KB2 (confirm) chỉ theo cấu trúc M5 / M15
    sessionOk: m.session_only ? inUsSession : null, tfSec: TF_SEC[S.tf], tfName: S.tf.toUpperCase().replace(/^(\d+)M$/, "M$1").replace(/^(\d+)H$/, "H$1"),
    nextStrike: (p, above) => nextStrike(p, above),
    levels: (() => { const L = primaryLevels(); return L ? { cw: L.call_wall, pw: L.put_wall, flip: L.gamma_flip } : {}; })(),
  };
}
async function loadHTF() {
  const f = S.feed; if (!f) return false;
  try {
    // dựng H4 từ mốc cố định (config smc.h4_from) để khớp TradingView và không trôi theo thời gian
    // nến H4 theo giờ FXCM, gộp từ 1h; khung chart đang là H4 thì dùng luôn dữ liệu chart (cùng mốc bắt đầu)
    if (S.tf === "4h" && S.candles.length) S.h4 = S.candles;
    else S.h4 = fromSeed((await loadTF(f, "4h", h4From() - 3 * 86400)).rows, h4From());
    S.h4Ts = Date.now();
    return true;
  } catch { return false; }
}
// lệnh SMC hợp lệ (bỏ lệnh bị loại vì RR < 1) và lệnh đã khớp dưới dạng "tín hiệu" cho Agent
const smcOrders = () => (S.smc?.orders || []).filter((o) => o.status !== "skip");
const oid = (o) => `${o.name}${o.side}${o.src}`;
function smcFilled() {
  const c = S.candles;
  return smcOrders().filter((o) => o.fillI != null && c[o.fillI]).map((o) => ({ ...o, i: o.fillI, time: c[o.fillI].time, type: o.txt, smc: true }));
}
function runSMC(lastClosed = false) {
  const c = S.candles;
  if (typeof SMC === "undefined" || c.length < 30 || S.h4.length < 10) { S.smc = null; return; }
  // chỉ dùng nến ĐÃ ĐÓNG (bỏ nến đang chạy) để không vẽ lại
  S.smc = SMC.analyze(lastClosed ? c : c.slice(0, -1), S.h4, H4_SEC, smcCfg());
}
function demoHistory() {
  const step = TF_SEC[S.tf], now = Math.floor(nowSec() / step) * step;
  let p = S.state?.refs?.chart || 4000, seed = 42;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  S.candles = [];
  for (let i = 600; i >= 0; i--) {
    const o = p; p += (rnd() - 0.5) * 2.4 * Math.sqrt(step / 60);
    const v = 20 + rnd() * 120;
    S.candles.push({ time: now - i * step, open: o, high: Math.max(o, p) + rnd(), low: Math.min(o, p) - rnd(), close: p, vol: v, delta: (p > o ? 1 : -1) * v * rnd() * 0.8 });
  }
}

function stopFeeds() {
  if (S.ws) { const w = S.ws; S.ws = null; w.close(); }
  if (S.demoTimer) { clearInterval(S.demoTimer); S.demoTimer = null; }
}

function startDemoFeed() {
  stopFeeds();
  chip("#chipWs", "mid", "Feed DEMO");
  S.demoTimer = setInterval(() => {
    const step = TF_SEC[S.tf], t = Math.floor(nowSec() / step) * step, last = S.candles[S.candles.length - 1];
    if (last.time !== t) { onCandle(last, true); onCandle({ time: t, open: last.close, high: last.close, low: last.close, close: last.close, vol: 0, delta: 0 }, false); return; }
    const p = last.close + (Math.random() - 0.5) * 0.8, v = Math.random() * 6;
    onCandle({ ...last, close: p, high: Math.max(last.high, p), low: Math.min(last.low, p), vol: last.vol + v, delta: last.delta + (p >= last.close ? v : -v) }, false);
  }, 1000);
}

function connectWs(i = 0) {
  // luồng nến realtime; Binance Futures đã chuyển sang /market/ws -> thử lần lượt các URL, có watchdog chống "LIVE mà đứng giá"
  const f = S.feed || feeds()[0];
  let urls = [f.ws, ...(f.ws_alt || [])];
  if (/fstream\.binance\.com\/ws$/.test(f.ws)) urls = ["wss://fstream.binance.com/market/ws", f.ws]; // URL cũ đã bị Binance ngừng 23/04/2026
  const ws = new WebSocket(`${urls[i % urls.length]}/${f.symbol.toLowerCase()}@kline_${AGG[S.tf] ? "1h" : S.tf}`);
  S.ws = ws; S.wsMsg = Date.now(); S.wsIdx = i;
  ws.onopen = () => { chip("#chipWs", "ok", "Feed giá"); $("#livePill").className = "live"; $("#livePill").textContent = "LIVE"; if (i > 0) resync(); };
  ws.onmessage = (ev) => {
    S.wsMsg = Date.now(); const k = JSON.parse(ev.data).k; if (!k) return;
    const c = mk(k.t, +k.o, +k.h, +k.l, +k.c, +k.v, +k.V);
    if (!SMC.fxOpen(c.time)) return; // ngoài giờ FXCM: bỏ (khớp TradingView)
    if (AGG[S.tf]) onAggHour(c, k.x); else onCandle(c, k.x);
  };
  ws.onclose = () => {
    if (S.ws !== ws) return;
    chip("#chipWs", "bad", "Mất feed – đang nối lại"); $("#livePill").className = "live off"; $("#livePill").textContent = "OFF";
    setTimeout(() => { if (S.ws === ws) connectWs(i + 1); }, 3000);
  };
  ws.onerror = () => ws.close();
}
// tải lại nến bị lỡ khi mất kết nối / tab ngủ, rồi vẽ lại
async function resync() {
  if (S.resyncing || !S.feed) return;
  S.resyncing = true;
  try {
    if (await loadHistory()) { await loadHTF(); drawAll(); runSMC(); setMarkers(); renderAll(); }
  } finally { S.resyncing = false; }
}
setInterval(() => {
  if (!S.ws || S.ws.readyState !== 1) return;
  if (Date.now() - S.wsMsg > 20000) { S.ws.close(); } // 20 giây không có dữ liệu -> nối lại (thử URL kế tiếp)
}, 5000);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && S.ws && Date.now() - (S.wsMsg || 0) > 15000) resync();
});

// khung 4h/1d: nhận nến 1h, gộp lại nến lớn đang chạy theo giờ FXCM
function onAggHour(c1, closed1) {
  const sec = AGG[S.tf], h = S.h1 || (S.h1 = []), last = h[h.length - 1];
  if (last && last.time === c1.time) h[h.length - 1] = c1; else if (!last || c1.time > last.time) h.push(c1); else return;
  const b = SMC.bucketOf(c1.time, sec);
  let i = h.length; while (i > 0 && SMC.bucketOf(h[i - 1].time, sec) === b) i--;
  if (h.length > 2000) h.splice(0, h.length - 2000);
  const agg = SMC.aggregate(h.slice(i), sec)[0];
  let nx = c1.time + 3600; for (let g = 0; g < 80 && !SMC.fxOpen(nx); g++) nx += 3600; // giờ mở cửa kế tiếp
  onCandle(agg, closed1 && SMC.bucketOf(nx, sec) !== b);
}
function onCandle(c, closed) {
  const a = S.candles, last = a[a.length - 1];
  if (last && last.time === c.time) a[a.length - 1] = c; else if (!last || c.time > last.time) a.push(c); else return;
  recomputeCvd(a.length - 1);
  const x = a[a.length - 1];
  candleS.update(shift(x));
  cvdLine.update({ time: x.time + TZ, value: x.cvd });
  deltaHist.update({ time: x.time + TZ, value: x.delta, color: dcol(x.delta) });
  paperTick(x.close);
  renderQuote();
  if (closed) {
    renderBig();
    if (STATIC) staticRecompute();
    const s = evaluate(a.length - 1, true);
    if (s) addSignal(s, true);
    smcOnClose(a.length - 1);
    renderAgent();
  }
}

async function smcOnClose(idx) {
  // nến H4 vừa đóng (hoặc dữ liệu H4 cũ hơn 10 phút) -> tải lại H4
  // nến H4 (giờ FXCM) vừa đóng: nến mở cửa kế tiếp thuộc nến H4 khác
  const k = S.candles[idx], st = Math.min(TF_SEC[S.tf], 3600);
  let nx = k.time + TF_SEC[S.tf]; for (let g = 0; g < 400 && !SMC.fxOpen(nx); g++) nx += st;
  if (S.tf === "4h" || SMC.bucketOf(k.time, H4_SEC) !== SMC.bucketOf(nx, H4_SEC) || Date.now() - S.h4Ts > 600000) await loadHTF();
  const known = new Set(smcOrders().map(oid));
  runSMC(true); // nến idx vừa đóng và đang là nến cuối của S.candles
  for (const o of smcOrders()) {
    if (o.fillI === idx) addSmcSignal({ ...o, type: o.txt });           // lệnh vừa khớp (KB2 vào ngay, KB1/KB3 chạm giá Limit)
    else if (o.status === "pending" && !known.has(oid(o))) notifyPending(o); // lệnh chờ mới
  }
  setMarkers();
  journalSyncSMC(); journalTrack(); renderJournal();
}
function notifyPending(o) {
  if ("Notification" in window && Notification.permission === "granted")
    new Notification(`${o.name} ${o.side} LIMIT ${fmt(o.entry)}`, { body: `${o.txt}\nSL ${fmt(o.sl)} · TP1 ${fmt(o.tp1)} · TP2 ${fmt(o.tp2)}` });
}
function addSmcSignal(s) {
  if ($("#autoTrade").checked && !S.paper.pos) {
    const plan = planFor(s);
    paperOpen(s.side, plan.lots, s.sl, s.tp1, `Tự động: ${s.type}`);
  }
  if ("Notification" in window && Notification.permission === "granted")
    new Notification(`${s.side} – ${s.type}`, { body: `Entry ${fmt(s.entry)} · SL ${fmt(s.sl)} · TP1 ${fmt(s.tp1)} · TP2 ${fmt(s.tp2)}` });
}
function drawAll() {
  recomputeCvd();
  candleS.setData(S.candles.map(shift));
  cvdLine.setData(S.candles.map((c) => ({ time: c.time + TZ, value: c.cvd })));
  deltaHist.setData(S.candles.map((c) => ({ time: c.time + TZ, value: c.delta, color: dcol(c.delta) })));
  chart.timeScale().scrollToRealTime();
}

async function startFeed() {
  stopFeeds();
  setTimeout(startBig, 1500);
  const demo = !!S.state?.demo;
  const ok = !demo && (await loadHistory());
  if (!ok) demoHistory();
  if (ok) await loadHTF();
  drawAll();
  runSMC();
  replaySignals();
  renderAll();
  if (ok) connectWs();
  else {
    startDemoFeed();
    if (!demo) addWarn("Không tải được giá Binance, đang hiển thị giá DEMO. Kiểm tra mạng hoặc đổi binance_rest trong config.json.");
    $("#livePill").className = "live demo"; $("#livePill").textContent = "DEMO";
  }
}

// ─────────────────────────── lớp phủ: mốc GC / GLD + đường cong GEX ───────────────────────────
const ov = { cv: null, ctx: null, dpr: 1 };
function initOverlay() {
  ov.cv = $("#ov"); ov.ctx = ov.cv.getContext("2d");
  const resize = () => {
    const r = $("#chartWrap").getBoundingClientRect();
    ov.dpr = window.devicePixelRatio || 1;
    ov.cv.width = Math.round(r.width * ov.dpr); ov.cv.height = Math.round(r.height * ov.dpr);
    ov.cv.style.width = r.width + "px"; ov.cv.style.height = r.height + "px";
    drawOverlay();
  };
  new ResizeObserver(resize).observe($("#chartWrap"));
  chart.timeScale().subscribeVisibleLogicalRangeChange(() => drawOverlay());
  setInterval(drawOverlay, 400); // thang giá tự co giãn theo giá, vẽ lại định kỳ
  resize();
}

function tagBox(ctx, x, y, text, color, align, strong) {
  ctx.font = `${strong ? 600 : 500} 10.5px "IBM Plex Mono", monospace`;
  const w = ctx.measureText(text).width + 10, h = 15, x0 = align === "right" ? x - w : x;
  ctx.fillStyle = strong ? color : "rgba(11,14,18,.88)";
  ctx.strokeStyle = color; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x0, y - h / 2, w, h, 3) : ctx.rect(x0, y - h / 2, w, h); ctx.fill(); ctx.stroke();
  ctx.fillStyle = strong ? "#0b0e12" : color;
  ctx.textBaseline = "middle"; ctx.textAlign = "left";
  ctx.fillText(text, x0 + 5, y + 0.5);
}

function hline(ctx, y, x0, x1, color, width, dash, alpha) {
  ctx.save(); ctx.globalAlpha = alpha ?? 1; ctx.strokeStyle = color; ctx.lineWidth = width; ctx.setLineDash(dash || []);
  ctx.beginPath(); ctx.moveTo(x0, Math.round(y) + 0.5); ctx.lineTo(x1, Math.round(y) + 0.5); ctx.stroke(); ctx.restore();
}

function drawOverlay() {
  if (!ov.ctx || !candleS) return;
  const ctx = ov.ctx, dpr = ov.dpr;
  const W = ov.cv.width / dpr, H = ov.cv.height / dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  const psW = chart.priceScale("right").width() || 70;
  const plotW = W - psW, tsH = 28, plotH = H - tsH;
  const Y = (p) => { const y = candleS.priceToCoordinate(p); return y == null || y < 2 || y > plotH - 2 ? null : y; };
  const p0 = lastPrice();

  // Mốc theo nguồn: GC nhãn trái, GLD nhãn phải (giống RyanFX)
  const layers = [["GC", C.gc, $("#lyKey").checked, "left"], ["GLD", C.gld, $("#lyGLD").checked, "right"]];
  for (const [src, color, on, side] of layers) {
    const o = optV(src);
    if (!o || !on) continue;
    const maxOI = Math.max(1, ...o.strikes.map((s) => s.call_oi + s.put_oi));
    const labelSet = new Set([...o.strikes].sort((x, y) => (y.call_oi + y.put_oi) - (x.call_oi + x.put_oi)).slice(0, 10).map((s) => s.strike));
    for (const s of o.strikes) {
      const y = Y(s.chart); if (y == null) continue;
      const oi = s.call_oi + s.put_oi, share = oi / maxOI;
      const isCW = s.strike === o.call_wall, isPW = s.strike === o.put_wall;
      if (share < 0.12 && !isCW && !isPW) continue;
      const lc = isCW ? C.down : isPW ? C.up : color;
      hline(ctx, y, 0, plotW, lc, isCW || isPW ? 1.6 : 1, isCW || isPW ? [] : [4, 4], isCW || isPW ? 0.95 : 0.25 + 0.6 * share);
      if (labelSet.has(s.strike) || isCW || isPW) {
        const d = s.d_oi != null ? ` ${s.d_oi >= 0 ? "+" : ""}${fmtK(s.d_oi)}` : "";
        const txt = `${src} ${s.strike} · ${Math.round(share * 100)}%${isCW ? " CW" : isPW ? " PW" : ""}${d}`;
        tagBox(ctx, side === "left" ? 6 : plotW - 6, y, txt, lc, side, isCW || isPW);
      }
    }
  }

  // Flip / Magnet / Max Pain của nguồn chính
  const P = primV();
  if (P && $("#lyKey").checked) {
    const c = P.chart;
    const yF = c.gamma_flip != null ? Y(c.gamma_flip) : null;
    if (yF != null) { hline(ctx, yF, 0, plotW, C.flip, 1.2, [6, 4], 0.9); tagBox(ctx, plotW * 0.5, yF, `Γ FLIP ${fmt(c.gamma_flip)}`, C.flip, "left", true); }
    const yM = c.magnet != null ? Y(c.magnet) : null;
    if (yM != null) tagBox(ctx, plotW * 0.5, yM, `◎ MAGNET ${fmt(c.magnet)}`, C.mag, "left", true);
    const yP = c.max_pain != null ? Y(c.max_pain) : null;
    if (yP != null) { hline(ctx, yP, 0, plotW, "#9aa3ad", 1, [2, 3], 0.6); tagBox(ctx, plotW * 0.5 + 150, yP, `MaxPain ${fmt(c.max_pain)}`, "#9aa3ad", "left", false); }
  }

  // Volume profile phiên
  const vp = S.state?.volume_profile;
  if (vp && $("#lyVP").checked) {
    for (const [k, lab] of [["poc", "POC"], ["vah", "VAH"], ["val", "VAL"]]) {
      const y = Y(vp[k]); if (y == null) continue;
      hline(ctx, y, 0, plotW, C.vp, k === "poc" ? 1.5 : 1, k === "poc" ? [] : [3, 3], 0.8);
      ctx.fillStyle = C.vp; ctx.font = "10px 'IBM Plex Mono', monospace"; ctx.textAlign = "left"; ctx.textBaseline = "bottom";
      ctx.fillText(`${lab} ${fmt(vp[k])}`, 6, y - 2);
    }
  }

  // Đường cong Net GEX theo strike (nguồn chính)
  if (P && $("#lyGex").checked && P.strikes.length > 1) {
    const cx = plotW * 0.78, half = plotW * 0.1;
    const gmax = Math.max(1, ...P.strikes.map((s) => Math.abs(s.net_gex)));
    const pts = P.strikes.map((s) => ({ s, y: candleS.priceToCoordinate(s.chart) })).filter((p) => p.y != null && p.y > -50 && p.y < plotH + 50).sort((a, b) => a.y - b.y);
    if (pts.length > 1) {
      let gap = Infinity; for (let i = 1; i < pts.length; i++) gap = Math.min(gap, pts[i].y - pts[i - 1].y);
      const bh = Math.max(2, Math.min(10, gap * 0.6));
      ctx.save(); ctx.globalAlpha = 0.5; ctx.strokeStyle = "#9aa3ad"; ctx.setLineDash([2, 3]);
      ctx.beginPath(); ctx.moveTo(cx, Math.max(0, pts[0].y)); ctx.lineTo(cx, Math.min(plotH, pts[pts.length - 1].y)); ctx.stroke(); ctx.restore();
      for (const p of pts) {
        const x = cx + (p.s.net_gex / gmax) * half;
        ctx.fillStyle = p.s.net_gex >= 0 ? "rgba(38,179,132,.45)" : "rgba(229,83,75,.45)";
        ctx.fillRect(Math.min(cx, x), p.y - bh / 2, Math.abs(x - cx), bh);
      }
      ctx.strokeStyle = C.mag; ctx.lineWidth = 1.6; ctx.setLineDash([]);
      ctx.beginPath(); pts.forEach((p, i) => { const x = cx + (p.s.net_gex / gmax) * half; i ? ctx.lineTo(x, p.y) : ctx.moveTo(x, p.y); }); ctx.stroke();
      const top = [...pts].sort((a, b) => Math.abs(b.s.net_gex) - Math.abs(a.s.net_gex)).slice(0, 6);
      ctx.font = "10px 'IBM Plex Mono', monospace"; ctx.textBaseline = "middle";
      for (const p of top) {
        if (p.y < 4 || p.y > plotH - 4) continue;
        const g = p.s.net_gex, x = cx + (g / gmax) * half;
        ctx.fillStyle = g >= 0 ? C.up : C.down; ctx.textAlign = g >= 0 ? "left" : "right";
        ctx.fillText(`${g >= 0 ? "+" : ""}${fmtK(g)}`, x + (g >= 0 ? 4 : -4), p.y);
      }
      ctx.fillStyle = C.muted; ctx.textAlign = "center"; ctx.textBaseline = "top";
      ctx.fillText(`Net GEX ${P.source} /1%`, cx, 30);
    }
  }
  // Bước 5: vùng hedge lớn của LP (≥ ngưỡng HĐ/10 USD) — tô dải ngang mờ
  const hz = hedgeSt();
  if (hz && $("#lyGex").checked) {
    for (const z of hz.zones) {
      const y1 = candleS.priceToCoordinate(z.hi), y2 = candleS.priceToCoordinate(z.lo);
      if (y1 == null || y2 == null || y2 < 0 || y1 > plotH) continue;
      const a = Math.max(0, y1), b = Math.min(plotH, y2), col = z.kind === "accel" ? C.down : C.up;
      ctx.fillStyle = z.kind === "accel" ? "rgba(229,83,75,.07)" : "rgba(38,179,132,.07)"; ctx.fillRect(0, a, plotW, Math.max(1, b - a));
      if (b - a > 8) tagBox(ctx, plotW * 0.78, (a + b) / 2, `HEDGE ${z.kind === "accel" ? "−Γ" : "+Γ"} ${Math.abs(z.peak).toLocaleString("en-US")} HĐ/${hz.win}$`, col, "left", false);
    }
  }
  if ($("#lySMC")?.checked && S.smc) drawSMC(ctx, plotW, plotH);
  $("#chartInfo").textContent = P ? `${P.source} · ${P.strikes.length} strikes · Σ ${fmtK(P.net_gex)} · ${P.regime === "POSITIVE" ? "+Γ" : P.regime === "NEGATIVE" ? "−Γ" : "?"}${p0 != null ? "" : ""}` : "Chưa có dữ liệu Options";
}

// Vẽ SMC: vùng Premium/Discount, thanh khoản, trendline, HH/HL/LH/LL, BOS/CHoCH
function drawSMC(ctx, plotW, plotH) {
  const R = S.smc, c = S.candles, ts = chart.timeScale(), fr = R.frame;
  if (!c.length) return;
  const X = (t) => { if (t == null) return 0; const x = ts.timeToCoordinate(t + TZ); return x == null ? (t < c[0].time ? 0 : plotW) : Math.max(0, Math.min(plotW, x)); };
  const Yr = (p) => { const y = candleS.priceToCoordinate(p); return y == null ? null : Math.max(-2, Math.min(plotH + 2, y)); };
  const box = (t0, p1, p2, fill, stroke, label, where) => {
    const y1 = Yr(p1), y2 = Yr(p2); if (y1 == null || y2 == null) return;
    const x0 = X(t0), top = Math.min(y1, y2), hh = Math.abs(y2 - y1);
    if (hh < 0.5 || top > plotH || top + hh < 0) return;
    ctx.fillStyle = fill; ctx.fillRect(x0, top, plotW - x0, hh);
    ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.setLineDash([]); ctx.strokeRect(x0 + 0.5, top + 0.5, plotW - x0 - 1, hh - 1);
    if (label) {
      ctx.font = "600 10px 'IBM Plex Mono', monospace"; ctx.fillStyle = stroke; ctx.textAlign = "right";
      ctx.textBaseline = where === "top" ? "top" : "bottom";
      const ly = where === "top" ? Math.max(top + 2, 2) : Math.min(top + hh - 2, plotH - 2);
      ctx.fillText(label, plotW - 6, ly);
    }
  };
  const f = (x) => fmt(x), tfN = smcCfg().tfName;
  if (fr) {
    const [o1, o2] = [Math.min(...fr.ote), Math.max(...fr.ote)];
    if (fr.dir === -1) {
      // H4 giảm: vùng Premium để SELL thuận (CL2); đáy H4 (Fibo 0) là nơi canh BUY hồi (CL1)
      box(fr.hiT, o1, o2, "rgba(229,83,75,.09)", "rgba(229,83,75,.7)", `H4 PREMIUM · OTE ${f(o1)}–${f(o2)} (CL2 Sell thuận)`, "bottom");
      box(fr.hiT, o2, fr.hi, "rgba(229,83,75,.17)", "rgba(229,83,75,.7)", `H4 EXTREME → ${f(fr.hi)}`, "top");
    } else {
      box(fr.hiT, o2, o1, "rgba(38,179,132,.09)", "rgba(38,179,132,.7)", `H4 DISCOUNT · OTE ${f(o1)}–${f(o2)} (CL2 Buy thuận)`, "top");
      box(fr.hiT, o1, fr.lo, "rgba(38,179,132,.17)", "rgba(38,179,132,.7)", `H4 EXTREME → ${f(fr.lo)}`, "bottom");
    }
    const y5 = Yr(fr.fib05); if (y5 != null && y5 > 0 && y5 < plotH) { hline(ctx, y5, X(fr.hiT), plotW, "#9aa3ad", 1, [5, 4], 0.7); ctx.fillStyle = "#9aa3ad"; ctx.font = "10px 'IBM Plex Mono', monospace"; ctx.textAlign = "right"; ctx.textBaseline = "bottom"; ctx.fillText(`H4 Fibo 0.5 · ${f(fr.fib05)}`, plotW - 6, y5 - 2); }
    // vùng chờ KB2 trên khung chart (CL1 hồi / CL2 thuận)
    for (const [zz, cl] of [[fr.z1, 1], [fr.z2, 2]]) {
      if (!zz || !c[zz.from]) continue;
      const vals = [zz.lo, zz.top, zz.hi, zz.bot].filter((x) => x != null), a = Math.min(...vals), b = Math.max(...vals);
      const buy = (cl === 1) === (fr.dir === -1);
      box(c[zz.from].time, a, b, buy ? "rgba(76,195,217,.10)" : "rgba(242,184,75,.10)", buy ? "rgba(76,195,217,.8)" : "rgba(242,184,75,.8)", `${tfN} vùng chờ CL${cl}-KB2 ${buy ? "BUY" : "SELL"} ${f(a)}–${f(b)}`, buy ? "top" : "bottom");
    }
  }
  // lệnh chờ / đang chạy: Entry, SL, TP1
  ctx.font = "600 10px 'IBM Plex Mono', monospace"; ctx.textBaseline = "middle";
  for (const o of smcOrders()) {
    if (o.status !== "pending" && o.status !== "open") continue;
    const x0 = c[o.created] ? X(c[o.created].time) : 0, col = o.side === "BUY" ? C.up : C.down;
    for (const [p, lab, cc, dash] of [[o.entry, `SMC ${o.name} ${o.side} ${o.status === "pending" ? "LIMIT" : "ĐANG CHẠY"} ${f(o.entry)}`, col, []], [o.sl, `SMC SL ${f(o.sl)}`, C.down, [4, 3]], [o.tp1, `SMC TP1 ${f(o.tp1)}${o.tpNote || ""}`, C.up, [4, 3]], [o.tp2, `SMC TP2 ${f(o.tp2)}`, C.up, [2, 4]]]) {
      const y = Yr(p); if (p == null || y == null || y < 0 || y > plotH) continue;
      hline(ctx, y, x0, plotW, cc, 1.2, dash, 0.9);
      ctx.fillStyle = cc; ctx.textAlign = "left"; ctx.fillText(lab, x0 + 4, y - 7);
    }
  }
  // thanh khoản đang chờ
  ctx.font = "10px 'IBM Plex Mono', monospace"; ctx.textBaseline = "middle"; ctx.textAlign = "right";
  const p0 = lastPrice();
  for (const [arr, kind] of [[R.liqH, "đỉnh"], [R.liqL, "đáy"]]) {
    // chỉ vẽ 4 vùng gần giá nhất mỗi phía cho gọn (EQH/EQL luôn vẽ)
    const near = [...arr].sort((a, b) => Math.abs(a.p - p0) - Math.abs(b.p - p0)).filter((L, j) => j < 4 || L.n >= 2);
    for (const L of near) {
      const y = Yr(L.p); if (y == null || y < 0 || y > plotH || !c[L.i]) continue;
      hline(ctx, y, X(c[L.i].time), plotW, C.mag, L.n >= 2 ? 1.6 : 1, [2, 3], L.n >= 2 ? 0.95 : 0.6);
      ctx.fillStyle = C.mag; ctx.fillText(`${L.n >= 2 ? (kind === "đỉnh" ? "EQH×" : "EQL×") + L.n : "$ " + kind} ${f(L.p)}`, plotW - 6, y - 7);
    }
  }
  // trendline nối 2 đỉnh/đáy chính thức
  if (R.tl && c[R.tl.a.i] && c[R.tl.b.i]) {
    const xa = X(c[R.tl.a.i].time), ya = Yr(R.tl.a.p), xb = X(c[R.tl.b.i].time), yb = Yr(R.tl.b.p);
    if (ya != null && yb != null && xb > xa) {
      const k = (yb - ya) / (xb - xa);
      ctx.save(); ctx.strokeStyle = C.mag; ctx.globalAlpha = 0.8; ctx.lineWidth = 1.2; ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(xa, ya); ctx.lineTo(plotW, ya + k * (plotW - xa)); ctx.stroke(); ctx.restore();
    }
  }
  // HH/HL/LH/LL và BOS/CHoCH (30 mốc gần nhất)
  ctx.font = "600 9.5px 'IBM Plex Mono', monospace"; ctx.textAlign = "center";
  for (const e of R.events.slice(-40)) {
    if (!c[e.i]) continue;
    const x = ts.timeToCoordinate(c[e.i].time + TZ); if (x == null || x < 0 || x > plotW) continue;
    const y = Yr(e.p); if (y == null || y < 0 || y > plotH) continue;
    if (e.kind === "BOS" || e.kind === "CHoCH") {
      const col = e.dir > 0 ? C.up : C.down, x0 = c[e.from] ? X(c[e.from].time) : x;
      hline(ctx, y, x0, x, col, 1, e.kind === "BOS" ? [4, 3] : [], 0.9);
      ctx.fillStyle = col; ctx.textBaseline = e.dir > 0 ? "bottom" : "top"; ctx.fillText(e.kind, (x0 + x) / 2, y + (e.dir > 0 ? -2 : 2));
    } else {
      ctx.fillStyle = e.side === "top" ? C.down : C.up; ctx.textBaseline = e.side === "top" ? "bottom" : "top";
      ctx.fillText(e.kind, x, y + (e.side === "top" ? -4 : 4));
    }
  }
}

// ─────────────────────────── tín hiệu (cùng luật với indicator TradingView) ───────────────────────────
function inUsSession(t) { const [a, b] = S.cfg.signals.us_session_vn, hm = vnClock(t); return hm >= a && hm < b; }
function primaryLevels() { const p = prim(); return p ? { src: p.source, ...p.chart } : null; }
function nextStrike(price, above) {
  const p = prim(); if (!p) return null;
  const xs = p.strikes.map((s) => s.chart).filter((x) => (above ? x > price + 0.01 : x < price - 0.01));
  return xs.length ? (above ? Math.min(...xs) : Math.max(...xs)) : null;
}
function nearDoi(price) {
  const p = prim(); if (!p) return null;
  let best = null;
  for (const s of p.strikes) {
    if (s.d_oi == null) continue;
    if (Math.abs(s.chart - price) <= S.cfg.signals.doi_zone && (!best || Math.abs(s.chart - price) < Math.abs(best.chart - price))) best = s;
  }
  return best;
}
function divAt(i) {
  const c = S.candles, n = S.cfg.signals.div_lookback;
  if (i < n + 1) return { bear: false, bull: false };
  const win = c.slice(i - n + 1, i + 1), prev = c.slice(i - n, i), k = c[i];
  return {
    bear: k.high >= Math.max(...win.map((x) => x.high)) && k.cvd < Math.max(...prev.map((x) => x.cvd)),
    bull: k.low <= Math.min(...win.map((x) => x.low)) && k.cvd > Math.min(...prev.map((x) => x.cvd)),
  };
}
function evaluate(i, live) {
  const sc = S.cfg.signals, c = S.candles, k = c[i], L = primaryLevels();
  if (!L || L.call_wall == null || L.put_wall == null) return null;
  if (i < Math.max(sc.div_lookback, sc.vol_sma, sc.cvd_slope_bars) + 2) return null;
  if (sc.session_only && !inUsSession(k.time)) return null;
  if ((TF_SEC[S.tf] || 0) < 300) return null;   // Options Flow: chỉ báo trên khung từ M5 trở lên (giống TradingView)
  if (i - S.lastSigIdx <= sc.cooldown_bars) return null;
  const cw = L.call_wall, pw = L.put_wall, tol = sc.touch_tol, d0 = divAt(i), d1 = divAt(i - 1), prev = c[i - 1];
  const slope = k.cvd - c[i - sc.cvd_slope_bars].cvd;
  const vavg = c.slice(i - sc.vol_sma, i).reduce((a, x) => a + x.vol, 0) / sc.vol_sma;
  const volSpike = vavg > 0 && k.vol >= sc.vol_spike_mult * vavg;
  const dxy = live ? (S.state?.macro?.DXY?.chg_n_pct ?? 0) : 0, dxyUp = dxy >= sc.dxy_thr_pct, dxyDn = dxy <= -sc.dxy_thr_pct;
  const doi = nearDoi(k.close), doiFlat = !!doi && doi.d_oi <= 0;
  const bf = live ? bigFlow(sc.cvd_slope_bars) : null;   // lệnh lớn ròng (chỉ có dữ liệu cho nến live)
  const mkSig = (type, side, conf, sl, tp1, tp2) => {
    if (bf) conf = { ...conf, [side === "BUY" ? "Lệnh lớn mua ròng" : "Lệnh lớn bán ròng"]: side === "BUY" ? bf.d > 0 : bf.d < 0 };
    const score = Object.values(conf).filter(Boolean).length;
    return score >= sc.min_confirm ? { i, time: k.time, type: "[Options Flow] " + type, side, conf, score, max: Object.keys(conf).length, entry: k.close, sl, tp1, tp2, live } : null;
  };
  let s = null;
  if (k.close < pw - tol && prev.close >= pw - tol) {
    const tp1 = nextStrike(k.close, false);
    s = mkSig("Thủng Put Wall – Negative Gamma", "SELL", { "CVD dốc xuống": slope < 0, "Delta nến âm": k.delta < 0, "DXY tăng": dxyUp, "Volume spike": volSpike }, pw + sc.sl_buffer, tp1, tp1 != null ? nextStrike(tp1, false) : null);
  }
  if (!s && k.close > cw + tol && prev.close <= cw + tol) {
    const tp1 = nextStrike(k.close, true);
    s = mkSig("Squeeze qua Call Wall", "BUY", { "CVD dốc lên": slope > 0, "Delta nến dương": k.delta > 0, "DXY giảm": dxyDn, "Volume spike": volSpike }, cw - sc.sl_buffer, tp1, tp1 != null ? nextStrike(tp1, true) : null);
  }
  if (!s && k.high >= cw - tol && k.close < cw && k.close < k.open)
    s = mkSig("Bull Trap tại Call Wall", "SELL", { "Phân kỳ CVD âm": d0.bear || d1.bear, "CVD dốc xuống": slope < 0, "DXY tăng": dxyUp, "Volume spike": volSpike, "Vol↑ mà ΔOI≤0": volSpike && doiFlat }, k.high + sc.sl_buffer, nextStrike(k.close, false), pw);
  // Bước 5 – vùng hedge lớn −Γ (LP hedge thuận chiều giá). Hai kiểu tín hiệu (30/10, người dùng đồng ý):
  //  • HEDGE trap (ưu tiên): râu/nến chọc VÀO vùng rồi nến đóng NGƯỢC ra khỏi mép vùng → LP mua/bán lại, giá bật mạnh
  //    (như 30/10 14:55: rơi vào vùng 3,960–3,977 rồi bật về Put Wall/Magnet 3,989). SL ngoài cực trị 3 nến gần nhất.
  //  • HEDGE theo đà: phải có 2 NẾN ĐÓNG liên tiếp trong vùng (nến trước đã vào, nến này đóng tiếp theo chiều) → đi theo dòng hedge.
  const hz = hedgeSt();
  if (!s && hz && i >= 3) {
    const zs = (hz.zones || []).filter((z) => z.kind === "accel");
    const p2 = c[i - 2], sw = (S.smc?.sweeps || []).some((w) => w.i >= i - 2 && w.i <= i);
    const lo3 = Math.min(k.low, prev.low, p2.low), hi3 = Math.max(k.high, prev.high, p2.high);
    const zDn = zs.find((z) => lo3 <= z.hi && k.close > z.hi && (prev.low <= z.hi || k.low <= z.hi));   // chọc xuống vùng rồi rút lên
    const zUp = zs.find((z) => hi3 >= z.lo && k.close < z.lo && (prev.high >= z.lo || k.high >= z.lo)); // chọc lên vùng rồi rút xuống
    if (zDn && k.close > k.open) {
      const tp1 = nextStrike(k.close, true);
      s = mkSig(`HEDGE trap: rút chân khỏi vùng −Γ ${fmt(zDn.lo, 0)}–${fmt(zDn.hi, 0)}`, "BUY", { "CVD dốc lên": slope > 0, "Delta nến dương": k.delta > 0, "Nến quét thanh khoản": sw, "DXY giảm": dxyDn, "Volume spike": volSpike }, lo3 - sc.sl_buffer, tp1, tp1 != null ? nextStrike(tp1, true) : null);
    } else if (zUp && k.close < k.open) {
      const tp1 = nextStrike(k.close, false);
      s = mkSig(`HEDGE trap: rút râu khỏi vùng −Γ ${fmt(zUp.lo, 0)}–${fmt(zUp.hi, 0)}`, "SELL", { "CVD dốc xuống": slope < 0, "Delta nến âm": k.delta < 0, "Nến quét thanh khoản": sw, "DXY tăng": dxyUp, "Volume spike": volSpike }, hi3 + sc.sl_buffer, tp1, tp1 != null ? nextStrike(tp1, false) : null);
    }
    if (!s) {
      const z = hZoneAt(k.close), zp = z && prev.close >= z.lo && prev.close <= z.hi ? z : null;
      if (zp && zp.kind === "accel") {
        if (p2.close > zp.hi && k.close < prev.close && k.close < k.open) {
          const tp1 = nextStrike(k.close, false);
          s = mkSig(`HEDGE −Γ: LP bán đuổi, 2 nến trong vùng (${Math.abs(zp.peak)} HĐ/${hz.win}$)`, "SELL", { "CVD dốc xuống": slope < 0, "Delta nến âm": k.delta < 0, "DXY tăng": dxyUp, "Volume spike": volSpike }, Math.max(prev.high, zp.hi) + sc.sl_buffer, tp1, tp1 != null ? nextStrike(tp1, false) : null);
        } else if (p2.close < zp.lo && k.close > prev.close && k.close > k.open) {
          const tp1 = nextStrike(k.close, true);
          s = mkSig(`HEDGE −Γ: LP mua đuổi, 2 nến trong vùng (${Math.abs(zp.peak)} HĐ/${hz.win}$)`, "BUY", { "CVD dốc lên": slope > 0, "Delta nến dương": k.delta > 0, "DXY giảm": dxyDn, "Volume spike": volSpike }, Math.min(prev.low, zp.lo) - sc.sl_buffer, tp1, tp1 != null ? nextStrike(tp1, true) : null);
        }
      }
    }
  }
  if (!s && k.low <= pw + tol && k.close > pw && k.close > k.open)
    s = mkSig("Bear Trap tại Put Wall", "BUY", { "Phân kỳ CVD dương": d0.bull || d1.bull, "CVD dốc lên": slope > 0, "DXY giảm": dxyDn, "Volume spike": volSpike, "Vol↑ mà ΔOI≤0": volSpike && doiFlat }, k.low - sc.sl_buffer, nextStrike(k.close, true), cw);
  return s;
}
function addSignal(s, live) {
  S.signals.push(s); S.lastSigIdx = s.i; setMarkers();
  if (live) { const e = jUpsert(jFromOF(s)); if (e) jPost([e]); renderJournal(); }
  if (live && $("#autoTrade").checked && !S.paper.pos) {
    const plan = planFor(s);
    paperOpen(s.side, plan.lots, s.sl, s.tp1, `Tự động: ${s.type} (${s.score}/${s.max})`);
  }
  if (live && "Notification" in window && Notification.permission === "granted")
    new Notification(`${s.side} – ${s.type}`, { body: `Entry ${fmt(s.entry)} · SL ${fmt(s.sl)} · TP1 ${fmt(s.tp1)}` });
}
function replaySignals() {
  S.signals = []; S.lastSigIdx = -1e9;
  const c = S.candles; if (!c.length) return;
  const day = vnDate(c[c.length - 1].time);
  for (let i = 0; i < c.length - 1; i++) {
    if (vnDate(c[i].time) !== day) continue; // mốc OI là của hôm nay
    const s = evaluate(i, false); if (s) { S.signals.push(s); S.lastSigIdx = i; }
  }
  setMarkers();
}
function setMarkers() {
  const show = $("#lyMk").checked, smcOn = $("#lySMC")?.checked && S.smc;
  const mk = show ? S.signals.map((s) => ({
    time: s.time + TZ, position: s.side === "SELL" ? "aboveBar" : "belowBar", color: s.side === "SELL" ? C.down : C.up,
    shape: s.side === "SELL" ? "arrowDown" : "arrowUp", text: `${s.side} ${s.score}/${s.max}`,
  })) : [];
  if (smcOn) {
    const c = S.candles;
    // nến quét thanh khoản (chỉ tại 4 loại thanh khoản của khung này, xét khi nến đã đóng)
    // mã loại: $ = đỉnh/đáy gần nhất · EQH/EQL = đỉnh/đáy bằng nhau · TL = trendline
    const swCode = (t, top) => [/gần nhất/.test(t) && "$", /bằng nhau/.test(t) && (top ? "EQH" : "EQL"), /trendline/.test(t) && "TL"].filter(Boolean).join("+");
    for (const w of S.smc.sweeps) if (c[w.i]) mk.push({ time: c[w.i].time + TZ, position: w.side === "top" ? "aboveBar" : "belowBar", color: C.mag, shape: "circle", size: 0.5, text: "✕ " + swCode(w.txt, w.side === "top") });
    // nến tạo (▼/▲ nhỏ) và nến xác nhận (■) của đỉnh/đáy thuộc cấu trúc khung này; mờ = đỉnh/đáy tạm đang chờ
    for (const F of S.smc.forms || []) {
      const top = F.side === "top", col = top ? C.down : C.up, cc = F.pending ? col + "99" : col, pos = top ? "aboveBar" : "belowBar";
      if (c[F.f]) mk.push({ time: c[F.f].time + TZ, position: pos, color: cc, shape: top ? "arrowDown" : "arrowUp", size: 0.6, text: "" });
      if (F.cf != null && c[F.cf]) mk.push({ time: c[F.cf].time + TZ, position: pos, color: cc, shape: "square", size: 0.5, text: "" });
    }
    if (show) for (const s of smcFilled()) mk.push({ time: s.time + TZ, position: s.side === "SELL" ? "aboveBar" : "belowBar", color: s.side === "SELL" ? C.down : C.up, shape: s.side === "SELL" ? "arrowDown" : "arrowUp", size: 1.4, text: `${s.name} ${s.side}${s.status === "tp1" ? " ✓" : s.status === "sl" ? " ✗" : ""}` });
  }
  mk.sort((a, b) => a.time - b.time);
  candleS.setMarkers(mk);
  const nS = smcOn ? smcFilled().filter((s) => vnDate(s.time) === vnDate(nowSec())).length : 0;
  $("#sigCount").textContent = `${S.signals.length} tín hiệu Options · ${nS} SMC hôm nay`;
}
function planFor(s) {
  const r = S.cfg.risk, risk = r.account_size_usd * r.risk_pct / 100, dist = Math.abs(s.entry - s.sl);
  return { lots: dist > 0 ? Math.max(0.01, Math.floor((risk / (dist * r.contract_oz)) * 100) / 100) : 0.01, risk };
}

// ─────────────────────────── Agent ───────────────────────────
function agentState() {
  const p = lastPrice(), L = primaryLevels(), c = S.candles, sc = S.cfg.signals;
  if (!L || p == null || L.call_wall == null || L.put_wall == null) return null;
  const flip = L.gamma_flip ?? L.put_wall, neg = p < flip, above = p >= L.call_wall;
  const i = c.length - 1, slope = i > sc.cvd_slope_bars ? c[i].cvd - c[i - sc.cvd_slope_bars].cvd : 0;
  const tape = slope > 0 ? 1 : slope < 0 ? -1 : 0;
  const dx = S.state?.macro?.DXY?.chg_n_pct ?? 0, dxyC = dx >= sc.dxy_thr_pct ? -1 : dx <= -sc.dxy_thr_pct ? 1 : 0;
  const target = neg ? nextStrike(p, false) : above ? L.call_wall : (L.magnet ?? (L.call_wall + L.put_wall) / 2);
  const pull = neg ? tape : target == null ? 0 : target > p + sc.touch_tol ? 1 : target < p - sc.touch_tol ? -1 : 0;
  const conv = 0.4 * tape + 0.3 * dxyC + 0.3 * pull;
  const sf = smcFilled(), lo = S.signals[S.signals.length - 1], ls = sf.sort((a, b) => a.i - b.i)[sf.length - 1];
  const last = lo && ls ? (ls.i >= lo.i ? ls : lo) : lo || ls;
  const live = last && i - last.i <= 3;
  const act = live ? (last.side === "BUY" ? "LONG" : "SHORT") : "WAIT";
  const regime = neg ? "SHORT_GAMMA" : above ? "ABOVE_CALL_WALL" : "LONG_GAMMA";
  const why = neg ? "strike kế tiếp phía dưới" : above ? "Call Wall (chờ rút chân)" : (L.magnet != null && L.max_pain != null && Math.abs(L.magnet - L.max_pain) <= 5) ? "Magnet ≈ Max Pain (hợp lưu)" : "Magnet / pin";
  return { p, L, flip, neg, above, tape, dxyC, pull, conv, target, why, act, regime, last, live };
}
function smcHtml() {
  if (!S.smc) return "";
  return `<p class="smcplan"><b>SMC:</b> ${esc(S.smc.struct)}<br>${S.smc.plan.map(esc).join("<br>")}</p>`;
}
function renderAgent() {
  const a = agentState();
  if (!a) {
    $("#decision").innerHTML = `<div class="act">WAIT</div><dl><dt>Trạng thái</dt><dd>Chưa có dữ liệu Options</dd></dl>`;
    $("#fusion").innerHTML = ""; $("#outlook").innerHTML = smcHtml() + `<p class="muted">Chạy XUAT_TRADINGVIEW.bat hoặc bấm “Làm mới Options” để nạp dữ liệu.</p>`;
    return;
  }
  const L = a.L, dealer = a.neg ? "LP bán khi giá giảm → gia tốc" : "LP mua dip / bán rip → giữ biên";
  $("#decision").innerHTML = `<div class="act ${a.act.toLowerCase()}">${a.act}</div>
    <dl><dt>Regime</dt><dd>${a.regime}</dd><dt>Dealer</dt><dd>${dealer}</dd>
    <dt>Lệnh lớn</dt><dd>${(() => { const f = bigFlow(S.cfg?.signals?.cvd_slope_bars ?? 5); return f ? `MUA ${f.b.toFixed(0)} · BÁN ${f.s.toFixed(0)} oz → ròng ${f.d >= 0 ? "+" : "−"}${Math.abs(f.d).toFixed(0)} (${f.nb}/${f.ns} lệnh ≥ ${S.big.thr?.toFixed(0)} oz)` : "đang thu thập"; })()}</dd>
    <dt>Hedge LP</dt><dd>${(() => { const v = hedgePer(a.p), z = hZoneAt(a.p); return v == null ? "—" : `≈ ${Math.abs(Math.round(v)).toLocaleString("en-US")} HĐ/${hedgeSt().win}$ (${hTier(v)}, ${v > 0 ? "−Γ gia tốc" : "+Γ hãm"})${z ? " · trong vùng hedge lớn" : ""}`; })()}</dd>
    <dt>Target</dt><dd>${fmt(a.target)} <span class="muted">(${esc(a.why)})</span></dd><dt>Conviction</dt><dd>${sgn(a.conv, 2)}</dd>
    ${S.smc ? `<dt>Cấu trúc</dt><dd>${esc(S.smc.struct)}</dd>` : ""}</dl>`;
  const w = Math.abs(a.conv) * 45;
  $("#fusion").innerHTML = `<b>FUSION</b> tape ${a.tape > 0 ? "↑" : a.tape < 0 ? "↓" : "·"} · DXY ${a.dxyC > 0 ? "hỗ trợ vàng" : a.dxyC < 0 ? "chống vàng" : "trung tính"} · kéo về target ${a.pull > 0 ? "↑" : a.pull < 0 ? "↓" : "·"}
    <span class="bar"><i style="left:${a.conv >= 0 ? 50 : 50 - w}%;width:${w}%;background:${a.conv >= 0 ? C.up : C.down}"></i></span>${sgn(a.conv, 2)}`;
  const dCW = L.call_wall - a.p, dPW = L.put_wall - a.p;
  let main, alt, trap;
  if (a.neg) {
    main = `<b>Chính:</b> Negative Gamma, giá dưới Flip ${fmt(a.flip)}. Ưu tiên SELL khi hồi về ${fmt(a.flip)} hoặc theo đà thủng ${fmt(nextStrike(a.p, false))}. Không bắt đáy.`;
    alt = `<b>Phụ:</b> đóng nến trở lại trên ${fmt(a.flip)} kèm CVD dốc lên thì chuyển về Positive Gamma, đánh biên.`;
    trap = `<b>Bẫy:</b> râu thủng Put Wall ${fmt(L.put_wall)} rồi rút chân, CVD phân kỳ dương, Volume tăng mà ΔOI không tăng → Bear Trap BUY.`;
  } else if (a.above) {
    main = `<b>Chính:</b> giá trên Call Wall ${fmt(L.call_wall)}. Chờ nến rút chân đóng dưới Wall để SELL về ${fmt(nextStrike(L.call_wall, false))}.`;
    alt = `<b>Phụ:</b> CVD và DXY cùng ủng hộ thì squeeze lên ${fmt(nextStrike(a.p, true))}.`;
    trap = `<b>Bẫy:</b> Volume spike tại Wall mà ΔOI không tăng là dấu hiệu Bull Trap.`;
  } else {
    main = `<b>Chính:</b> Positive Gamma, biên ${fmt(L.put_wall)} (${sgn(dPW)}) ↔ ${fmt(L.call_wall)} (${sgn(dCW)}). Giá bị hút về ${fmt(a.target)}. Scalp hai biên.`;
    alt = `<b>Phụ:</b> đóng nến thủng ${fmt(a.flip)} thì chuyển Negative Gamma, đánh theo chiều xả.`;
    trap = `<b>Bẫy:</b> canh râu quét qua Wall rồi đóng ngược vào trong kèm phân kỳ CVD.`;
  }
  const smcP = smcHtml();
  const sig = a.last ? `<p><b>Tín hiệu cuối:</b> ${a.last.side} · ${esc(a.last.type)}${a.last.smc ? "" : ` (${a.last.score}/${a.last.max})`} lúc ${vnClock(a.last.time)} · Entry ${fmt(a.last.entry)} · SL ${fmt(a.last.sl)} · TP1 ${fmt(a.last.tp1)} · khối lượng ≈ ${fmt(planFor(a.last).lots, 2)} lot</p>` : "";
  $("#outlook").innerHTML = `${smcP}<p>${main}</p><p>${alt}</p><p>${trap}</p>${sig}`;
  $("#agentAge").textContent = `cập nhật ${new Date().toLocaleTimeString("vi-VN")}`;
}

// ─────────────────────────── bảng & panel ───────────────────────────
function renderQuote() {
  const c = S.candles; if (!c.length) return;
  const p = lastPrice(), key = sessKey(c[c.length - 1].time), open = (c.find((x) => sessKey(x.time) === key) || c[0]).open, ch = p - open;
  $("#px").textContent = fmt(p);
  const el = $("#pxchg"); el.textContent = `${sgn(ch, 2)} (${sgn((ch / open) * 100, 2)}%)`; el.className = "chg " + (ch >= 0 ? "up" : "down");
  $("#nbars").textContent = c.length;
  const last = c[c.length - 1], d = divAt(c.length - 1);
  $("#cvdVal").textContent = fmtK(last.cvd);
  const tag = $("#cvdDiv"); tag.textContent = d.bear ? "Phân kỳ âm" : d.bull ? "Phân kỳ dương" : "Không phân kỳ"; tag.className = "tag " + (d.bear ? "bear" : d.bull ? "bull" : "");
  chip("#chipSess", inUsSession(nowSec()) ? "ok" : "", "Phiên Mỹ " + S.cfg.signals.us_session_vn.join("–"));
}

// Bid/Ask theo strike (Bước 2): spread % so với giá giữa; ≥ 15% = thanh khoản kém (tô vàng)
function baCell(s) {
  const one = (b, a) => (b && a && a > 0 ? (200 * (a - b)) / (a + b) : null);
  const c = one(s.c_bid, s.c_ask), p = one(s.p_bid, s.p_ask);
  if (c == null && p == null) return `<td class="muted" title="Không có Bid/Ask (GC: CME miễn phí không có; GLD: ngoài giờ Mỹ Yahoo trả 0)">—</td>`;
  const f = (x) => (x == null ? "—" : x.toFixed(0) + "%"), wide = (c ?? 0) >= 15 || (p ?? 0) >= 15;
  const tip = `CALL bid ${s.c_bid ?? "—"} / ask ${s.c_ask ?? "—"}\nPUT bid ${s.p_bid ?? "—"} / ask ${s.p_ask ?? "—"}\nSpread = (ask − bid) / giá giữa (kỳ gần nhất)`;
  return `<td class="${wide ? "warnc" : ""}" title="${tip}">${f(c)} · ${f(p)}</td>`;
}
function renderProfile() {
  const o = optV(S.profSrc), tb = $("#prof tbody");
  if (!o) { tb.innerHTML = `<tr><td colspan="19" class="muted">${S.state && S.state.options_updated ? `Chưa có dữ liệu ${S.profSrc}. Xem dòng cảnh báo vàng phía trên để biết lý do, rồi bấm “Làm mới Options”.` : `Đang tải dữ liệu ${S.profSrc} lần đầu (1–2 phút)…`}</td></tr>`; $("#profMeta").textContent = "—"; return; }
  const p = lastPrice() ?? o.chart.gamma_flip;
  const maxG = Math.max(1, ...o.strikes.map((s) => Math.abs(s.net_gex)));
  const atm = o.strikes.reduce((b, s) => (b == null || Math.abs(s.chart - p) < Math.abs(b.chart - p) ? s : b), null);
  const big = S.cfg.signals.doi_big, n = (v, d) => (v == null ? "—" : Number(v).toFixed(d)), dTh = o.source === "GLD" ? 3 : 2;
  tb.innerHTML = [...o.strikes].reverse().map((s) => {
    const cls = [s === atm ? "atm" : "", s.strike === o.call_wall ? "wall-c" : "", s.strike === o.put_wall ? "wall-p" : ""].join(" ");
    const w = Math.round((Math.abs(s.net_gex) / maxG) * 100), hc = s.net_gex >= 0 ? "rgba(38,179,132,.22)" : "rgba(229,83,75,.22)";
    const doi = s.d_oi == null ? "—" : `<span class="doi ${s.d_oi >= big ? "big" : s.d_oi <= 0 ? "neg" : ""}">${s.d_oi > 0 ? "+" : ""}${fmtK(s.d_oi)}</span>`;
    return `<tr class="${cls}" ${s === atm ? 'id="atmRow"' : ""}><td class="xau">${fmt(s.chart)}${s.strike === o.call_wall ? " CW" : s.strike === o.put_wall ? " PW" : ""}</td><td class="muted">${s.strike}</td>
      <td>${fmtK(s.call_oi)}</td><td>${fmtK(s.call_vol)}</td><td>${fmtK(s.put_oi)}</td><td>${fmtK(s.put_vol)}</td>
      <td class="${s.net_gex >= 0 ? "gp" : "gn"}" style="background:linear-gradient(to left, ${hc} ${w}%, transparent ${w}%)">${fmtK(s.net_gex)}</td>
      <td class="${s.dex >= 0 ? "gp" : "gn"}">${fmtK(s.dex)}</td><td>${s.iv ? (s.iv * 100).toFixed(1) + "%" : "—"}</td><td>${doi}</td>${baCell(s)}
      <td class="muted">${n(s.dte, 0)}</td><td>${n(s.delta, 2)}</td><td>${n(s.gamma, 4)}</td><td>${n(s.vega, 2)}</td><td>${n(s.vanna, 4)}</td>
      <td class="gn">${n(s.theta, dTh)}</td><td>${n(s.rho, 3)}</td><td>${n(s.charm, 4)}</td></tr>`;
  }).join("");
  const rt = S.state?.rate, rTxt = o.rate != null ? `r ${(o.rate * 100).toFixed(2)}%${rt?.src ? " (" + rt.src + ")" : ""}` : "";
  const expo = o.net_vex != null ? ` · Vanna Exp ${fmtK(o.net_vex)}/1 vol · Charm Exp ${fmtK(o.net_cex)}/ngày · Θ OI ${fmtK(o.theta_oi)}/ngày` : "";
  // IV surface: IV ATM kỳ gần nhất của từng nhóm + skew (IV 95% − IV 105%, điểm vol; > 0 = put đắt hơn call)
  const seen = new Set(), ivTxt = (o.surface || []).filter((x) => !seen.has(x.tenor) && seen.add(x.tenor)).slice(0, 4)
    .map((x) => `${x.tenor} ${(x.atm_iv * 100).toFixed(1)}%${x.interp ? "*" : ""}`).join(" · ");
  const sk = (o.surface || [])[0], skTxt = sk ? ` · skew ${sk.skew >= 0 ? "+" : ""}${(sk.skew * 100).toFixed(1)}đ` : "";
  const base = opt(S.profSrc), ei = base?.expiry_info || [], tot = ei.reduce((a, x) => a + x.oi, 0) || 1;
  const shortOI = ei.filter((x) => x.dte <= 7).reduce((a, x) => a + x.oi, 0);
  const lv = S.state?.live, liveTxt = lv?.time ? ` · tính lại ${new Date(lv.time).toLocaleTimeString("vi-VN")} theo giá ${fmt(lv.price)}` : "";
  $("#profMeta").textContent = `${TENOR_TXT[S.tenor] || ""}: ${o.n_expiries ?? o.expiries.length} kỳ (${o.expiries.slice(0, 3).join(", ")}${o.expiries.length > 3 ? "…" : ""}) · OI ≤7 ngày ${Math.round((shortOI / tot) * 100)}% · IV ATM ${ivTxt || "—"}${skTxt} · nguồn ${o.source} (giá ${fmt(o.underlying)}) · ${o.model || ""}${rTxt ? " " + rTxt : ""}${expo}${liveTxt} · OI ngày ${o.fetched ? new Date(o.fetched).toLocaleString("vi-VN") : ""}`;
  $("#profMeta").title = "Kỳ hạn: chọn ở ô bên trái (chỉ đổi phần xem; tín hiệu và Agent dùng Mọi kỳ hạn). IV ATM: IV đã làm mượt (smile bậc 2 theo OI, * = nội suy từ kỳ khác). Skew: IV strike 95% − IV strike 105%. Mốc được tính lại mỗi 60 giây hoặc khi giá đi > 2 USD; OI là số cuối ngày của sàn.\nExposure theo quy ước dấu GEX (dealer long call / short put). Vanna Exp: USD delta dealer đổi khi IV +1 điểm. Charm Exp: USD delta dealer đổi sau 1 ngày nếu giá và IV đứng yên. Θ OI: tổng giá trị thời gian mất mỗi ngày của toàn bộ OI.";
  if (!S.profScrolled && $("#atmRow")) { const w = $(".sp .tablewrap"), r = $("#atmRow"); w.scrollTop = r.offsetTop - w.clientHeight / 2; S.profScrolled = true; }
}

function renderKpis() {
  const P = prim(), gld = opt("GLD"), iv = P?.strikes?.find((s) => s.iv)?.iv;
  const atmIv = (() => { const o = gld || P; if (!o) return null; const p = o.underlying; const s = o.strikes.reduce((b, x) => (b == null || Math.abs(x.strike - p) < Math.abs(b.strike - p) ? x : b), null); return s?.iv; })();
  $("#kpis").innerHTML = `<span>— Vol / Risk <b>${atmIv ? (atmIv * 100).toFixed(1) + "% IV" : "—"}</b></span>
    <span>— XAU / GLD <b>×${fmt(gld?.ratio, 3)}</b></span><span>— Net GEX <b>${fmtK(P?.net_gex)}</b></span>
    <span>— Regime <b>${P?.regime === "POSITIVE" ? "Long γ" : P?.regime === "NEGATIVE" ? "Short γ" : "—"}</b></span>`;
  void iv;
}

function renderMacro() {
  const m = S.state?.macro || {};
  const box = (name, v, unit = "") => `<div><small>${name}</small><b>${v ? fmt(v.last, name === "US10Y" ? 3 : 2) + unit : "—"}</b>
    <span class="${v && v.chg_n_pct >= 0 ? "up" : "down"}"> ${v ? sgn(v.chg_n_pct, 3) + "%/5p" : ""}</span></div>`;
  $("#macro").innerHTML = box("DXY", m.DXY) + box("US10Y", m.US10Y, "%");
  const now = Date.now(), items = (S.state?.calendar || []).filter((n) => new Date(n.time).getTime() > now - 3600e3).slice(0, 5);
  $("#news").innerHTML = items.length ? items.map((n) => {
    const t = new Date(n.time), mins = (t - now) / 60000;
    return `<li><span>${esc(n.title)}</span><span class="${mins < 120 && mins > -60 ? "soon" : "muted"}">${t.toLocaleString("vi-VN", { weekday: "short", hour: "2-digit", minute: "2-digit" })}</span></li>`;
  }).join("") : `<li class="muted">Không có tin USD đỏ sắp tới.</li>`;
}

let warnExtra = [];
function addWarn(t) { if (!warnExtra.includes(t)) warnExtra.push(t); renderWarn(); }
function renderWarn() {
  const errs = [...(S.state?.errors || []), ...warnExtra];
  if (S.state?.demo) errs.unshift("CHẾ ĐỘ DEMO: giá và Options là dữ liệu giả lập.");
  const w = $("#warn"); w.hidden = !errs.length; w.textContent = errs.join("  •  ");
  // ghi chú (dùng bản lưu còn mới, cùng phiên) → dòng xám nhỏ, không phải cảnh báo
  let n = $("#notes");
  if (!n) { n = document.createElement("div"); n.id = "notes"; n.className = "notes"; w.after(n); }
  const notes = S.state?.notes || [];
  n.hidden = !notes.length; n.textContent = notes.length ? "ℹ " + notes.join("  •  ") : "";
}
function renderEngineChip() {
  const st = S.state;
  if (!st) return chip("#chipEngine", "bad", "Engine offline");
  const age = st.options_updated ? (Date.now() - new Date(st.options_updated)) / 60000 : null;
  chip("#chipEngine", st.demo ? "mid" : st.status === "ok" ? "ok" : "mid", st.demo ? "Engine DEMO" : age != null ? `Options ${Math.round(age)}p trước` : "Engine đang chạy");
  const r = st.refs || {};
  $("#metaRef").textContent = `GC ${fmt(r.gc)} · GLD ${fmt(r.gld)}`;
}
async function renderPine() {
  try {
    const r = await (await fetch(API("/api/tv"))).json();
    $("#pineOut").innerHTML = `<label>Đoạn mã dán vào ô "Dữ liệu engine" <button class="ghost small" id="copyPine">Sao chép</button></label><code>${esc(r.blob)}</code>`;
    $("#copyPine").onclick = async (e) => { try { await navigator.clipboard.writeText(r.blob); e.target.textContent = "Đã chép"; } catch { e.target.textContent = "Hãy chọn thủ công"; } };
  } catch { $("#pineOut").innerHTML = `<p class="muted">Không lấy được đoạn mã.</p>`; }
}



// ─────────────────────────── Bước 5b: LỆNH LỚN ("Smart Money") — thay cho "Tách ID Order" ───────────────────────────
// Không có nguồn miễn phí cho dữ liệu lệnh theo ID → đọc TỪNG GIAO DỊCH khớp (aggTrade) của feed Binance, tách các giao dịch
// có giá trị ≥ ngưỡng CỐ ĐỊNH config signals.big_trade_usd (mặc định 50.000 USD), nạp lại từ đầu phiên (tối đa 8 giờ) → mọi máy cùng số liệu
// → "CVD lệnh lớn" = mua chủ động lớn − bán chủ động lớn (oz), cộng dồn theo phiên. Chạy cả trên bản web (trình duyệt tự nối).
// Lưu ý: đây là dòng lệnh trên Binance (XAUUSDT/PAXG), chỉ đại diện một phần dòng tiền COMEX/OTC.
S.big = { thr: null, ids: new Set(), byT: {}, ws: null, n: 0, since: null };
const BIG_MIN_USD = () => S.cfg?.signals?.big_trade_usd ?? 50000;
function bigThr(price) {
  // ngưỡng CỐ ĐỊNH theo giá trị USD (config signals.big_trade_usd) → mọi máy/bản web đếm cùng một tập lệnh
  return price ? BIG_MIN_USD() / price : null;
}
function bigAdd(tMs, price, qty, sellAggr, id) {
  const B = S.big;
  if (id != null) { if (B.ids.has(id)) return false; B.ids.add(id); if (B.ids.size > 200000) B.ids.clear(); }   // bỏ trùng giữa nạp lại (REST) và luồng trực tiếp (WS)
  B.thr = bigThr(price);
  if (qty * price < BIG_MIN_USD()) return false;
  const step = TF_SEC[S.tf] || 900, ts = Math.floor(tMs / 1000);
  const t = AGG[S.tf] ? SMC.bucketOf(ts, AGG[S.tf]) : Math.floor(ts / step) * step;   // 4h/1d neo 18:00 New York như nến
  const e = B.byT[t] || (B.byT[t] = { d: 0, n: 0, buy: 0, sell: 0, nb: 0, ns: 0 });
  const q = sellAggr ? -qty : qty; e.d += q; e.n++; if (q > 0) { e.buy += qty; e.nb++; } else { e.sell += qty; e.ns++; }
  B.n++; return true;
}
function bigSeries() {
  // CVD lệnh lớn theo phiên, gắn vào nến hiện có
  // trả về 3 đường theo phiên: ròng, tổng MUA lớn (dương), tổng BÁN lớn (vẽ âm)
  const c = S.candles, out = [], ob = [], os = []; let cum = 0, cb = 0, cs = 0, key = null;
  for (const k of c) {
    if (sessKey(k.time) !== key) { key = sessKey(k.time); cum = 0; cb = 0; cs = 0; }
    const e = S.big.byT[k.time]; if (e) { cum += e.d; cb += e.buy; cs += e.sell; }
    k.bigd = e ? e.d : 0; k.bign = e ? e.n : 0; k.bigb = e ? e.buy : 0; k.bigs = e ? e.sell : 0;
    k.bignb = e ? e.nb || 0 : 0; k.bigns = e ? e.ns || 0 : 0; k.bigcvd = cum; k.bigcb = cb; k.bigcs = cs;
    if (S.big.since != null && k.time + (TF_SEC[S.tf] || 900) > S.big.since) {
      out.push({ time: k.time + TZ, value: cum }); ob.push({ time: k.time + TZ, value: cb }); os.push({ time: k.time + TZ, value: -cs });
    }
  }
  return { net: out, buy: ob, sell: os };
}
function bigFlow(n = 5) { // lệnh lớn ròng (oz) trong n nến gần nhất, chỉ tính khi đã có dữ liệu cho cả n nến
  const c = S.candles; if (S.big.since == null || c.length < n) return null;
  if (c[c.length - n].time < S.big.since - (TF_SEC[S.tf] || 900)) return null;
  let d = 0, m = 0, b = 0, s = 0, nb = 0, ns = 0;
  for (const k of c.slice(-n)) { d += k.bigd || 0; m += k.bign || 0; b += k.bigb || 0; s += k.bigs || 0; nb += k.bignb || 0; ns += k.bigns || 0; }
  return { d, n: m, b, s, nb, ns };
}
function renderBig() {
  if (!bigLine) return;
  const sr = bigSeries(); bigLine.setData(sr.net); bigBuyLine?.setData(sr.buy); bigSellLine?.setData(sr.sell);
  const el = $("#bigVal"); if (!el) return;
  const f = bigFlow(S.cfg?.signals?.cvd_slope_bars ?? 5), thr = S.big.thr;
  const nb = S.cfg?.signals?.cvd_slope_bars ?? 5, fx = (v) => Math.round(v).toLocaleString("en-US");
  el.innerHTML = thr == null ? "đang thu thập…" : `≥ ${thr.toFixed(thr < 10 ? 1 : 0)} oz · ${nb} nến: ${f ? `<b class="up">MUA ${fx(f.b)} oz</b> (${f.nb}) · <b class="down">BÁN ${fx(f.s)} oz</b> (${f.ns}) · ròng <b class="${f.d >= 0 ? "up" : "down"}">${f.d >= 0 ? "+" : "−"}${fx(Math.abs(f.d))}</b>` : "chưa đủ dữ liệu"}`;
}
async function bigBackfill(f) {
  // Nạp lại NGƯỢC từ hiện tại về đầu phiên (05:00 giờ VN), tối đa 6 giờ: các nến gần nhất (dùng cho "5 nến") luôn đủ,
  // phần xa nhất có thể bị cắt nếu phiên quá nhiều giao dịch (giới hạn số trang) → S.big.since = mốc nến đã đủ dữ liệu.
  const now = Math.floor(Date.now() / 1000), sess0 = sessKey(now) * 86400 - 2 * 3600;
  const step = TF_SEC[S.tf] || 900, win = step * ((S.cfg?.signals?.cvd_slope_bars ?? 5) + 1);
  const start = Math.floor(Math.max(Math.min(sess0, now - win), now - 6 * 3600) / step) * step;
  const path = /fapi/.test(f.kpath) ? "/fapi/v1/aggTrades" : "/api/v3/aggTrades";
  const get = async (q) => { const a = await (await fetch(`${f.rest}${path}?symbol=${f.symbol}${q}`)).json(); return Array.isArray(a) ? a : []; };
  try {
    const last = await get("&limit=1"); if (!last.length) throw new Error("no trades");
    const L = last[0].a; let minT = Infinity, minId = L + 1;
    const MAXP = 300, PAR = 6;                         // tối đa 300.000 giao dịch, 6 yêu cầu song song
    for (let k = 0; k < MAXP && minT > start * 1000 && minId > 0; k += PAR) {
      const ids = []; for (let m = 0; m < PAR && k + m < MAXP; m++) { const fid = L + 1 - 1000 * (k + m + 1); if (fid + 1000 > 0) ids.push(Math.max(0, fid)); }
      const pages = await Promise.all(ids.map((fid) => get(`&fromId=${fid}&limit=1000`)));
      for (const a of pages) for (const x of a) {
        if (x.T < start * 1000) continue;
        bigAdd(x.T, +x.p, +x.q, !!x.m, x.a);
        if (x.T < minT) minT = x.T; if (x.a < minId) minId = x.a;
      }
      if (pages.some((a) => a.length && a[0].T < start * 1000)) { minT = start * 1000; break; }
      S.big.since = Math.ceil(minT / 1000 / step) * step; renderBig();
    }
    S.big.since = minT <= start * 1000 ? start : Math.ceil(minT / 1000 / step) * step;
    // bỏ phần nến bị cắt dở (trước mốc since) để không cộng thiếu
    for (const t of Object.keys(S.big.byT)) if (+t < S.big.since) delete S.big.byT[t];
  } catch { S.big.since = Math.ceil(now / step) * step; }
  renderBig();
}
function connectBig(i = 0) {
  const f = S.feed || feeds()[0];
  if (S.big.ws) { try { S.big.ws.onclose = null; S.big.ws.close(); } catch { } }
  let urls = [f.ws, ...(f.ws_alt || [])];
  if (/fstream\.binance\.com\/ws$/.test(f.ws)) urls = ["wss://fstream.binance.com/market/ws", f.ws];
  const ws = new WebSocket(`${urls[i % urls.length]}/${f.symbol.toLowerCase()}@aggTrade`);
  S.big.ws = ws;
  let last = 0;
  ws.onmessage = (ev) => {
    const x = JSON.parse(ev.data); if (!x || x.e !== "aggTrade") return;
    if (bigAdd(x.T, +x.p, +x.q, !!x.m, x.a) || Date.now() - last > 5000) { last = Date.now(); renderBig(); }
  };
  ws.onclose = () => { if (S.big.ws === ws) setTimeout(() => connectBig(i + 1), 5000); };
  ws.onerror = () => ws.close();
}
function startBig() {
  S.big = { thr: null, ids: new Set(), byT: {}, ws: S.big?.ws || null, n: 0, since: null };
  if (S.state?.demo) return;
  const f = S.feed || feeds()[0];
  bigBackfill(f); connectBig(0);
}

// ─────────────────────────── Bản web tĩnh (GitHub Pages / điện thoại) ───────────────────────────
// γ live: tính lại Gamma Black-76/BSM từng strike theo giá hiện tại từ "gói" (giống Pine v32, analytics.pack_gamma)
// → Flip (lưới ±12%, 120 bước), Magnet (±8%), Net GEX khi máy tính tắt. OI giữ nguyên số cuối ngày.
const YEAR_SEC = 365 * 86400, T_FLOOR = 1 / (365 * 24), TV_SPAN = 0.12;
function packGamma(pk, Sx, now) {
  const out = [], kk = pk.mult * Sx * Sx * 0.01;
  for (const [ks, ois] of Object.entries(pk.oi)) {
    const k = parseFloat(ks); let cg = 0, pg = 0;
    pk.buckets.forEach((bk, j) => {
      if (!bk) return;
      const co = ois[2 * j], po = ois[2 * j + 1]; if (co <= 0 && po <= 0) return;
      const left = bk.ts - now; if (j === 0 && left <= 0) return;
      const T = Math.max(left / YEAR_SEC, T_FLOOR), x = Math.log(k / pk.F);
      const iv = Math.min(Math.max(bk.a + bk.s1 * x + bk.s2 * x * x, 0.03), 2.0), sq = iv * Math.sqrt(T);
      const d1 = (Math.log(Sx / k) + (pk.b + iv * iv / 2) * T) / sq;
      const g = Math.exp((pk.b - pk.r) * T) * Math.exp(-d1 * d1 / 2) / Math.sqrt(2 * Math.PI) / (Sx * sq);
      cg += g * co * kk; pg -= g * po * kk;
    });
    const f = pk.fac?.[ks] ?? pk.fac?.[String(k)] ?? 1;
    out.push({ k, cg: cg * f, pg: pg * f });
  }
  return out;
}
function packResid(pk, Sx) { const n = pk.resid.length, xs = Array.from({ length: n }, (_, i) => -TV_SPAN + (2 * TV_SPAN * i) / (n - 1)); return interp(xs, pk.resid, Sx / pk.C - 1) || 0; }
const packNet = (pk, Sx, now) => packGamma(pk, Sx, now).reduce((a, x) => a + x.cg + x.pg, 0) + packResid(pk, Sx);
function liveFromPack(pk, Sx, now) {
  const g = packGamma(pk, Sx, now); let mag = null, best = 0;
  for (const x of g) if (Math.abs(x.k / Sx - 1) <= 0.08 && x.cg - x.pg > best) { best = x.cg - x.pg; mag = x.k; }
  const net = g.reduce((a, x) => a + x.cg + x.pg, 0) + packResid(pk, Sx);
  let flip = null; const steps = 120, lo = Sx * 0.88, st = (Sx * 0.24) / steps; let prev = packNet(pk, lo, now);
  for (let j = 1; j <= steps; j++) {
    const px = lo + st * j, v = packNet(pk, px, now);
    if ((prev < 0) !== (v < 0)) { const c = px - st + (st * -prev) / (v - prev); if (flip == null || Math.abs(c - Sx) < Math.abs(flip - Sx)) flip = c; }
    prev = v;
  }
  return { flip, mag, net, g };
}
let staticLive = { t: 0, p: null };
function staticRecompute(force = false) {
  if (!STATIC || !S.state?.options) return;
  const p = lastPrice(); if (p == null) return;
  if (!force && Date.now() - staticLive.t < 60000 && staticLive.p != null && Math.abs(p - staticLive.p) < 2) return;
  const now = Date.now() / 1000;
  for (const o of Object.values(S.state.options)) {
    const pk = o.pack; if (!pk || !o.ratio) continue;
    const Sx = p / o.ratio, r = liveFromPack(pk, Sx, now);
    o.gamma_flip = r.flip; o.magnet = r.mag ?? o.magnet; o.net_gex = r.net; o.underlying = Sx;
    o.regime = r.flip == null ? null : Sx >= r.flip ? "POSITIVE" : "NEGATIVE";
    o.chart = { ...o.chart, gamma_flip: r.flip == null ? null : +(r.flip * o.ratio).toFixed(2), magnet: o.magnet == null ? null : +(o.magnet * o.ratio).toFixed(2) };
    const byK = new Map(r.g.map((x) => [x.k, x]));
    for (const st of o.strikes) { const x = byK.get(st.strike); if (x) { st.call_gex = x.cg; st.put_gex = x.pg; st.net_gex = x.cg + x.pg; } }
  }
  S.state.live = { time: new Date().toISOString(), price: +p.toFixed(2) };
  staticLive = { t: Date.now(), p };
}
function renderBuild() {
  const el = $("#buildInfo"); if (!el || !S.state) return;
  const b = S.state.build || S.state.options_updated, cme = S.state.options?.GC?.cme;
  const age = b ? (Date.now() - new Date(b)) / 60000 : null;
  el.textContent = `${STATIC ? "Build" : "Engine"} ${b ? new Date(b).toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" }) : "—"}${cme?.trade_date ? ` · CME phiên ${cme.trade_date}` : ""}${STATIC && age > 90 ? " · máy tính chưa gửi bản mới" : ""}`;
  el.className = "build" + (STATIC && age > 24 * 60 ? " old" : "");
}
async function copyTV(e) {
  const btn = e.currentTarget;
  try {
    const r = await (await fetch(API("/api/tv") + (STATIC ? "?t=" + Date.now() : ""))).json();
    if (!r.blob) throw new Error("chưa có dữ liệu");
    await navigator.clipboard.writeText(r.blob); btn.textContent = "✓ Đã copy";
  } catch (err) { btn.textContent = "Không copy được"; }
  setTimeout(() => { btn.textContent = "Copy cho TradingView"; }, 2500);
}
// chạm để xem giải thích (điện thoại không rê chuột được): chạm phần tử có title → hiện hộp; chạm lần nữa để ẩn
function initTouchTips() {
  if (!("ontouchstart" in window)) return;
  const tip = document.createElement("div"); tip.className = "tip"; tip.hidden = true; document.body.appendChild(tip);
  let cur = null;
  document.addEventListener("click", (e) => {
    const el = e.target.closest("[title]");
    if (!el || el === cur) { tip.hidden = true; cur = null; return; }
    if (el.matches("button, select, input, a")) return;
    cur = el; tip.textContent = el.getAttribute("title"); tip.hidden = false;
    const r = el.getBoundingClientRect();
    tip.style.top = `${window.scrollY + r.bottom + 6}px`; tip.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - 300))}px`;
  });
}
function initStatic() {
  document.body.classList.add("static");
  for (const id of ["#btnRefresh", "#mt5Box"]) { const el = $(id); if (el) el.hidden = true; }
  $("#btnAI").textContent = "Xem nhận định AI";
  const n = document.createElement("p"); n.className = "muted small"; n.textContent = "Bản web: dữ liệu Options và nhận định AI do máy tính cập nhật (lịch 13:30 mỗi ngày; AI thêm khi bấm \"AI phân tích\" trên board máy tính). Giá chạy live.";
  $(".llm")?.appendChild(n);
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => { });
}

// ─────────────────────────── Nhật ký tín hiệu live + thống kê + backtest SMC ───────────────────────────
// Board ghi mỗi tín hiệu live (Options Flow) và mỗi lệnh SMC đã khớp trong 24 giờ vào data/journal.json (qua /api/journal),
// rồi tự theo dõi chạm TP1 / SL (cùng nến: tính SL trước). R: TP1 = +RR, SL = −1.
const J_CLOSED = ["tp1", "sl", "expired"];
S.journal = []; S.jTab = "live"; S.bt = null;
async function journalLoad() {
  try { S.journal = (await (await fetch(API("/api/journal"))).json()).entries || []; } catch { S.journal = []; }
  renderJournal();
}
function jPost(list) {
  if (STATIC || !list.length) return;
  fetch("/api/journal", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entries: list }) }).catch(() => { });
}
function jUpsert(e) {
  const i = S.journal.findIndex((x) => x.id === e.id);
  if (i < 0) { S.journal.push(e); return e; }
  const o = S.journal[i];
  if (J_CLOSED.includes(o.status) && !J_CLOSED.includes(e.status)) return null;
  if (o.status === e.status && o.entry === e.entry) return null;
  S.journal[i] = { ...o, ...e }; return S.journal[i];
}
const jR = (e, exit) => { const d = e.side === "BUY" ? 1 : -1, risk = (e.entry - e.sl) * d; return risk > 0 ? ((exit - e.entry) * d) / risk : null; };
function jFromOF(s) {
  return { id: `OF|${s.type}|${s.side}|${s.time}`, t: s.time, kind: "OF", name: s.type.replace("[Options Flow] ", "").replace(/ \(.*\)$/, "").split(":")[0],
    type: s.type, side: s.side, entry: s.entry, sl: s.sl, tp1: s.tp1, tp2: s.tp2, tf: S.tf, status: "open", score: `${s.score}/${s.max}` };
}
function jFromSMC(o) {
  const c = S.candles, t = c[o.fillI].time, st = o.status === "tp1" ? "tp1" : o.status === "sl" ? "sl" : "open";
  const e = { id: `SMC|${o.name}|${o.side}|${S.tf}|${t}`, t, kind: "SMC", name: o.name, type: o.txt, side: o.side, entry: o.entry, sl: o.sl, tp1: o.tp1, tp2: o.tp2, tf: S.tf, status: st };
  if (st !== "open" && o.closeI != null && c[o.closeI]) { e.closeT = c[o.closeI].time; e.exit = st === "tp1" ? o.tp1 : o.sl; e.r = st === "tp1" ? jR(e, o.tp1) : -1; }
  return e;
}
// lệnh SMC đã khớp trong 24 giờ qua (lệnh SMC tính lại được từ nến đã đóng nên ghi cả khi board vừa mở)
function journalSyncSMC() {
  if (!S.smc) return;
  const since = nowSec() - 86400, out = [];
  for (const o of smcOrders()) if (o.fillI != null && S.candles[o.fillI] && S.candles[o.fillI].time >= since) { const e = jUpsert(jFromSMC(o)); if (e) out.push(e); }
  jPost(out);
}
// Options Flow: theo dõi kết quả bằng nến của khung đang mở (hết hạn sau 2 ngày không chạm)
function journalTrack() {
  const c = S.candles, out = [];
  if (!c.length) return;
  for (const e of S.journal) {
    if (e.kind !== "OF" || e.status !== "open" || e.tp1 == null) continue;
    const d = e.side === "BUY" ? 1 : -1;
    for (const k of c) {
      if (k.time <= e.t || k === c[c.length - 1]) continue;   // bỏ nến tín hiệu và nến đang chạy
      const hitSL = d > 0 ? k.low <= e.sl : k.high >= e.sl, hitTP = d > 0 ? k.high >= e.tp1 : k.low <= e.tp1;
      if (hitSL || hitTP) { Object.assign(e, { status: hitSL ? "sl" : "tp1", closeT: k.time, exit: hitSL ? e.sl : e.tp1, r: hitSL ? -1 : jR(e, e.tp1) }); out.push(e); break; }
    }
    if (e.status === "open" && nowSec() - e.t > 2 * 86400 && c[0].time < e.t) { Object.assign(e, { status: "expired", closeT: nowSec(), r: 0 }); out.push(e); }
  }
  jPost(out);
}
// thống kê một danh sách lệnh {status, r, t}: theo thứ tự thời gian
function statsOf(list) {
  const done = list.filter((x) => x.status === "tp1" || x.status === "sl").sort((a, b) => (a.closeT ?? a.t) - (b.closeT ?? b.t));
  let R = 0, pk = 0, dd = 0, ls = 0, mls = 0, w = 0;
  for (const x of done) {
    const r = x.status === "tp1" ? (x.r ?? 1) : -1; R += r;
    if (r > 0) { w++; ls = 0; } else { ls++; mls = Math.max(mls, ls); }
    pk = Math.max(pk, R); dd = Math.max(dd, pk - R);
  }
  return { n: list.length, closed: done.length, w, wr: done.length ? (100 * w) / done.length : null, R, avg: done.length ? R / done.length : null, dd, mls, open: list.filter((x) => x.status === "open" || x.status === "pending").length };
}
const statTxt = (st) => `<span>Lệnh <b>${st.n}</b></span><span>Đã đóng <b>${st.closed}</b></span><span>Winrate <b>${st.wr == null ? "—" : st.wr.toFixed(1) + "%"}</b></span>
  <span>Tổng <b class="${st.R >= 0 ? "win" : "loss"}">${sgn(st.R, 1)}R</b></span><span>TB <b>${st.avg == null ? "—" : sgn(st.avg, 2)}R</b></span><span>DD <b>${st.dd.toFixed(1)}R</b></span><span>Thua liền <b>${st.mls}</b></span>`;
function groupRows(list, key) {
  const g = {};
  for (const x of list) (g[key(x)] = g[key(x)] || []).push(x);
  return Object.entries(g).sort((a, b) => a[0].localeCompare(b[0])).map(([k, v]) => { const st = statsOf(v); return `<tr><td>${esc(k)}</td><td>${st.n}</td><td>${st.w}/${st.closed - st.w}</td><td>${st.wr == null ? "—" : st.wr.toFixed(0) + "%"}</td><td class="${st.R >= 0 ? "win" : "loss"}">${sgn(st.R, 1)}</td><td>${st.dd.toFixed(1)}</td></tr>`; }).join("");
}
const gHead = (t) => `<thead><tr><th>${t}</th><th>Lệnh</th><th>T/B</th><th>WR</th><th>R</th><th>DD</th></tr></thead>`;
const stTxt = { open: "đang chạy", pending: "chờ", tp1: "✓ TP1", sl: "✗ SL", expired: "hết hạn", missed: "lỡ", skip: "bỏ" };
function renderJournal() {
  const box = $("#jOut"); if (!box) return;
  document.querySelectorAll("#jTabs button").forEach((b) => b.classList.toggle("on", b.dataset.t === S.jTab));
  if (S.jTab === "live") {
    const J = S.journal, smc = J.filter((x) => x.kind === "SMC"), of = J.filter((x) => x.kind === "OF");
    const rows = [...J].sort((a, b) => b.t - a.t).slice(0, 40).map((e) => `<tr><td>${vnDate(e.t).slice(5)} ${vnClock(e.t)}</td><td>${e.kind === "SMC" ? "SMC" : "OF"} ${esc(e.name)} <span class="muted">${esc(e.tf || "")}</span></td>
      <td class="${e.side === "BUY" ? "win" : "loss"}">${e.side}</td><td>${fmt(e.entry)}</td><td>${fmt(e.sl)} / ${fmt(e.tp1)}</td><td class="${e.status === "tp1" ? "win" : e.status === "sl" ? "loss" : "muted"}">${stTxt[e.status] || e.status}</td><td>${e.r == null ? "—" : sgn(e.r, 2)}</td></tr>`).join("");
    box.innerHTML = `<div class="hstats"><b>Tất cả</b>${statTxt(statsOf(J))}</div><div class="hstats"><b>SMC</b>${statTxt(statsOf(smc))}</div><div class="hstats"><b>Options Flow</b>${statTxt(statsOf(of))}</div>
      <div class="jgrid"><table class="htable">${gHead("Loại")}<tbody>${groupRows(J, (x) => `${x.kind} ${x.name}`) || `<tr><td colspan="6" class="muted">Chưa có.</td></tr>`}</tbody></table>
      <table class="htable">${gHead("Tháng")}<tbody>${groupRows(J, (x) => vnDate(x.t).slice(0, 7)) || `<tr><td colspan="6" class="muted">Chưa có.</td></tr>`}</tbody></table></div>
      <div class="tablewrap"><table class="htable"><thead><tr><th>Giờ</th><th>Tín hiệu</th><th>Lệnh</th><th>Entry</th><th>SL / TP1</th><th>Kết quả</th><th>R</th></tr></thead><tbody>${rows || `<tr><td colspan="7" class="muted">Chưa có tín hiệu nào được ghi. Board ghi tự động khi có tín hiệu live (SMC ghi cả lệnh đã khớp trong 24 giờ).</td></tr>`}</tbody></table></div>
      <p class="muted small">Options Flow chỉ thống kê được từ khi bắt đầu ghi (chưa có OI lịch sử để backtest). Kết quả tính theo nến, chưa trừ spread/phí.</p>`;
    return;
  }
  const bt = S.bt;
  const head = `<div class="order"><label>Khung <select id="btTf"><option value="15m">M15</option><option value="5m">M5</option></select></label><button id="btRun" class="ghost small">Chạy backtest SMC</button><span class="muted small" id="btMsg">${bt?.msg || "Từ " + (S.cfg?.smc?.h4_from || "").slice(0, 10) + " tới nay, luật như board/Pine."}</span></div>`;
  let body = "";
  if (bt?.orders) {
    const O = bt.orders.filter((o) => o.status !== "skip"), st = statsOf(O.map((o) => ({ ...o, r: o.status === "tp1" ? o.rr : -1, t: o.time, closeT: o.closeT })));
    body = `<div class="hstats"><b>${bt.tf.toUpperCase()}</b>${statTxt(st)}<span>Bỏ (TP1&lt;1R) <b>${bt.orders.length - O.length}</b></span><span>Lỡ/hết hạn <b>${O.filter((o) => o.status === "missed" || o.status === "expired").length}</b></span></div>
      <canvas id="btCv" class="hedgecv" height="110"></canvas>
      <div class="jgrid"><table class="htable">${gHead("CL-KB")}<tbody>${groupRows(O.map((o) => ({ ...o, r: o.rr, t: o.time })), (x) => x.name + " " + x.side)}</tbody></table>
      <table class="htable">${gHead("Tháng")}<tbody>${groupRows(O.map((o) => ({ ...o, r: o.rr, t: o.time })), (x) => vnDate(x.t).slice(0, 7))}</tbody></table></div>
      <p class="muted small">SL trước nếu cùng nến chạm SL và TP1, không tính phí/spread. Nến Binance perp (lọc giờ FXCM), H4 gộp từ 1h neo 18:00 New York.</p>`;
  }
  box.innerHTML = head + body;
  if (bt?.tf) $("#btTf").value = bt.tf;
  $("#btRun").onclick = runBacktest;
  if (bt?.orders) drawEquity(bt.orders.filter((o) => o.status === "tp1" || o.status === "sl"));
}
async function runBacktest() {
  const tf = $("#btTf").value; S.bt = { tf, msg: "Đang tải nến…" }; renderJournal();
  try {
    const get = async (t) => { const r = await (await fetch(API(`/api/klines?tf=${t}`))).json(); if (!r.ok) throw new Error(r.error || "lỗi tải nến"); return r.rows; };
    const mk2 = (r) => ({ time: r[0], open: r[1], high: r[2], low: r[3], close: r[4], vol: r[5], delta: 0 });
    const t0 = h4From(), seed = (a) => { const k = a.findIndex((x) => x.time >= t0); return a.slice(Math.max(0, k - 1)); };
    const [rc, rh] = await Promise.all([get(tf), get("1h")]);
    const c = seed(rc.map(mk2).filter((k) => SMC.fxOpen(k.time))), h4 = seed(SMC.aggregate(rh.map(mk2).filter((k) => SMC.fxOpen(k.time)), H4_SEC));
    const cfg = { ...smcCfg(), kb2: true, tfSec: TF_SEC[tf], tfName: tf === "15m" ? "M15" : "M5", sessionOk: S.cfg?.smc?.session_only ? inUsSession : null };
    const r = SMC.analyze(c, h4, H4_SEC, cfg);
    const orders = r.orders.map((o) => ({ ...o, time: c[o.created].time, closeT: o.closeI != null && c[o.closeI] ? c[o.closeI].time : null }));
    S.bt = { tf, orders, msg: `${c.length} nến ${tf} · ${vnDate(c[0].time)} → ${vnDate(c[c.length - 1].time)}` };
  } catch (e) { S.bt = { tf, msg: "Lỗi: " + e.message }; }
  renderJournal();
}
function drawEquity(done) {
  const cv = $("#btCv"); if (!cv || !done.length) return;
  done.sort((a, b) => (a.closeT ?? a.time) - (b.closeT ?? b.time));
  const dpr = window.devicePixelRatio || 1, W = cv.clientWidth || 300, Hh = 110;
  cv.width = W * dpr; cv.height = Hh * dpr; const ctx = cv.getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  let R = 0; const eq = [0, ...done.map((o) => (R += o.status === "tp1" ? o.rr : -1))];
  const lo = Math.min(0, ...eq), hi = Math.max(0.5, ...eq), X = (i) => (i / (eq.length - 1 || 1)) * W, Y = (v) => Hh - 8 - ((v - lo) / (hi - lo || 1)) * (Hh - 16);
  ctx.strokeStyle = "#3a4552"; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(0, Y(0)); ctx.lineTo(W, Y(0)); ctx.stroke(); ctx.setLineDash([]);
  ctx.strokeStyle = R >= 0 ? C.up : C.down; ctx.lineWidth = 1.6; ctx.beginPath(); eq.forEach((v, i) => (i ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v)))); ctx.stroke();
  ctx.font = "10px 'IBM Plex Mono', monospace"; ctx.fillStyle = C.muted; ctx.textBaseline = "top"; ctx.fillText(`Equity (R) · ${done.length} lệnh đóng · ${sgn(R, 1)}R`, 4, 2);
}

// ─────────────────────────── Bước 5: mô phỏng Rebalance Hedge của LP ───────────────────────────
// Backend tính N(ΔP) = số HĐ GC tương đương LP phải MUA (+) / BÁN (−) trên lưới ±100 USD quanh giá lúc tính.
// Board dời theo giá live: N từ giá hiện tại = N(x0 + ΔP) − N(x0), x0 = giá live − giá lúc tính.
const hedgeSt = () => S.state?.hedge || null;
function interp(xs, ys, x) {
  if (!xs?.length) return null;
  if (x <= xs[0]) return ys[0];
  if (x >= xs[xs.length - 1]) return ys[ys.length - 1];
  let i = 1; while (xs[i] < x) i++;
  const a = ys[i - 1], b = ys[i];
  if (a == null || b == null) return a ?? b;
  return a + (b - a) * (x - xs[i - 1]) / (xs[i] - xs[i - 1]);
}
function hedgeFrom(dp, price = lastPrice(), key = "all") {
  const h = hedgeSt(); if (!h || price == null) return null;
  const x0 = price - h.price, xs = h.curve.dp, ys = h.curve[key];
  if (Math.abs(x0 + dp) > xs[xs.length - 1]) return null;
  return interp(xs, ys, x0 + dp) - interp(xs, ys, x0);
}
function hedgePer(price = lastPrice()) { const h = hedgeSt(); return h && price != null ? interp(h.curve.dp, h.curve.per, price - h.price) : null; }
const hTier = (v) => { const h = hedgeSt(), a = Math.abs(v ?? 0); return !h ? "" : a >= h.big ? "LP / Big Boy" : a >= h.mid ? "quỹ vừa" : "nhỏ"; };
const hKind = (v) => (v > 0 ? "−Γ gia tốc (LP hedge thuận chiều giá)" : "+Γ hãm (LP hedge ngược chiều giá)");
const hZoneAt = (price) => (hedgeSt()?.zones || []).find((z) => price >= z.lo && price <= z.hi) || null;
function hNext(price, up) {
  const zs = (hedgeSt()?.zones || []).filter((z) => (up ? z.lo > price : z.hi < price));
  return zs.length ? (up ? zs.reduce((a, z) => (z.lo < a.lo ? z : a)) : zs.reduce((a, z) => (z.hi > a.hi ? z : a))) : null;
}
const nHD = (v) => (v == null ? "—" : `<span class="${v >= 0 ? "up" : "down"}">${v >= 0 ? "MUA" : "BÁN"} ${Math.abs(Math.round(v)).toLocaleString("en-US")}</span>`);
function renderHedge() {
  const box = $("#hedgeOut"); if (!box) return;
  const h = hedgeSt(), p = lastPrice();
  if (!h || p == null) { box.innerHTML = `<p class="muted">Chưa có dữ liệu Options để mô phỏng (cần GC/GLD).</p>`; return; }
  const srcs = h.sources || [];
  const sh = (src, dp) => { const r = h.moves.find((m) => m.dp === dp); return r ? r[src] : null; };
  // bảng: dời theo giá live cho cột Tổng/≤7 ngày; cột từng nguồn lấy tại giá lúc tính
  const rows = h.moves.map((m) => `<tr><td class="${m.dp > 0 ? "up" : "down"}">${m.dp > 0 ? "+" : ""}${m.dp}</td>
    ${srcs.map((src) => `<td>${nHD(sh(src, m.dp))}</td>`).join("")}<td><b>${nHD(hedgeFrom(m.dp, p))}</b></td><td>${nHD(hedgeFrom(m.dp, p, "short"))}</td></tr>`).join("");
  const per = hedgePer(p), z = hZoneAt(p), up = hNext(p, true), dn = hNext(p, false);
  const zTxt = (q, lab) => q ? `${lab} <b>${fmt(q.lo)}–${fmt(q.hi)}</b> (đỉnh ${Math.abs(q.peak).toLocaleString("en-US")} HĐ/${h.win}$, ${q.kind === "accel" ? "−Γ gia tốc" : "+Γ hãm"})` : `${lab} không có trong ±100 USD`;
  box.innerHTML = `<p class="hedgehead">Tại ${fmt(p)}: mỗi ${h.win} USD LP giao dịch ≈ <b>${Math.abs(Math.round(per ?? 0)).toLocaleString("en-US")} HĐ GC</b> · cỡ <b>${hTier(per)}</b> · ${per == null ? "" : hKind(per)}${z ? ` · <span class="hz">ĐANG TRONG VÙNG HEDGE LỚN</span>` : ""}</p>
    <div class="tablewrap"><table class="htable hedge"><thead><tr><th>ΔP USD</th>${srcs.map((s) => `<th>${s}</th>`).join("")}<th>Tổng</th><th title="Chỉ các kỳ đáo hạn ≤ 7 ngày">≤ 7 ngày</th></tr></thead><tbody>${rows}</tbody></table></div>
    <canvas id="hedgeCv" class="hedgecv" height="120"></canvas>
    <p class="small">${zTxt(up, "↑ Vùng hedge lớn phía trên:")}<br>${zTxt(dn, "↓ Vùng hedge lớn phía dưới:")}</p>`;
  $("#hedgeMeta").textContent = `GC${srcs.includes("GLD") ? " + GLD" : ""} · tính lúc ${new Date(h.time).toLocaleTimeString("vi-VN")} ở ${fmt(h.price)}`;
  drawHedgeCurve(h, p);
}
function drawHedgeCurve(h, p) {
  const cv = $("#hedgeCv"); if (!cv) return;
  const dpr = window.devicePixelRatio || 1, W = cv.clientWidth || 300, Hh = 120;
  cv.width = W * dpr; cv.height = Hh * dpr; const ctx = cv.getContext("2d"); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const xs = h.curve.dp.map((d) => h.price + d), per = h.curve.per;
  const vmax = Math.max(h.big * 1.2, ...per.filter((v) => v != null).map(Math.abs));
  const X = (x) => ((x - xs[0]) / (xs[xs.length - 1] - xs[0])) * W, Y = (v) => Hh / 2 - (v / vmax) * (Hh / 2 - 8);
  ctx.fillStyle = "rgba(255,255,255,.03)"; ctx.fillRect(0, Y(h.big), W, Y(-h.big) - Y(h.big));
  for (const z of h.zones) { ctx.fillStyle = z.kind === "accel" ? "rgba(229,83,75,.16)" : "rgba(38,179,132,.16)"; ctx.fillRect(X(z.lo), 0, Math.max(2, X(z.hi) - X(z.lo)), Hh); }
  ctx.strokeStyle = "#3a4552"; ctx.setLineDash([3, 3]);
  for (const v of [h.big, -h.big, 0]) { ctx.beginPath(); ctx.moveTo(0, Y(v)); ctx.lineTo(W, Y(v)); ctx.stroke(); }
  ctx.setLineDash([]); ctx.lineWidth = 1.6; ctx.beginPath(); let on = false;
  per.forEach((v, i) => { if (v == null) { on = false; return; } const x = X(xs[i]), y = Y(v); on ? ctx.lineTo(x, y) : ctx.moveTo(x, y); on = true; });
  ctx.strokeStyle = C.mag; ctx.stroke();
  const xp = X(p); ctx.strokeStyle = C.fg; ctx.beginPath(); ctx.moveTo(xp, 0); ctx.lineTo(xp, Hh); ctx.stroke();
  ctx.font = "10px 'IBM Plex Mono', monospace"; ctx.fillStyle = C.muted; ctx.textBaseline = "top";
  ctx.textAlign = "left"; ctx.fillText(`${fmt(xs[0], 0)}`, 2, Hh - 12); ctx.textAlign = "right"; ctx.fillText(`${fmt(xs[xs.length - 1], 0)}`, W - 2, Hh - 12);
  ctx.textAlign = "left"; ctx.fillText(`HĐ/${h.win}$  ↑ −Γ gia tốc · ↓ +Γ hãm · vạch ±${h.big}`, 2, 2);
}
function renderAll() { renderQuote(); renderProfile(); renderKpis(); renderMacro(); renderAgent(); renderHedge(); renderJournal(); renderWarn(); renderEngineChip(); renderBuild(); renderPaper(); showAiLast(); drawOverlay(); }

// ─────────────────────────── tài khoản Paper ───────────────────────────
function paperLoad() {
  let p = null;
  try { p = JSON.parse(localStorage.getItem(PAPER_KEY) || "null"); } catch { p = null; }
  const start = S.cfg?.risk?.account_size_usd || 10000;
  S.paper = p && typeof p.balance === "number" ? p : { start, balance: start, pos: null, hist: [] };
}
function paperSave() { try { localStorage.setItem(PAPER_KEY, JSON.stringify(S.paper)); } catch { /* bỏ qua */ } }
const oz = () => S.cfg?.risk?.contract_oz || 100;
function pnlOf(pos, price) { return (price - pos.entry) * (pos.side === "BUY" ? 1 : -1) * pos.lots * oz(); }
function paperOpen(side, lots, sl, tp, note) {
  const p = lastPrice(); if (p == null || S.paper.pos) return;
  S.paper.pos = { side, lots: +lots || 0.01, entry: p, sl: sl ?? null, tp: tp ?? null, time: nowSec(), note: note || "" };
  paperSave(); renderPaper(); drawPlanLines();
}
function paperClose(price, reason) {
  const pos = S.paper.pos; if (!pos) return;
  const pnl = pnlOf(pos, price), risk = pos.sl != null ? Math.abs(pos.entry - pos.sl) * pos.lots * oz() : null;
  S.paper.balance += pnl;
  S.paper.hist.push({ ...pos, exit: price, closed: nowSec(), pnl, r: risk ? pnl / risk : null, reason });
  S.paper.pos = null; paperSave(); renderPaper(); drawPlanLines();
}
function paperTick(price) {
  const pos = S.paper?.pos; if (!pos) { return; }
  const buy = pos.side === "BUY";
  if (pos.sl != null && (buy ? price <= pos.sl : price >= pos.sl)) return paperClose(pos.sl, "SL");
  if (pos.tp != null && (buy ? price >= pos.tp : price <= pos.tp)) return paperClose(pos.tp, "TP");
  renderPaperNums();
}
function drawPlanLines() {
  S.planLines.forEach((l) => candleS.removePriceLine(l)); S.planLines = [];
  const pos = S.paper?.pos; if (!pos) return;
  const add = (price, color, title, style) => price != null && S.planLines.push(candleS.createPriceLine({ price, color, lineWidth: 1, lineStyle: style, axisLabelVisible: true, title }));
  add(pos.entry, pos.side === "BUY" ? C.up : C.down, `${pos.side} ${pos.lots}`, 0);
  add(pos.sl, C.down, "SL", 2); add(pos.tp, C.up, "TP", 2);
}
function renderPaperNums() {
  const P = S.paper, p = lastPrice(), open = P.pos && p != null ? pnlOf(P.pos, p) : 0;
  const closed = P.hist.reduce((a, h) => a + h.pnl, 0);
  $("#acctNums").innerHTML = `<div><small>Balance</small>$${fmt(P.balance, 0)}</div><div><small>Equity</small>$${fmt(P.balance + open, 0)}</div>
    <div><small>Lãi/lỗ mở</small><span class="${open >= 0 ? "win" : "loss"}">${sgn(open, 0)}</span></div><div><small>Đã chốt</small><span class="${closed >= 0 ? "win" : "loss"}">${sgn(closed, 0)}</span></div>`;
  $("#openPos").innerHTML = P.pos ? `<div class="row"><b class="${P.pos.side === "BUY" ? "win" : "loss"}">${P.pos.side} ${P.pos.lots} lot</b><span>@ ${fmt(P.pos.entry)}</span><span>SL ${fmt(P.pos.sl)}</span><span>TP ${fmt(P.pos.tp)}</span><span>${vnClock(P.pos.time)}</span>${P.pos.note ? `<span class="muted">${esc(P.pos.note)}</span>` : ""}</div>` : `<span class="muted small">Không có lệnh đang mở.</span>`;
}
function renderPaper() {
  if (!S.paper) return;
  renderPaperNums();
  const h = S.paper.hist;
  $("#hTable tbody").innerHTML = [...h].reverse().slice(0, 100).map((x) =>
    `<tr><td>${vnClock(x.closed)}</td><td class="${x.side === "BUY" ? "win" : "loss"}">${x.side} ${x.lots}</td><td>${fmt(x.entry)}</td><td>${fmt(x.exit)}</td><td>${fmt(x.sl)} / ${fmt(x.tp)}</td><td class="${x.r > 0 ? "win" : x.r < 0 ? "loss" : ""}">${x.r == null ? "—" : sgn(x.r, 2)}</td><td class="${x.pnl >= 0 ? "win" : "loss"}">${sgn(x.pnl, 0)}</td></tr>`).join("") || `<tr><td colspan="7" class="muted">Chưa có lệnh nào.</td></tr>`;
  const wins = h.filter((x) => x.pnl > 0), gp = wins.reduce((a, x) => a + x.pnl, 0), gl = -h.filter((x) => x.pnl < 0).reduce((a, x) => a + x.pnl, 0);
  $("#hStats").innerHTML = `<span>Lệnh <b>${h.length}</b></span><span>Thắng <b>${h.length ? Math.round((wins.length / h.length) * 100) : 0}%</b> (${wins.length}/${h.length})</span>
    <span>Tổng <b class="${gp - gl >= 0 ? "win" : "loss"}">${sgn(gp - gl, 0)}$</b></span><span>PF <b>${gl > 0 ? fmt(gp / gl, 2) : "—"}</b></span>`;
}
function exportCsv() {
  const rows = [["open", "close", "side", "lots", "entry", "exit", "sl", "tp", "R", "pnl", "reason", "note"]].concat(S.paper.hist.map((x) => [vnDate(x.time) + " " + vnClock(x.time), vnDate(x.closed) + " " + vnClock(x.closed), x.side, x.lots, x.entry, x.exit, x.sl ?? "", x.tp ?? "", x.r ?? "", x.pnl.toFixed(2), x.reason, `"${(x.note || "").replace(/"/g, '""')}"`]));
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["﻿" + rows.map((r) => r.join(",")).join("\n")], { type: "text/csv" }));
  a.download = `bildol-paper-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
}

// ─────────────────────────── backend ───────────────────────────
async function pollState(first = false) {
  try {
    const st = await (await fetch(API("/api/state") + (STATIC ? "?t=" + Date.now() : ""))).json();
    const changed = JSON.stringify(st.options) !== JSON.stringify(S.state?.options);
    S.state = st; S.cfg = st.config;
    if (first) return;
    // chênh lệch đổi > 0.6 USD so với lúc vẽ -> tải lại nến cho khớp giá broker
    if (S.feed && S.feed.symbol === feeds()[0].symbol && Math.abs(basisNow() - (S.basis || 0)) > 1.0) { startFeed(); return; }
    if (STATIC) staticRecompute(true);
    if (changed) { runSMC(); replaySignals(); renderPine(); S.profScrolled = false; }
    renderAll();
  } catch { S.state = null; renderEngineChip(); }
}
// Nhận định AI mới nhất do máy tính tự chạy (mỗi 60 phút + sau job 13:30) → tự hiện trên board và bản web
function showAiLast(force = false) {
  const a = S.state?.ai_last, out = $("#aiOut");
  if (!a?.text || (!force && S.aiShown === a.time)) return;
  if (!force && S.aiManual && new Date(S.aiManual) > new Date(a.time)) return;   // đang xem bản vừa bấm tay, mới hơn
  S.aiShown = a.time;
  out.innerHTML = esc(a.text).split(/\n{2,}/).map((p) => `<p>${p.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/\n/g, "<br>")}</p>`).join("");
  $("#aiMeta").textContent = `${a.auto ? "Tự chạy" : "Bấm tay"} · ${new Date(a.time).toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })}`;
}
async function askAI() {
  if (STATIC) {
    if (S.state?.ai_last?.text) showAiLast(true);
    else $("#aiOut").innerHTML = `<p class="muted">Chưa có nhận định AI nào. Máy tính chạy AI lúc 13:30 mỗi ngày và mỗi lần bấm "AI phân tích" trên board máy tính.</p>`;
    return;
  }
  const btn = $("#btnAI"), out = $("#aiOut"), c = S.candles, last = c[c.length - 1], sc = S.cfg.signals;
  btn.disabled = true; out.innerHTML = `<p class="muted">Claude đang đọc dữ liệu và lập kịch bản… (10–60 giây)</p>`;
  const vavg = c.slice(-sc.vol_sma - 1, -1).reduce((a, x) => a + x.vol, 0) / sc.vol_sma, d = divAt(c.length - 1), ag = agentState();
  const body = {
    price: lastPrice(),
    flow: { lenh_lon: (() => { const f = bigFlow(sc.cvd_slope_bars); return f ? { nguong_oz: S.big.thr, rong_oz_5_nen: f.d, mua_lon_oz_5_nen: f.b, ban_lon_oz_5_nen: f.s, so_lenh_mua: f.nb, so_lenh_ban: f.ns, so_lenh: f.n, cvd_lenh_lon_phien: last?.bigcvd, ghi_chu: "giao dịch khớp ≥ ngưỡng trên Binance (đại diện một phần)" } : null; })(), cvd_phien: last?.cvd, cvd_doc_5_nen: c.length > 6 ? last.cvd - c[c.length - 6].cvd : null, volume_so_voi_tb: vavg ? last.vol / vavg : null, phan_ky: d.bear ? "âm" : d.bull ? "dương" : "không", khung: S.tf, wall_chinh: S.primary, agent: ag ? { act: ag.act, regime: ag.regime, target: ag.target, conviction: ag.conv } : null,
      smc: S.smc ? { cau_truc: S.smc.struct, ke_hoach: S.smc.plan, lenh: smcOrders().slice(-4).map((o) => ({ gio_vn: vnClock(S.candles[o.created]?.time ?? 0), loai: o.txt, huong: o.side, trang_thai: o.status, entry: o.entry, sl: o.sl, tp1: o.tp1, tp2: o.tp2, tp3: o.tp3 })) } : null },
    signals: S.signals.slice(-3).map((s) => ({ gio_vn: vnClock(s.time), loai: s.type, huong: s.side, diem: `${s.score}/${s.max}`, entry: s.entry, sl: s.sl, tp1: s.tp1, tp2: s.tp2 })),
    candles: c.slice(-30).map((x) => [vnClock(x.time), +x.open.toFixed(2), +x.high.toFixed(2), +x.low.toFixed(2), +x.close.toFixed(2), Math.round(x.vol), Math.round(x.delta)]),
  };
  try {
    const res = await (await fetch("/api/analyze", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).json();
    if (!res.ok) { out.innerHTML = `<p class="loss">${esc(res.error)}</p><p class="muted small">Nhập key: nhấp đúp DAT_API_KEY.bat trong thư mục bildol-gold-terminal.</p>`; return; }
    out.innerHTML = esc(res.text).split(/\n{2,}/).map((p) => `<p>${p.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/\n/g, "<br>")}</p>`).join("");
    $("#aiMeta").textContent = `${res.model || "Claude"} · ${new Date().toLocaleTimeString("vi-VN")}${res.web ? " · đã gửi lên web (≈1–3 phút sau mở link sẽ thấy)" : ""}`;
    S.aiManual = new Date().toISOString();
  } catch (e) { out.innerHTML = `<p class="loss">Không gọi được backend: ${esc(e.message)}</p>`; }
  finally { btn.disabled = false; }
}
async function loadMt5() {
  const out = $("#mt5Out");
  try {
    const r = await (await fetch("/api/account")).json();
    if (!r.ok) { out.textContent = r.error; return; }
    out.innerHTML = `<p>${esc(r.account.server)} · #${r.account.login} · Balance ${fmt(r.account.balance)} · Equity ${fmt(r.account.equity)}</p>` +
      (r.positions.map((p) => `<div>${p.type} ${esc(p.symbol)} ${p.volume} @ ${fmt(p.price_open)} · PnL ${fmt(p.profit)}</div>`).join("") || "<div>Không có lệnh XAU đang mở.</div>");
  } catch { out.textContent = "Không đọc được /api/account."; }
}

// ─────────────────────────── sự kiện ───────────────────────────
function bind() {
  $("#tfs").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    document.querySelectorAll("#tfs button").forEach((x) => x.classList.toggle("on", x === b));
    S.tf = b.dataset.tf; try { localStorage.setItem("bildol.tf", S.tf); } catch { } startFeed();
  });
  ["#lyKey", "#lyGLD", "#lyGex", "#lyVP"].forEach((s) => $(s).addEventListener("change", drawOverlay));
  $("#lyMk").addEventListener("change", setMarkers);
  $("#lySMC").addEventListener("change", () => { setMarkers(); drawOverlay(); });
  $("#primarySrc").addEventListener("change", (e) => { S.primary = e.target.value; try { localStorage.setItem("bildol.primary", S.primary); } catch { } replaySignals(); renderAll(); });
  $("#profTabs").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    document.querySelectorAll("#profTabs button").forEach((x) => x.classList.toggle("on", x === b));
    S.profSrc = b.dataset.src; S.profScrolled = false; renderProfile();
  });
  $("#tenorSel")?.addEventListener("change", (e) => {
    S.tenor = e.target.value; S.profScrolled = false;
    try { localStorage.setItem("bildol.tenor", S.tenor); } catch { }
    renderProfile(); drawOverlay();
  });
  $("#btnRefresh").addEventListener("click", async () => {
    const b = $("#btnRefresh"); b.disabled = true; b.textContent = "Đang làm mới…";
    await fetch("/api/refresh", { method: "POST" }).catch(() => { });
    setTimeout(async () => { await pollState(); b.disabled = false; b.textContent = "Làm mới Options"; }, 20000);
  });
  $("#btnAI").addEventListener("click", askAI);
  $("#btnCopyTV")?.addEventListener("click", copyTV);
  const num = (id) => { const v = parseFloat($(id).value); return isFinite(v) ? v : null; };
  $("#oBuy").addEventListener("click", () => paperOpen("BUY", num("#oLots"), num("#oSL"), num("#oTP"), "Thủ công"));
  $("#oSell").addEventListener("click", () => paperOpen("SELL", num("#oLots"), num("#oSL"), num("#oTP"), "Thủ công"));
  $("#oSig").addEventListener("click", () => {
    const s = S.signals[S.signals.length - 1]; if (!s) { $("#openPos").innerHTML = `<span class="muted small">Chưa có tín hiệu hôm nay.</span>`; return; }
    $("#oLots").value = planFor(s).lots.toFixed(2); $("#oSL").value = s.sl.toFixed(2); $("#oTP").value = s.tp1 != null ? s.tp1.toFixed(2) : "";
  });
  $("#oClose").addEventListener("click", () => { const p = lastPrice(); if (p != null) paperClose(p, "Đóng tay"); });
  let resetArmed = false;
  $("#oReset").addEventListener("click", (e) => {
    if (!resetArmed) { resetArmed = true; e.target.textContent = "Bấm lần nữa để xác nhận"; setTimeout(() => { resetArmed = false; e.target.textContent = "Đặt lại tài khoản"; }, 4000); return; }
    const start = S.cfg?.risk?.account_size_usd || 10000; S.paper = { start, balance: start, pos: null, hist: [] }; paperSave(); renderPaper(); drawPlanLines();
    resetArmed = false; e.target.textContent = "Đặt lại tài khoản";
  });
  $("#hExport").addEventListener("click", exportCsv);
  $("#jTabs").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; S.jTab = b.dataset.t; renderJournal(); });
  $("#mt5Box").addEventListener("toggle", (e) => { if (e.target.open) loadMt5(); });
  document.addEventListener("click", () => { if ("Notification" in window && Notification.permission === "default") Notification.requestPermission(); }, { once: true });
}

async function boot() {
  if (!LC) { $("#warn").hidden = false; $("#warn").textContent = "Không tải được thư viện biểu đồ (cần Internet)."; return; }
  try { S.primary = localStorage.getItem("bildol.primary") || "GC"; S.tf = localStorage.getItem("bildol.tf") || "15m"; S.tenor = localStorage.getItem("bildol.tenor") || "all"; } catch { }
  if (!TENOR_TXT[S.tenor]) S.tenor = "all";
  if ($("#tenorSel")) $("#tenorSel").value = S.tenor;
  $("#primarySrc").value = S.primary;
  document.querySelectorAll("#tfs button").forEach((x) => x.classList.toggle("on", x.dataset.tf === S.tf));
  if (STATIC) initStatic();
  await pollState(true);
  if (!S.state) { $("#warn").hidden = false; $("#warn").textContent = STATIC ? "Chưa tải được dữ liệu (state.json). Kiểm tra mạng rồi mở lại." : "Không kết nối được backend. Hãy chạy MO_DASHBOARD.bat và giữ cửa sổ đen đó mở."; return; }
  // Không có GC thì mặc định dùng GLD cho Strike Profile
  if (!opt("GC") && opt("GLD")) { S.profSrc = "GLD"; document.querySelectorAll("#profTabs button").forEach((x) => x.classList.toggle("on", x.dataset.src === "GLD")); }
  void 0;
  paperLoad();
  initCharts(); initOverlay(); bind(); initTouchTips();
  await startFeed();
  if (STATIC) { staticRecompute(true); renderAll(); }
  drawPlanLines(); renderPine();
  await journalLoad(); journalSyncSMC(); journalTrack(); renderJournal();
  setInterval(pollState, STATIC ? 120000 : 20000);
  if (STATIC) setInterval(() => { staticRecompute(); renderProfile(); renderAgent(); renderHedge(); drawOverlay(); }, 30000);
  setInterval(() => { renderMacro(); renderEngineChip(); renderAgent(); }, 30000);
}
boot();
