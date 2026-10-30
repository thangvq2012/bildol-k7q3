/* Bildol — SMC theo hệ thống của trader (v20: đỉnh/đáy luân phiên tuyệt đối, râu thủng mốc đã hình thành = nến quét, nến theo giờ FXCM) (cùng luật với indicator TradingView, mục ⑥).
   • Nến tạo đỉnh: nến giảm, đóng cửa < Low nến liền trước. Nến tạo đáy: nến tăng, đóng cửa > High nến liền trước.
   • Nến xác nhận: một nến cùng loại tiếp theo, ở giữa không có nến loại ngược lại.
   • Đỉnh/đáy tạm thành CHÍNH THỨC khi giá ĐÓNG CỬA phá đỉnh/đáy gần nhất của cùng khung
     (BOS nếu thuận xu hướng, CHoCH nếu đảo xu hướng).
   • Vùng thanh khoản: đỉnh/đáy gần nhất, 2-3-4 đỉnh/đáy bằng nhau, trendline. Nến quét: râu vượt, đóng cửa quay lại.
   • CL1: thuận H4 tại Premium/Discount H4 (sau khi H4 đóng nến tạo đáy/đỉnh).
     CL2: chân hồi trên khung chart sau khi khung chart CHoCH ngược H4, tại Discount/Premium của khung chart. */
"use strict";

const SMC = (() => {
  // ───── cấu trúc một khung: trả về trạng thái sau MỖI nến ─────
  function structure(c) {
    const n = c.length, out = new Array(n);
    if (!n) return out;
    // cực trị trong đoạn [b0, b]; đoạn rỗng (b0 > b) -> [±Infinity, null]
    const lowestFrom = (b0, b) => { let m = Infinity, mi = null; for (let i = b; i >= Math.max(b0, b - 400); i--) if (c[i].low < m) { m = c[i].low; mi = i; } return [m, mi]; };
    const highestFrom = (b0, b) => { let m = -Infinity, mi = null; for (let i = b; i >= Math.max(b0, b - 400); i--) if (c[i].high > m) { m = c[i].high; mi = i; } return [m, mi]; };
    let trend = 0, oTop = null, oTopI = null, oBot = null, oBotI = null, tTop = null, tTopI = null, tBot = null, tBotI = null;
    let lastF = 0, topCf = false, botCf = false, hiRun = c[0].high, hiRunI = 0, loRun = c[0].low, loRunI = 0;
    let up = null, upI = null, upTemp = false, loUp = null, loUpI = null, dn = null, dnI = null, dnTemp = false, hiDn = null, hiDnI = null;
    let extHi = c[0].high, extLo = c[0].low, lastBfI = -1, lastTfI = -1;
    let upTfI = null, dnBfI = null; // nến tạo đỉnh của đỉnh tạm / nến tạo đáy của đáy tạm (tính từ cây làm đỉnh/đáy)
    out[0] = { trend, oTop, oTopI, oBot, oBotI, tTop, tTopI, tBot, tBotI, extHi, extLo, ev: 0, fm: 0, nTop: false, nBot: false, topHH: false, botHL: false, brk: null, brkI: null, up, upI, dn, dnI };
    for (let b = 1; b < n; b++) {
      const k = c[b], bf = k.close > c[b - 1].high && k.close > k.open, tf = k.close < c[b - 1].low && k.close < k.open;
      let ev = 0, fm = 0, nTop = false, nBot = false, topHH = false, botHL = false, brk = null, brkI = null;
      if (k.high > hiRun) { hiRun = k.high; hiRunI = b; }
      if (k.low < loRun) { loRun = k.low; loRunI = b; }
      extHi = Math.max(extHi, k.high); extLo = Math.min(extLo, k.low);
      if (up != null && k.low < loUp) { loUp = k.low; loUpI = b; }
      if (dn != null && k.high > hiDn) { hiDn = k.high; hiDnI = b; }
      if (bf) lastBfI = b;
      if (tf) lastTfI = b;
      // nến tạo đỉnh/đáy đang hình thành vươn xa hơn -> dời cực trị của nó
      if (lastF === -1 && tTop != null && k.high > tTop) { tTop = k.high; tTopI = b; topCf = false; }
      if (lastF === 1 && tBot != null && k.low < tBot) { tBot = k.low; tBotI = b; botCf = false; }
      if (tf) {
        if (lastF !== -1) {
          tTop = hiRun; tTopI = hiRunI; topCf = false; lastF = -1; fm = -1;
          // Chỉ tìm ĐỈNH TẠM tiếp theo khi đáy trước đó đã CHÍNH THỨC (xu hướng tăng) hoặc chưa có cấu trúc.
          // Xu hướng giảm: mốc phía trên vẫn là đỉnh chính thức (LH); nến tạo đỉnh lúc này chỉ là nhịp hồi.
          loRun = k.low; loRunI = b;
        } else if (!topCf) { topCf = true; fm = -2; }
      } else if (bf) {
        if (lastF !== 1) {
          tBot = loRun; tBotI = loRunI; botCf = false; lastF = 1; fm = 1;
          // Chỉ tìm ĐÁY TẠM tiếp theo khi đỉnh trước đó đã CHÍNH THỨC (xu hướng giảm) hoặc chưa có cấu trúc.
          hiRun = k.high; hiRunI = b;
        } else if (!botCf) { botCf = true; fm = 2; }
      }
      // Bắt đầu tìm đỉnh/đáy TẠM tiếp theo ở nến tạo đỉnh/đáy ĐẦU TIÊN sau khi mốc trước đã chính thức
      if (tf && upTemp && up != null && upTfI == null && b >= upI) upTfI = b;
      if (bf && dnTemp && dn != null && dnBfI == null && b >= dnI) dnBfI = b;
      if (tf && trend !== -1 && up == null && (trend !== 1 || hiDnI != null)) {
        if (trend === 1) { up = hiDn; upI = hiDnI; } else { up = tTop; upI = tTopI; } // cực trị dò ngược từ đáy chính thức
        upTemp = true; upTfI = b;
        [loUp, loUpI] = lowestFrom(upI + 1, b); // đáy phải nằm SAU cây đỉnh
      }
      if (bf && trend !== 1 && dn == null && (trend !== -1 || loUpI != null)) {
        if (trend === -1) { dn = loUp; dnI = loUpI; } else { dn = tBot; dnI = tBotI; } // thấp nhất kể từ đỉnh chính thức
        dnTemp = true; dnBfI = b;
        [hiDn, hiDnI] = highestFrom(dnI + 1, b); // đỉnh phải nằm SAU cây đáy
      }
      // phá cấu trúc theo giá đóng cửa
      //  - mốc CHÍNH THỨC: đóng cửa vượt là CHoCH/BOS ngay
      //  - mốc TẠM: phải có nhịp hồi (nến tạo đáy SAU cây đỉnh tạm / nến tạo đỉnh SAU cây đáy tạm, cách ít nhất 1 cây)
      //    rồi mới đóng cửa phá (quy tắc 3.2); chưa có nhịp hồi thì giá đi tiếp chỉ là kéo dài đỉnh/đáy tạm.
      //    Cụ thể với đỉnh tạm: đã có nến tạo đỉnh (từ cây đỉnh trở đi), sau đó có nến tạo đáy, và đáy hồi (thấp nhất sau
      //    cây đỉnh) có nến tạo đáy của chính nó -> đỉnh - đáy luôn xen kẽ, đáy không bao giờ trùng cây với đỉnh.
      const pullUp = upTemp && upTfI != null && loUpI != null && loUpI > upI && lastBfI > upTfI && lastBfI >= loUpI;
      const pullDn = dnTemp && dnBfI != null && hiDnI != null && hiDnI > dnI && lastTfI > dnBfI && lastTfI >= hiDnI;
      if (up != null && k.close > up && (upTemp ? pullUp : loUpI != null)) {
        brk = up; brkI = upI;
        if (upTemp) { nTop = true; topHH = oTop == null || up > oTop; oTop = up; oTopI = upI; }
        nBot = true; botHL = oBot == null || loUp > oBot; oBot = loUp; oBotI = loUpI;
        ev = trend === 1 ? 1 : 2; trend = 1;
        dn = oBot; dnI = oBotI; dnTemp = false;
        [hiDn, hiDnI] = highestFrom(oBotI + 1, b);
        up = null; upTemp = false; tTop = null; tBot = null;
        extHi = Math.max(oBot, hiDn); extLo = oBot;
      } else if (dn != null && k.close < dn && (dnTemp ? pullDn : hiDnI != null)) {
        brk = dn; brkI = dnI;
        if (dnTemp) { nBot = true; botHL = oBot == null || dn > oBot; oBot = dn; oBotI = dnI; }
        nTop = true; topHH = oTop == null || hiDn > oTop; oTop = hiDn; oTopI = hiDnI;
        ev = trend === -1 ? -1 : -2; trend = -1;
        up = oTop; upI = oTopI; upTemp = false;
        [loUp, loUpI] = lowestFrom(oTopI + 1, b);
        dn = null; dnTemp = false; tTop = null; tBot = null;
        extLo = Math.min(oTop, loUp); extHi = oTop;
      } else {
        // Đỉnh/đáy TẠM chưa hình thành đủ: giá vượt (kể cả bằng râu) -> dời mốc tới cực trị mới.
        // (dời mốc thì đáy/đỉnh hồi phải tìm lại từ SAU cây mới)
        // Đỉnh/đáy tạm đã hình thành đủ (đã có nhịp hồi theo 3.2) thì râu vượt mà đóng cửa quay lại = NẾN QUÉT, giữ nguyên mốc.
        if (upTemp && up != null && k.high > up && !pullUp) { up = k.high; upI = b; loUp = Infinity; loUpI = null; upTfI = tf ? b : null; }
        if (dnTemp && dn != null && k.low < dn && !pullDn) { dn = k.low; dnI = b; hiDn = -Infinity; hiDnI = null; dnBfI = bf ? b : null; }
      }
      // upOk/dnOk: đỉnh/đáy tạm của nhịp hiện tại đã HÌNH THÀNH ĐỦ (nến tạo + nhịp hồi, luật 3.2/8) -> mốc cố định cho Fibo KB2
      const upOk = upTemp && up != null && upTfI != null && loUpI != null && loUpI > upI && lastBfI > upTfI && lastBfI >= loUpI;
      const dnOk = dnTemp && dn != null && dnBfI != null && hiDnI != null && hiDnI > dnI && lastTfI > dnBfI && lastTfI >= hiDnI;
      out[b] = { trend, oTop, oTopI, oBot, oBotI, tTop, tTopI, tBot, tBotI, extHi, extLo, ev, fm, nTop, nBot, topHH, botHL, brk, brkI, up, upI, dn, dnI, upOk, dnOk };
    }
    return out;
  }

  // ───── khung lớn (H4) tại thời điểm t: dùng nến H4 ĐÃ ĐÓNG gần nhất ─────
  function htfAt(h4c, h4s, sec, t) {
    let lo = 0, hi = h4c.length - 1, j = -1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (h4c[m].time <= t) { j = m; lo = m + 1; } else hi = m - 1; }
    // nến H4 chứa t chưa đóng -> lấy nến trước nó
    const k = j >= 0 && t < h4c[j].time + sec ? j - 1 : j;
    if (k < 0) return null;
    const s = h4s[k], T = (i) => (i == null ? null : h4c[i].time);
    return { ...s, tTopT: T(s.tTopI), tBotT: T(s.tBotI), oTopT: T(s.oTopI), oBotT: T(s.oBotI) };
  }

  // ───── nến tạo / xác nhận của MỘT đỉnh/đáy (chỉ đỉnh/đáy thuộc cấu trúc của khung này) ─────
  // Nến tạo đỉnh: nến GIẢM đầu tiên (tính từ cây nến làm đỉnh) đóng cửa < Low nến liền trước.
  // Nến xác nhận đỉnh: nến tạo đỉnh kế tiếp, ở giữa KHÔNG có nến tạo đáy. (đáy: đối xứng)
  const isTF = (c, j) => j > 0 && c[j].close < c[j - 1].low && c[j].close < c[j].open;
  const isBF = (c, j) => j > 0 && c[j].close > c[j - 1].high && c[j].close > c[j].open;
  function formOf(c, e, end, top) {
    const F = top ? isTF : isBF, O = top ? isBF : isTF;
    let f = -1;
    for (let j = Math.max(1, e); j <= end; j++) if (F(c, j)) { f = j; break; }
    if (f < 0) return null;
    let cf = null;
    for (let j = f + 1; j <= end; j++) { if (O(c, j)) break; if (F(c, j)) { cf = j; break; } }
    return { f, cf };
  }
  // tất cả nến tạo/xác nhận cần vẽ: của đỉnh/đáy CHÍNH THỨC (vẽ khi đỉnh/đáy được công nhận) + của đỉnh/đáy TẠM đang chờ
  function formMarks(c, ms) {
    const out = [], n = c.length;
    for (let i = 1; i < n; i++) {
      const m = ms[i];
      if (m.nTop) { const r = formOf(c, m.oTopI, i, true); if (r) out.push({ side: "top", f: r.f, cf: r.cf, pending: false }); }
      if (m.nBot) { const r = formOf(c, m.oBotI, i, false); if (r) out.push({ side: "bot", f: r.f, cf: r.cf, pending: false }); }
    }
    const L = ms[n - 1];
    if (L && L.trend !== -1 && L.up != null) { const r = formOf(c, L.upI, n - 1, true); if (r) out.push({ side: "top", f: r.f, cf: r.cf, pending: true }); }
    if (L && L.trend !== 1 && L.dn != null) { const r = formOf(c, L.dnI, n - 1, false); if (r) out.push({ side: "bot", f: r.f, cf: r.cf, pending: true }); }
    return out;
  }

  // ───── thanh khoản + nến quét của một khung ─────
  // CHỈ 4 loại thanh khoản của đúng khung này (mức có sẵn trước khi nến mở):
  //  1) đỉnh/đáy gần nhất của cấu trúc (đỉnh LH/đỉnh tạm, đáy HL/đáy tạm)
  //  2) 2-3-4 đỉnh/đáy bằng nhau (lệch ≤ eqTol) chưa bị phá
  //  3) trendline nối 2 đỉnh chính thức gần nhất (xu hướng giảm) / 2 đáy chính thức gần nhất (xu hướng tăng)
  //  4) range: biên trên/dưới vùng đi ngang = chính là đỉnh/đáy gần nhất hai phía (đã nằm trong loại 1)
  // Nến quét (xét khi nến ĐÃ ĐÓNG): râu vượt mức, giá đóng cửa quay lại bên trong. Mỗi mức chỉ tính lần quét đầu tiên.
  function liquidity(c, ms, opt) {
    const n = c.length, sw = new Array(n).fill(null);
    const offT = [], offB = [], tops = [], bots = [], taken = new Set();
    const tlAt = (P, i) => { const a = P[P.length - 2], b = P[P.length - 1]; return b.i > a.i ? b.p + (b.p - a.p) / (b.i - a.i) * (i - b.i) : null; };
    // gom các mức gần nhau (≤ eqTol) thành nhóm; trả về mức đại diện (cực trị của nhóm)
    const groups = (arr, top) => {
      const s = [...arr].sort((x, y) => x.p - y.p), g = [];
      for (const x of s) { const last = g[g.length - 1]; if (last && x.p - last.lo <= opt.eqTol) { last.m.push(x); last.hi = x.p; } else g.push({ lo: x.p, hi: x.p, m: [x] }); }
      return g.map((q) => ({ p: top ? q.hi : q.lo, n: q.m.length, key: q.m.map((x) => x.i).sort((a, b) => a - b).join(","), m: q.m }));
    };
    const levels = (pm, i, top) => {
      const off = top ? offT : offB, near = top ? pm.up : pm.dn, nearI = top ? pm.upI : pm.dnI, L = [];
      const cand = near != null && !off.some((x) => x.i === nearI) ? [...off, { p: near, i: nearI }] : off;
      for (const q of groups(cand, top)) if (q.n >= 2) L.push({ p: q.p, key: (top ? "EH" : "EL") + q.key, txt: `${q.n} ${top ? "đỉnh" : "đáy"} bằng nhau ${q.p.toFixed(2)}`, n: q.n, i: Math.min(...q.m.map((x) => x.i)) });
      if (near != null && !L.some((x) => Math.abs(x.p - near) <= opt.eqTol))
        L.push({ p: near, key: (top ? "T" : "B") + nearI + "@" + near, txt: `${top ? "đỉnh" : "đáy"} gần nhất ${near.toFixed(2)}`, n: 1, i: nearI });
      const P = top ? tops : bots, okTl = opt.trendline && P.length >= 2 && (top ? pm.trend === -1 && P[P.length - 1].p < P[P.length - 2].p : pm.trend === 1 && P[P.length - 1].p > P[P.length - 2].p);
      const t = okTl ? tlAt(P, i) : null;
      if (t != null) L.push({ p: t, key: (top ? "TL" : "BL") + P[P.length - 2].i + "-" + P[P.length - 1].i, txt: "trendline", tl: true });
      return L;
    };
    let curH = [], curL = [], tl = null;
    for (let i = 1; i < n; i++) {
      const k = c[i], m = ms[i], pm = ms[i - 1];
      const LH = levels(pm, i, true), LL = levels(pm, i, false);
      const tH = [], tL = [];
      for (const L of LH) if (!taken.has(L.key) && k.high > L.p && k.close < L.p) { tH.push(L.txt); taken.add(L.key); }
      for (const L of LL) if (!taken.has(L.key) && k.low < L.p && k.close > L.p) { tL.push(L.txt); taken.add(L.key); }
      if (tH.length || tL.length) sw[i] = { bear: tH.length ? tH : null, bull: tL.length ? tL : null };
      // cập nhật sau khi nến đóng: mức bị phá bằng giá đóng cửa thì bỏ; đỉnh/đáy chính thức mới thì thêm
      for (let j = offT.length - 1; j >= 0; j--) if (k.close > offT[j].p) offT.splice(j, 1);
      for (let j = offB.length - 1; j >= 0; j--) if (k.close < offB[j].p) offB.splice(j, 1);
      if (m.nTop) { offT.push({ p: m.oTop, i: m.oTopI }); if (offT.length > 8) offT.shift(); tops.push({ p: m.oTop, i: m.oTopI }); if (tops.length > 3) tops.shift(); }
      if (m.nBot) { offB.push({ p: m.oBot, i: m.oBotI }); if (offB.length > 8) offB.shift(); bots.push({ p: m.oBot, i: m.oBotI }); if (bots.length > 3) bots.shift(); }
      if (i === n - 1) {
        // các mức đang còn hiệu lực cho nến KẾ TIẾP (để vẽ)
        const nx = levels(m, i + 1, true).filter((L) => !taken.has(L.key)), ny = levels(m, i + 1, false).filter((L) => !taken.has(L.key));
        curH = nx.filter((L) => !L.tl).map((L) => ({ p: L.p, i: L.i, n: L.n }));
        curL = ny.filter((L) => !L.tl).map((L) => ({ p: L.p, i: L.i, n: L.n }));
        const okD = opt.trendline && m.trend === -1 && tops.length >= 2 && tops[tops.length - 1].p < tops[tops.length - 2].p;
        const okU = opt.trendline && m.trend === 1 && bots.length >= 2 && bots[bots.length - 1].p > bots[bots.length - 2].p;
        tl = okD ? { a: tops[tops.length - 2], b: tops[tops.length - 1] } : okU ? { a: bots[bots.length - 2], b: bots[bots.length - 1] } : null;
      }
    }
    return { sw, liqH: curH, liqL: curL, tl };
  }

  const mirror = (c) => c.map((k) => ({ time: k.time, open: -k.open, high: -k.low, low: -k.high, close: -k.close, vol: k.vol, delta: -(k.delta || 0) }));
  // vị trí nến H4 đã đóng gần nhất tại thời điểm t (-1 nếu chưa có)
  function closedIdx(h4c, sec, t) {
    let lo = 0, hi = h4c.length - 1, j = -1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (h4c[m].time <= t) { j = m; lo = m + 1; } else hi = m - 1; }
    return j >= 0 && t < h4c[j].time + sec ? j - 1 : j;
  }

  // ───── các kịch bản khi H4 đang GIẢM (khi H4 tăng thì chạy trên dữ liệu lật ngược) ─────
  // CL1 = BUY hồi (KB1 risk, KB2 confirm, KB3 risk dự phòng); CL2 = SELL thuận ở vùng Premium (KB1, KB2, KB3).
  function setupsDown(c, ms, L, h4c, h4s, H, sec, opt) {
    const n = c.length, orders = [], used = new Set();
    let chUpT = null, chDnT = null, lastK = -1, sup = null, res = null, kb2UpT = null, kb2DnT = null;
    const gapsZ = [];
    const wickMidLow = (k) => k.low + (Math.min(k.open, k.close) - k.low) / 2;   // 50% râu dưới (nến quét đáy)
    const wickMidHigh = (k) => k.high - (k.high - Math.max(k.open, k.close)) / 2; // 50% râu trên (nến quét đỉnh)
    const tfSec = opt.tfSec || (n > 2 ? c[n - 1].time - c[n - 2].time : 900);
    const expiry = Math.round((opt.expiryH4 * sec) / tfSec);
    // Lập lệnh: TP1 = mốc cấu trúc gần nhất theo chiều lời (bỏ lệnh nếu < 1R, tối đa 3R; không có mốc thì 3R)
    const make = (o, cands, tp2, tp3) => {
      const key = `${o.cl}${o.side}${o.src}`; // một nến quét chỉ sinh một lệnh (KB1 và KB3 không trùng)
      if (used.has(key)) return;
      used.add(key);
      const dir = o.side === "BUY" ? 1 : -1, risk = (o.entry - o.sl) * dir;
      if (!(risk > 0)) return;
      const beyond = cands.filter((x) => x != null && isFinite(x) && (x - o.entry) * dir > 0).sort((a, b) => (a - b) * dir);
      let tp1 = beyond.length ? beyond[0] : o.entry + 3 * risk * dir, note = beyond.length ? "" : " (3R)";
      const rr = ((tp1 - o.entry) * dir) / risk;
      if (rr < 1) { orders.push({ ...o, status: "skip", why: `TP1 chỉ ${rr.toFixed(1)}R < 1R`, tp1, rr }); return; }
      if (rr > 3) { tp1 = o.entry + 3 * risk * dir; note = " (3R)"; }
      const ok = (x) => (x != null && isFinite(x) && (x - tp1) * dir > 0 ? x : null);
      orders.push({ ...o, tp1, tp2: ok(tp2), tp3: ok(tp3), rr: Math.min(3, rr), tpNote: note, status: o.type === "market" ? "open" : "pending", fillI: o.type === "market" ? o.created : null });
    };
    // ATR(14) H4 (RMA, giống ta.atr của TradingView)
    const atr = new Array(h4c.length).fill(null);
    for (let x = 1, a = null; x < h4c.length; x++) {
      const tr = Math.max(h4c[x].high - h4c[x].low, Math.abs(h4c[x].high - h4c[x - 1].close), Math.abs(h4c[x].low - h4c[x - 1].close));
      a = x <= 14 ? (a == null ? tr : a + tr) : a; if (x === 14) a /= 14; else if (x > 14) a = (a * 13 + tr) / 14;
      atr[x] = x >= 14 ? a : null;
    }
    // KB3 (risk, xác suất thấp) chỉ hợp lệ khi TỪ nến tạo đáy/đỉnh H4 giá đã chạy rất mạnh (≥ kb3Atr × ATR H4)
    // -> còn thanh khoản để thị trường quay lại lấy. kb3Atr = 0 thì tắt bộ lọc.
    const kb3Ok = (fromI, j, lvl, up) => {
      const mult = opt.kb3Atr ?? 2, a = atr[j - 1];
      if (!(mult > 0)) return { ok: true, run: null };
      if (fromI == null || a == null) return { ok: false, run: null };
      let ext = up ? -Infinity : Infinity;
      for (let x = fromI; x <= j - 1; x++) ext = up ? Math.max(ext, h4c[x].high) : Math.min(ext, h4c[x].low);
      const run = up ? ext - lvl : lvl - ext;
      return { ok: run >= mult * a, run: run / a };
    };
    // Xử lý một nến H4 vừa đóng (j) tại nến chart i
    const onH4 = (j, i) => {
      const s = h4s[j], p = h4s[j - 1];
      if (!s || !p || s.trend !== -1) return;
      const hi = s.oTop, lo = s.extLo, r = hi - lo;
      if (!(r > 0)) return;
      const fib = (x) => lo + r * x, k = h4c[j];
      const base = { created: i, createdT: c[i].time, h4: j };
      // Mỗi nến H4 chỉ sinh TỐI ĐA 1 lệnh, ưu tiên: CL1-KB1 > CL1-KB3 > CL2-KB1 > CL2-KB3 (giống Pine)
      // CL1-KB1: H4 vừa đóng nến tạo đáy; nến quét thanh khoản H4 nằm trong 3 nến gần nhất
      if (s.fm === 1) {
        for (let q = j; q >= Math.max(1, j - 3); q--) if (H.sw[q] && H.sw[q].bull && h4c[q].low <= s.tBot + opt.tol) {
          const kq = h4c[q];
          make({ ...base, cl: 1, kb: 1, side: "BUY", type: "limit", src: q, entry: wickMidLow(kq), sl: kq.low - opt.slBuf, why: "quét " + H.sw[q].bull.join(" + ") }, [s.oBot], fib(opt.oteLo), hi);
          return;
        }
      }
      // CL1-KB3: giá quay lại quét đáy của nến H4 tạo đáy (đáy tạm), đóng cửa rút râu — mỗi nến tạo đáy chỉ 1 lần
      const g1 = p.tBot != null && k.low < p.tBot && k.close > p.tBot ? kb3Ok(p.tBotI, j, p.tBot, true) : null;
      if (g1 && g1.ok) {
        make({ ...base, cl: 1, kb: 3, side: "BUY", type: "limit", src: "t" + p.tBotI, entry: wickMidLow(k), sl: k.low - opt.slBuf, why: "quét đáy nến H4 tạo đáy " + p.tBot.toFixed(2) + (g1.run != null ? ` (đã chạy ${g1.run.toFixed(1)}×ATR)` : "") }, [s.oBot], fib(opt.oteLo), hi);
        return;
      }
      // CL2-KB1: H4 đóng nến tạo đỉnh tạm trở lại ở vùng Premium (>0.5) + có nến quét thanh khoản H4
      if (s.fm === -1 && s.tTop != null && s.tTop >= fib(0.5)) {
        for (let q = j; q >= Math.max(1, j - 3); q--) if (H.sw[q] && H.sw[q].bear && h4c[q].high >= s.tTop - opt.tol) {
          const kq = h4c[q];
          make({ ...base, cl: 2, kb: 1, side: "SELL", type: "limit", src: q, entry: wickMidHigh(kq), sl: kq.high + opt.slBuf, why: "quét " + H.sw[q].bear.join(" + ") }, [fib(opt.oteHi)], lo, null);
          return;
        }
      }
      // CL2-KB3: đỉnh tạm của H4 (ở Premium) bị quét lại, đóng cửa rút râu — mỗi nến tạo đỉnh chỉ 1 lần
      const g2 = p.tTop != null && p.tTop >= fib(0.5) && k.high > p.tTop && k.close < p.tTop ? kb3Ok(p.tTopI, j, p.tTop, false) : null;
      if (g2 && g2.ok)
        make({ ...base, cl: 2, kb: 3, side: "SELL", type: "limit", src: "t" + p.tTopI, entry: wickMidHigh(k), sl: k.high + opt.slBuf, why: "quét đỉnh nến H4 tạo đỉnh " + p.tTop.toFixed(2) + (g2.run != null ? ` (đã chạy ${g2.run.toFixed(1)}×ATR)` : "") }, [fib(opt.oteHi)], lo, null);
    };
    let fin = null;
    for (let i = 2; i < n; i++) {
      const k = c[i], m = ms[i];
      if (m.ev === 2) chUpT = k.time;
      if (m.ev === -2) chDnT = k.time;
      // 1) lệnh đang chờ / đang chạy
      for (const o of orders) {
        if (i <= o.created || (o.status !== "pending" && o.status !== "open")) continue;
        const dir = o.side === "BUY" ? 1 : -1, hitE = dir > 0 ? k.low <= o.entry : k.high >= o.entry;
        const hitSL = dir > 0 ? k.low <= o.sl : k.high >= o.sl, hitTP = dir > 0 ? k.high >= o.tp1 : k.low <= o.tp1;
        if (o.status === "pending") {
          if (hitE) { o.status = "open"; o.fillI = i; if (hitSL) { o.status = "sl"; o.closeI = i; } }
          else if (hitTP) { o.status = "missed"; o.closeI = i; }
          else if (i - o.created > expiry) { o.status = "expired"; o.closeI = i; }
        } else if (hitSL) { o.status = "sl"; o.closeI = i; }
        else if (hitTP) { o.status = "tp1"; o.closeI = i; }
      }
      // 2) nến H4 vừa đóng
      const hk = closedIdx(h4c, sec, k.time);
      while (lastK < hk) { lastK++; if (lastK >= 1) onH4(lastK, i); }
      // 3) FVG / Imbalance trên khung chart
      const a = c[i - 2], b = c[i - 1];
      if (k.low > a.high) gapsZ.push({ lo: a.high, hi: k.low, bull: true, i });
      if (k.high < a.low) gapsZ.push({ lo: k.high, hi: a.low, bull: false, i });
      const bodyLo = Math.min(k.open, k.close), bodyHi = Math.max(k.open, k.close), pLo = Math.min(b.open, b.close), pHi = Math.max(b.open, b.close);
      if (bodyLo > pHi) gapsZ.push({ lo: pHi, hi: bodyLo, bull: true, i, imb: true });
      if (bodyHi < pLo) gapsZ.push({ lo: bodyHi, hi: pLo, bull: false, i, imb: true });
      while (gapsZ.length > 16) gapsZ.shift();
      for (let g = gapsZ.length - 1; g >= 0; g--) { const z = gapsZ[g]; if ((z.bull && k.close < z.lo) || (!z.bull && k.close > z.hi)) gapsZ.splice(g, 1); }
      // 4) KB2: xác nhận trên khung chart
      const h = hk >= 0 ? h4s[hk] : null;
      if (!h || h.trend !== -1) { fin = { h4: hk, active: false }; continue; }
      const hi = h.oTop, lo = h.extLo, r = hi - lo, fib = (x) => lo + r * x;
      const h4Bot = h.tBot != null, h4TopAgain = h.tTop != null && h.tTop >= fib(0.5);
      const tB = h4Bot ? h4c[h.tBotI].time : null, tT = h.tTop != null ? h4c[h.tTopI].time : null;
      const rev1 = h4Bot && m.trend === 1 && chUpT != null && chUpT >= tB;
      const rev2 = h4TopAgain && m.trend === -1 && chDnT != null && chDnT >= tT;
      let z1 = null, z2 = null;
      // Fibo KB2 (30/10, người dùng chốt): kéo từ đáy chính thức tới ĐỈNH CHÍNH THỨC hình thành sau đáy đó nếu đã có,
      // chưa có thì dùng đỉnh tạm (cao nhất). Vùng chờ hồi tính lại mỗi nến -> tự dời theo Fibo mới.
      if (rev1) {
        // trong xu hướng tăng, đỉnh của nhịp hiện tại = đỉnh tạm `up` (thành chính thức khi bị BOS); khi đã hình thành đủ thì dùng nó
        const offTop = opt.kb2Official !== false && m.upOk && m.up != null && m.up > m.oBot, t1 = offTop ? m.up : m.extHi, r2 = t1 - m.oBot;
        z1 = { lo: m.oBot, top: t1 - r2 * opt.oteLo, ote: [t1 - r2 * opt.oteHi, t1 - r2 * opt.oteLo], from: m.oBotI, hiRef: t1, official: offTop };
      }
      if (rev2) {
        const offBot = opt.kb2Official !== false && m.dnOk && m.dn != null && m.dn < m.oTop, b1 = offBot ? m.dn : m.extLo, r2 = m.oTop - b1;
        z2 = { hi: m.oTop, bot: b1 + r2 * opt.oteLo, ote: [b1 + r2 * opt.oteLo, b1 + r2 * opt.oteHi], from: m.oTopI, loRef: b1, official: offBot };
      }
      // sự kiện hỗ trợ (BUY): nến quét đáy M15 hoặc chạm FVG/IMB tăng, trong vùng Fibo / đáy gần nhất của M15
      const swi = L.sw[i];
      if (z1 && k.low <= z1.top) {
        if (swi && swi.bull) sup = { i, low: k.low, why: "quét " + swi.bull.join(" + ") };
        else { const g = gapsZ.find((z) => z.bull && z.i < i && k.low <= z.hi && k.low >= z.lo - opt.tol && z.hi >= z1.lo && z.lo <= z1.top); if (g) sup = { i, low: k.low, why: `chạm ${g.imb ? "IMB" : "FVG"} ${g.lo.toFixed(2)}–${g.hi.toFixed(2)}` }; }
      }
      if (z2 && k.high >= z2.bot) {
        if (swi && swi.bear) res = { i, high: k.high, why: "quét " + swi.bear.join(" + ") };
        else { const g = gapsZ.find((z) => !z.bull && z.i < i && k.high >= z.lo && k.high <= z.hi + opt.tol && z.lo <= z2.hi && z.hi >= z2.bot); if (g) res = { i, high: k.high, why: `chạm ${g.imb ? "IMB" : "FVG"} ${g.lo.toFixed(2)}–${g.hi.toFixed(2)}` }; }
      }
      const ok = !opt.sessionOk || opt.sessionOk(k.time);
      // Mỗi CHoCH chỉ 1 lệnh KB2 (30/10, người dùng chốt)
      if (ok && opt.kb2 !== false && z1 && sup && i - sup.i <= opt.sweepWin && k.close > b.high && (opt.kb2Once === false || kb2UpT !== chUpT)) {
        let low = Infinity; for (let q = sup.i; q <= i; q++) low = Math.min(low, c[q].low);
        make({ cl: 1, kb: 2, side: "BUY", type: "market", src: "m" + sup.i, created: i, createdT: k.time, entry: k.close, sl: low - opt.slBuf, why: sup.why }, [m.oTop, m.extHi], fib(opt.oteLo), hi);
        const lo2 = orders[orders.length - 1];
        if (lo2 && lo2.kb === 2 && lo2.created === i && lo2.status !== "skip") kb2UpT = chUpT;   // lệnh bị loại (TP1 < 1R) không chiếm suất
        sup = null;
      }
      if (ok && opt.kb2 !== false && z2 && res && i - res.i <= opt.sweepWin && k.close < b.low && (opt.kb2Once === false || kb2DnT !== chDnT)) {
        let high = -Infinity; for (let q = res.i; q <= i; q++) high = Math.max(high, c[q].high);
        make({ cl: 2, kb: 2, side: "SELL", type: "market", src: "m" + res.i, created: i, createdT: k.time, entry: k.close, sl: high + opt.slBuf, why: res.why }, [m.oBot, m.extLo], fib(opt.oteHi) < k.close ? fib(opt.oteHi) : lo, lo);
        const lo3 = orders[orders.length - 1];
        if (lo3 && lo3.kb === 2 && lo3.created === i && lo3.status !== "skip") kb2DnT = chDnT;
        res = null;
      }
      fin = { h4: hk, active: true, hi, lo, fib05: fib(0.5), ote: [fib(opt.oteLo), fib(opt.oteHi)], hiI: h.oTopI, loI: null, h4Bot, h4TopAgain, rev1, rev2, z1, z2, tTop: h.tTop, tBot: h.tBot };
    }
    return { orders, fin };
  }

  // ───── phân tích đầy đủ: khung chart + H4, cả hai chiều ─────
  // opt: { oteLo, oteHi, eqTol, trendline, sweepWin, slBuf, tol, expiryH4, tfName, sessionOk(t), levels: {cw,pw,flip} }
  function analyze(c, h4c, sec, opt) {
    const res = { ms: [], events: [], sweeps: [], forms: [], liqH: [], liqL: [], tl: null, orders: [], frame: null, struct: "", plan: [] };
    if (c.length < 10 || h4c.length < 10) return res;
    const ms = structure(c), h4s = structure(h4c), L = liquidity(c, ms, opt), H = liquidity(h4c, h4s, opt);
    const cm = mirror(c), hm = mirror(h4c), msM = structure(cm), h4sM = structure(hm);
    const LM = liquidity(cm, msM, opt), HM = liquidity(hm, h4sM, opt);
    const down = setupsDown(c, ms, L, h4c, h4s, H, sec, opt);
    const up = setupsDown(cm, msM, LM, hm, h4sM, HM, sec, opt);
    const neg = (x) => (x == null ? null : -x);
    const flipO = (o) => ({ ...o, side: o.side === "BUY" ? "SELL" : "BUY", entry: -o.entry, sl: -o.sl, tp1: neg(o.tp1), tp2: neg(o.tp2), tp3: neg(o.tp3), why: o.why.replace(/(\d+\.\d+)/g, (x) => (-parseFloat(x)).toFixed(2)).replace(/-/g, "").replace(/đáy/g, "§").replace(/đỉnh/g, "đáy").replace(/§/g, "đỉnh").replace(/IMB (\d)/, "IMB $1"), up: true });
    res.orders = [...down.orders, ...up.orders.map(flipO)].sort((a, b) => a.created - b.created);
    const f = (x) => (x == null || !isFinite(x) ? "—" : x.toFixed(2));
    for (const o of res.orders) {
      const name = `CL${o.cl}-KB${o.kb}`, kind = o.cl === 1 ? (o.side === "BUY" ? "Buy hồi" : "Sell hồi") : (o.side === "SELL" ? "Sell thuận" : "Buy thuận");
      o.name = name;
      o.txt = `[SMC] ${name} ${kind} ${o.kb === 2 ? "confirm" : "risk"}${o.kb === 3 ? " (dự phòng)" : ""} · ${o.why}`;
      o.time = c[o.created].time; o.i = o.created; o.type2 = o.type;
    }
    // sự kiện cấu trúc + thanh khoản (dữ liệu thật) để vẽ
    for (let i = 1; i < c.length; i++) {
      const m = ms[i];
      if (m.nTop) res.events.push({ i: m.oTopI, kind: m.topHH ? "HH" : "LH", p: m.oTop, side: "top" });
      if (m.nBot) res.events.push({ i: m.oBotI, kind: m.botHL ? "HL" : "LL", p: m.oBot, side: "bot" });
      if (m.ev) res.events.push({ i, kind: Math.abs(m.ev) === 2 ? "CHoCH" : "BOS", dir: Math.sign(m.ev), p: m.brk, from: m.brkI });
      if (L.sw[i]) { if (L.sw[i].bear) res.sweeps.push({ i, side: "top", txt: L.sw[i].bear.join(" + ") }); if (L.sw[i].bull) res.sweeps.push({ i, side: "bot", txt: L.sw[i].bull.join(" + ") }); }
    }
    res.ms = ms; res.liqH = L.liqH; res.liqL = L.liqL; res.tl = L.tl; res.forms = formMarks(c, ms);
    // khung đang hoạt động: H4 giảm (down) hoặc H4 tăng (up, quy đổi về giá thật)
    const hk = closedIdx(h4c, sec, c[c.length - 1].time), hs = hk >= 0 ? h4s[hk] : null, m = ms[ms.length - 1];
    const T = (i) => (i == null ? null : h4c[i].time);
    if (hs && hs.trend === -1 && down.fin && down.fin.active) {
      const F = down.fin;
      res.frame = { dir: -1, hi: F.hi, lo: F.lo, fib05: F.fib05, ote: F.ote, hiT: T(F.hiI), cl1: F.h4Bot, cl2: F.h4TopAgain, rev1: F.rev1, rev2: F.rev2, z1: F.z1, z2: F.z2 };
    } else if (hs && hs.trend === 1 && up.fin && up.fin.active) {
      const F = up.fin;
      res.frame = { dir: 1, hi: -F.lo, lo: -F.hi, fib05: -F.fib05, ote: [-F.ote[1], -F.ote[0]], hiT: T(F.hiI), cl1: F.h4Bot, cl2: F.h4TopAgain, rev1: F.rev1, rev2: F.rev2,
        z1: F.z1 && { hi: -F.z1.lo, bot: -F.z1.top, ote: [-F.z1.ote[1], -F.z1.ote[0]], from: F.z1.from }, z2: F.z2 && { lo: -F.z2.hi, top: -F.z2.bot, ote: [-F.z2.ote[1], -F.z2.ote[0]], from: F.z2.from } };
    }
    const fr = res.frame;
    res.struct = `H4 ${hs ? (hs.trend === 1 ? "▲ tăng" : hs.trend === -1 ? "▼ giảm" : "—") : "—"} · ${opt.tfName} ${m.trend === 1 ? "▲" : m.trend === -1 ? "▼" : "—"}`;
    const live = res.orders.filter((o) => o.status === "pending" || o.status === "open");
    const desc = (o) => `${o.name} ${o.side} ${o.status === "pending" ? "LIMIT" : "đang chạy"} ${f(o.entry)} · SL ${f(o.sl)} · TP1 ${f(o.tp1)}${o.tpNote || ""}`;
    if (!fr) res.plan = ["Chưa đủ cấu trúc H4"];
    else if (fr.dir === -1) {
      const l1 = live.filter((o) => o.cl === 1), l2 = live.filter((o) => o.cl === 2);
      res.plan = [
        "CL1 Buy hồi: " + (l1.length ? l1.map(desc).join(" | ") : !fr.cl1 ? "chờ H4 đóng nến tạo đáy" : fr.rev1 ? `KB2 chờ hồi về ${f(fr.z1.lo)}–${f(fr.z1.top)} + quét/FVG` : `chờ nến quét H4 (KB1/KB3) hoặc ${opt.tfName} CHoCH▲ (KB2)`),
        "CL2 Sell thuận: " + (l2.length ? l2.map(desc).join(" | ") : `Premium > ${f(fr.fib05)} · OTE ${f(fr.ote[0])}–${f(fr.ote[1])} · Extreme → ${f(fr.hi)}` + (fr.cl2 ? (fr.rev2 ? ` · KB2 chờ hồi lên ${f(fr.z2.bot)}–${f(fr.z2.hi)}` : ` · H4 đã tạo đỉnh tạm, chờ ${opt.tfName} CHoCH▼`) : " · chờ H4 đóng nến tạo đỉnh tạm")),
      ];
    } else {
      const l1 = live.filter((o) => o.cl === 1), l2 = live.filter((o) => o.cl === 2);
      res.plan = [
        "CL1 Sell hồi: " + (l1.length ? l1.map(desc).join(" | ") : !fr.cl1 ? "chờ H4 đóng nến tạo đỉnh" : fr.rev1 ? `KB2 chờ hồi lên ${f(fr.z1.bot)}–${f(fr.z1.hi)} + quét/FVG` : `chờ nến quét H4 (KB1/KB3) hoặc ${opt.tfName} CHoCH▼ (KB2)`),
        "CL2 Buy thuận: " + (l2.length ? l2.map(desc).join(" | ") : `Discount < ${f(fr.fib05)} · OTE ${f(fr.ote[0])}–${f(fr.ote[1])} · Extreme → ${f(fr.lo)}` + (fr.cl2 ? (fr.rev2 ? ` · KB2 chờ hồi về ${f(fr.z2.lo)}–${f(fr.z2.top)}` : ` · H4 đã tạo đáy tạm, chờ ${opt.tfName} CHoCH▲`) : " · chờ H4 đóng nến tạo đáy tạm")),
      ];
    }
    return res;
  }

  // ───── Giờ giao dịch FXCM XAUUSD (để nến Binance 24/7 khớp nến TradingView) ─────
  // Phiên: Chủ nhật 18:00 → Thứ 6 17:00 giờ New York, nghỉ hằng ngày 17:00–18:00. Nến H4/D1 neo theo 18:00 New York.
  function nyOffset(t) { // giây, -4h (EDT) hoặc -5h (EST); DST Mỹ: CN thứ 2 tháng 3 02:00 → CN đầu tiên tháng 11 02:00
    const y = new Date(t * 1000).getUTCFullYear();
    const nthSun = (m, n) => { const d = new Date(Date.UTC(y, m, 1)); const first = (7 - d.getUTCDay()) % 7 + 1; return Date.UTC(y, m, first + 7 * (n - 1)) / 1000; };
    const start = nthSun(2, 2) + 7 * 3600, end = nthSun(10, 1) + 6 * 3600; // 02:00 EST = 07:00 UTC; 02:00 EDT = 06:00 UTC
    return t >= start && t < end ? -4 * 3600 : -5 * 3600;
  }
  function fxOpen(t) { // nến mở lúc t (giây) có nằm trong giờ FXCM mở cửa không
    const L = t + nyOffset(t), d = new Date(L * 1000), wd = d.getUTCDay(), h = d.getUTCHours();
    if (h === 17) return false;                       // nghỉ hằng ngày 17:00–18:00
    if (wd === 6) return false;                       // thứ 7
    if (wd === 5 && h >= 17) return false;            // tối thứ 6
    if (wd === 0 && h < 18) return false;             // chủ nhật trước 18:00
    return true;
  }
  const mod = (a, m) => ((a % m) + m) % m;
  const bucketOf = (t, sec) => t - mod(t + nyOffset(t) - 18 * 3600, sec); // nến H4/D1 neo 18:00 New York
  // gộp nến nhỏ (đã lọc giờ mở cửa) thành nến khung lớn theo giờ FXCM
  function aggregate(rows, sec) {
    const out = [];
    for (const k of rows) {
      const t = bucketOf(k.time, sec), last = out[out.length - 1];
      if (last && last.time === t) { last.high = Math.max(last.high, k.high); last.low = Math.min(last.low, k.low); last.close = k.close; last.vol += k.vol || 0; last.delta += k.delta || 0; }
      else out.push({ time: t, open: k.open, high: k.high, low: k.low, close: k.close, vol: k.vol || 0, delta: k.delta || 0 });
    }
    return out;
  }
  // mốc bắt đầu tính cấu trúc khung chart (giây) — CÙNG công thức với Pine: 00:00 giờ VN của (hôm nay − ceil(nBars × tf × 1.4 / 1 ngày)), không sớm hơn mốc H4
  function ltfStart(nowSec, tfSec, nBars, h4From) {
    const day = 86400, tz = 7 * 3600, d0 = Math.floor((nowSec + tz) / day) * day - tz;
    return Math.max(d0 - Math.ceil((nBars * tfSec * 1.4) / day) * day, h4From);
  }

  return { structure, liquidity, formMarks, analyze, htfAt, closedIdx, fxOpen, bucketOf, aggregate, ltfStart, nyOffset };
})();
if (typeof module !== "undefined") module.exports = SMC;
