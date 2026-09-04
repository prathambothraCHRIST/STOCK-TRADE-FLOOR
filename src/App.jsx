import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { LineChart, Line, ResponsiveContainer, YAxis, Tooltip } from "recharts";
import { TrendingUp, TrendingDown, Radio, Trophy, Activity, Users, Zap, LogOut, Pause, Play, Megaphone, QrCode, Copy, RotateCcw, Crown } from "lucide-react";
import { storage } from "./storage";

// ---------- Market data ----------
// bias: steady per-tick drift (+ve = tends to grind toward its ceiling, -ve = tends to grind toward its floor)
// recoveryMult: multiplies the (already slow) loss-recovery rate — <1 makes a loss even harder to climb out of, >1 makes it easier
// tier: just a display badge — "blue-chip" (more consistently profitable) / "high-risk" (hard to recover if it drops) / undefined (average)
const COMPANIES = [
  { ticker: "ARSR", name: "Alpine ReSecure", sector: "Insurance", base: 1800, vol: 0.008, bias: 0.0018, recoveryMult: 1.4, tier: "blue-chip" },
  { ticker: "BRSK", name: "Bavaria Risk ReSecure", sector: "Insurance", base: 1600, vol: 0.013, bias: -0.0006, recoveryMult: 0.25, tier: "high-risk" },
  { ticker: "UNSA", name: "UnityShield Assurance", sector: "Insurance", base: 950, vol: 0.011 },
  { ticker: "SGIN", name: "SummitGuard Insurance", sector: "Insurance", base: 700, vol: 0.007 },
  { ticker: "FTSG", name: "FortiSure Insurance Group", sector: "Insurance", base: 550, vol: 0.011, bias: -0.0004, recoveryMult: 0.3, tier: "high-risk" },
  { ticker: "CCBK", name: "Capital Crest", sector: "Banking", base: 1250, vol: 0.005 },
  { ticker: "GLDC", name: "Goldcrest Capital", sector: "Banking", base: 2400, vol: 0.009, bias: 0.002, recoveryMult: 1.5, tier: "blue-chip" },
  { ticker: "SPFN", name: "Sterling Peak Financial", sector: "Banking", base: 1900, vol: 0.014, bias: -0.0005, recoveryMult: 0.3, tier: "high-risk" },
  { ticker: "GHBK", name: "Global Horizon Bank", sector: "Banking", base: 850, vol: 0.008 },
  { ticker: "VTCS", name: "Vertex Consulting Solutions", sector: "Consulting", base: 1450, vol: 0.014, bias: 0.0015, recoveryMult: 1.3, tier: "blue-chip" },
  { ticker: "SNXA", name: "Strategic Nexus Advisors", sector: "Consulting", base: 1100, vol: 0.017, bias: -0.0006, recoveryMult: 0.25, tier: "high-risk" },
  { ticker: "PRAD", name: "Pinnacle Risk Advisors", sector: "Consulting", base: 900, vol: 0.008 },
];
const SECTOR_COLOR = { Insurance: "#4FD1C5", Banking: "#E8B34C", Consulting: "#B18CFF" };
const STARTING_CASH = 100000;
const TICK_MS = 3000;
const POLL_MS = 3500;
const HISTORY_LEN = 40;
const SECTORS = ["Insurance", "Banking", "Consulting"];
const NEWS_MARKET = ["Broad calm across the STOCKEX floor", "Steady trading, no major moves", "Volumes tick up slightly market-wide", "Investors watch quietly for the next headmaster update"];
const SPIKE_NEWS = {
  Insurance: ["shares rocket on surprise reinsurance windfall", "plunges after shock catastrophe losses", "soars as underwriting profits beat all forecasts", "craters on a wave of unexpected claims"],
  Banking: ["surges on blockbuster trading revenue", "tumbles on sudden credit-quality fears", "rockets after a landmark M&A win", "sinks as regulators open a snap probe"],
  Consulting: ["explodes higher on a mega AI contract win", "sinks as a flagship client walks away", "soars on a surprise government mandate", "drops sharply on a stalled transformation deal"],
};

const fmt = (n) => Math.round(n).toLocaleString("en-IN");
const fmt2 = (n) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nowLabel = () => new Date().toLocaleTimeString("en-IN", { hour12: false });
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

const DEVIATION_BAND = 0.15;
const BAND_SLACK = DEVIATION_BAND * 1.05;
function driftStep(prev, anchor, base, vol, bias = 0, recoveryMult = 1) {
  const inLoss = prev < base;
  const revertCoef = (inLoss ? 0.004 * recoveryMult : 0.015);
  const meanRevert = (anchor - prev) * revertCoef;
  const biasStep = prev * bias;
  const noise = prev * vol * (Math.random() * 2 - 1);
  let next = prev + meanRevert + biasStep + noise;
  const maxDelta = prev * 0.012;
  next = prev + clamp(next - prev, -maxDelta, maxDelta);
  const devPct = (next - base) / base;
  const softStart = DEVIATION_BAND * 0.65;
  if (devPct > softStart) {
    const overshoot = Math.min((devPct - softStart) / (DEVIATION_BAND - softStart), 1.4);
    next -= next * overshoot * overshoot * 0.09;
  } else if (devPct < -softStart) {
    const overshoot = Math.min((-devPct - softStart) / (DEVIATION_BAND - softStart), 1.4);
    next += next * overshoot * overshoot * 0.02;
  }
  next = clamp(next, base * (1 - BAND_SLACK), base * (1 + BAND_SLACK));
  return Math.max(Math.round(next * 100) / 100, base * 0.4);
}
function freshState() {
  const prices = Object.fromEntries(COMPANIES.map((c) => [c.ticker, c.base]));
  const anchors = Object.fromEntries(COMPANIES.map((c) => [c.ticker, c.base]));
  const historyTail = Object.fromEntries(COMPANIES.map((c) => [c.ticker, Array.from({ length: HISTORY_LEN }, (_, i) => ({ t: i, p: c.base }))]));
  return { tick: 0, paused: false, speed: 1, wildSwings: false, prices, anchors, decay: {}, historyTail, news: [], controller: "", updatedAt: Date.now() };
}
function tickMarket(ms) {
  const prices = { ...ms.prices };
  const anchors = ms.anchors || Object.fromEntries(COMPANIES.map((c) => [c.ticker, c.base]));
  const decay = { ...(ms.decay || {}) };
  const historyTail = { ...ms.historyTail };
  COMPANIES.forEach((c) => {
    const d = decay[c.ticker];
    if (d && d.ticksLeft > 0) {
      const step = (d.target - prices[c.ticker]) * 0.4;
      let next = prices[c.ticker] + step;
      next = clamp(next, c.base * (1 - BAND_SLACK), c.base * (1 + BAND_SLACK));
      prices[c.ticker] = Math.round(next * 100) / 100;
      d.ticksLeft -= 1;
      if (d.ticksLeft <= 0) { anchors[c.ticker] = prices[c.ticker]; delete decay[c.ticker]; }
    } else {
      prices[c.ticker] = driftStep(prices[c.ticker], anchors[c.ticker] ?? c.base, c.base, c.vol, c.bias || 0, c.recoveryMult || 1);
    }
    const arr = historyTail[c.ticker];
    historyTail[c.ticker] = [...arr.slice(1), { t: arr[arr.length - 1].t + 1, p: prices[c.ticker] }];
  });
  let news = ms.news;
  if (ms.wildSwings !== false && Math.random() < 0.1) {
    const sectorPick = Math.random() < 0.4;
    const dir = Math.random() < 0.5 ? -1 : 1;
    const mag = 0.05 + Math.random() * 0.2;
    if (sectorPick) {
      const sector = SECTORS[Math.floor(Math.random() * SECTORS.length)];
      COMPANIES.filter((c) => c.sector === sector).forEach((c) => {
        const jolted = clamp(prices[c.ticker] * (1 + dir * mag * 0.7), c.base * (1 - BAND_SLACK), c.base * (1 + BAND_SLACK));
        prices[c.ticker] = Math.round(jolted * 100) / 100;
        const arr = historyTail[c.ticker];
        historyTail[c.ticker] = [...arr.slice(0, -1), { ...arr[arr.length - 1], p: prices[c.ticker] }];
      });
      const headline = SPIKE_NEWS[sector][Math.floor(Math.random() * SPIKE_NEWS[sector].length)];
      news = [{ id: `spike-${ms.tick}-${Date.now()}`, msg: `${sector.toUpperCase()} SECTOR ${headline}`, tone: dir >= 0 ? "up" : "down", ts: nowLabel() }, ...news].slice(0, 30);
    } else {
      const c = COMPANIES[Math.floor(Math.random() * COMPANIES.length)];
      const jolted = clamp(prices[c.ticker] * (1 + dir * mag), c.base * (1 - BAND_SLACK), c.base * (1 + BAND_SLACK));
      prices[c.ticker] = Math.round(jolted * 100) / 100;
      const arr = historyTail[c.ticker];
      historyTail[c.ticker] = [...arr.slice(0, -1), { ...arr[arr.length - 1], p: prices[c.ticker] }];
      const headline = SPIKE_NEWS[c.sector][Math.floor(Math.random() * SPIKE_NEWS[c.sector].length)];
      news = [{ id: `spike-${ms.tick}-${Date.now()}`, msg: `${c.ticker} — ${c.name} ${headline}`, tone: dir >= 0 ? "up" : "down", ts: nowLabel() }, ...news].slice(0, 30);
    }
  }
  if (ms.tick % 9 === 0 && news === ms.news) news = [{ id: `m-${ms.tick}-${Date.now()}`, msg: NEWS_MARKET[Math.floor(Math.random() * NEWS_MARKET.length)], tone: "neutral", ts: nowLabel() }, ...news].slice(0, 30);
  return { ...ms, prices, anchors, decay, historyTail, news, tick: ms.tick + 1, updatedAt: Date.now() };
}
function applyEvent(ms, scope, target, pct, headline) {
  const prices = { ...ms.prices };
  const anchors = { ...(ms.anchors || Object.fromEntries(COMPANIES.map((c) => [c.ticker, c.base]))) };
  const decay = { ...(ms.decay || {}) };
  const historyTail = { ...ms.historyTail };
  COMPANIES.forEach((c) => {
    const hit = scope === "market" || (scope === "sector" && c.sector === target) || (scope === "company" && c.ticker === target);
    if (!hit) return;
    const before = prices[c.ticker];
    let next = before * (1 + pct / 100);
    next = clamp(next, c.base * (1 - BAND_SLACK), c.base * (1 + BAND_SLACK));
    next = Math.max(Math.round(next * 100) / 100, 1);
    prices[c.ticker] = next;
    if (pct > 0) {
      const retain = before + (next - before) * 0.2;
      const target2 = clamp(retain, c.base * (1 - BAND_SLACK), c.base * (1 + BAND_SLACK));
      decay[c.ticker] = { ticksLeft: 5, target: Math.round(target2 * 100) / 100 };
    } else if (pct < 0) {
      anchors[c.ticker] = next;
      delete decay[c.ticker];
    }
    const arr = historyTail[c.ticker];
    historyTail[c.ticker] = [...arr.slice(1), { t: arr[arr.length - 1].t + 1, p: next }];
  });
  const label = scope === "market" ? "MARKET-WIDE" : scope === "sector" ? `${target.toUpperCase()} SECTOR` : target;
  const msg = headline?.trim() ? `${label}: ${headline.trim()}` : `${label}: headmaster announcement (${pct >= 0 ? "+" : ""}${pct}%)`;
  const newsItem = { id: `ev-${Date.now()}`, msg, tone: pct >= 0 ? "up" : "down", ts: nowLabel(), admin: true };
  return { ...ms, prices, anchors, decay, historyTail, news: [newsItem, ...ms.news].slice(0, 30), updatedAt: Date.now() };
}

const btnStyle = (bg, color) => ({ background: bg, color, border: `1px solid ${color}33`, borderRadius: 6, padding: "8px 12px", fontWeight: 700, fontSize: 12, letterSpacing: 0.5, cursor: "pointer" });
function Stat({ label, value, color, bold, icon }) {
  return <div style={{ textAlign: "right" }}><div style={{ fontSize: 9.5, color: "#6B7280", textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div><div className="mono" style={{ fontSize: 13, fontWeight: bold ? 800 : 600, color: color || "#E6E9EF", display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 4 }}>{icon}{value}</div></div>;
}

function Spark({ data, up, color }) {
  return <div style={{ height: 72, width: "100%" }}><ResponsiveContainer width="100%" height="100%"><LineChart data={data}><YAxis domain={["dataMin", "dataMax"]} hide /><Tooltip contentStyle={{ background: "#10151d", border: "1px solid #293241", color: "#fff", fontSize: 10 }} formatter={(v) => [fmt2(v), "Price"]} labelFormatter={() => ""} /><Line type="monotone" dataKey="p" stroke={color || (up ? "#33D17A" : "#FF5C73")} dot={false} strokeWidth={2} /></LineChart></ResponsiveContainer></div>;
}

export default function App() {
  const [market, setMarket] = useState(freshState);
  const [portfolio, setPortfolio] = useState({ cash: STARTING_CASH, holdings: {}, name: "" });
  const [name, setName] = useState("");
  const [isMaster, setIsMaster] = useState(false);
  const [masterPass, setMasterPass] = useState("");
  const [connected, setConnected] = useState(false);
  const [selected, setSelected] = useState(COMPANIES[0].ticker);
  const [qty, setQty] = useState(1);
  const [filter, setFilter] = useState("All");
  const [tab, setTab] = useState("market");
  const [eventScope, setEventScope] = useState("market");
  const [eventTarget, setEventTarget] = useState("Insurance");
  const [eventPct, setEventPct] = useState(10);
  const [headline, setHeadline] = useState("");
  const [notice, setNotice] = useState("");
  const timer = useRef(null);
  const poll = useRef(null);

  const loadShared = useCallback(async () => {
    try {
      const r = await storage.get("market", true);
      if (r?.value) setMarket(JSON.parse(r.value));
      setConnected(true);
    } catch { setConnected(false); }
  }, []);

  useEffect(() => {
    loadShared();
    try { const saved = localStorage.getItem("stockex_portfolio"); if (saved) setPortfolio(JSON.parse(saved)); } catch {}
    poll.current = setInterval(loadShared, POLL_MS);
    return () => clearInterval(poll.current);
  }, [loadShared]);

  useEffect(() => { localStorage.setItem("stockex_portfolio", JSON.stringify(portfolio)); }, [portfolio]);

  useEffect(() => {
    if (!isMaster || market.paused) return;
    timer.current = setInterval(async () => {
      try {
        const r = await storage.get("market", true);
        const current = r?.value ? JSON.parse(r.value) : market;
        const next = tickMarket(current);
        await storage.set("market", JSON.stringify(next), true);
        setMarket(next);
      } catch {}
    }, Math.max(900, TICK_MS / (market.speed || 1)));
    return () => clearInterval(timer.current);
  }, [isMaster, market.paused, market.speed]);

  const company = COMPANIES.find(c => c.ticker === selected) || COMPANIES[0];
  const holdings = portfolio.holdings || {};
  const totalStocks = Object.values(holdings).reduce((a, b) => a + (b || 0), 0);
  const invested = Object.entries(holdings).reduce((s, [ticker, n]) => s + n * (market.prices[ticker] || 0), 0);
  const netWorth = portfolio.cash + invested;
  const pnl = netWorth - STARTING_CASH;
  const visible = filter === "All" ? COMPANIES : COMPANIES.filter(c => c.sector === filter);

  async function saveMarket(next) { await storage.set("market", JSON.stringify(next), true); setMarket(next); }
  async function startGame() {
    const next = freshState(); next.controller = name || "Headmaster";
    await saveMarket(next); setIsMaster(true); setNotice("Game started. You are the Headmaster.");
  }
  async function joinGame() {
    if (!name.trim()) return setNotice("Enter your trader name first.");
    setPortfolio(p => ({ ...p, name: name.trim() }));
    setNotice("Joined the trading floor.");
  }
  async function togglePause() {
    const next = { ...market, paused: !market.paused, updatedAt: Date.now() }; await saveMarket(next);
  }
  async function resetGame() {
    const next = freshState(); next.controller = name || "Headmaster"; await saveMarket(next); setNotice("Market reset.");
  }
  async function trade(side) {
    if (!portfolio.name && !name.trim()) return setNotice("Join with a trader name before trading.");
    const n = Math.max(1, Math.floor(Number(qty) || 0));
    const price = market.prices[company.ticker];
    const old = holdings[company.ticker] || 0;
    if (side === "buy") {
      const cost = n * price;
      if (cost > portfolio.cash) return setNotice("Not enough cash for that order.");
      setPortfolio(p => ({ ...p, name: p.name || name.trim(), cash: p.cash - cost, holdings: { ...p.holdings, [company.ticker]: old + n } }));
      setNotice(`Bought ${n} ${company.ticker} @ ₹${fmt2(price)}`);
    } else {
      if (n > old) return setNotice(`You only own ${old} ${company.ticker}.`);
      setPortfolio(p => ({ ...p, name: p.name || name.trim(), cash: p.cash + n * price, holdings: { ...p.holdings, [company.ticker]: old - n } }));
      setNotice(`Sold ${n} ${company.ticker} @ ₹${fmt2(price)}`);
    }
  }
  async function publishEvent() {
    const pct = Number(eventPct) || 0;
    if (!pct) return;
    const next = applyEvent(market, eventScope, eventScope === "market" ? "" : eventTarget, pct, headline);
    await saveMarket(next); setHeadline(""); setNotice("Event published to every player.");
  }
  async function becomeMaster() {
    if (masterPass !== "MASTER") return setNotice("Master password is MASTER for this demo.");
    setIsMaster(true); setNotice("Headmaster controls unlocked on this browser.");
  }

  return <div style={{ minHeight: "100vh", background: "#080B10", color: "#E6E9EF", fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" }}>
    <style>{`.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}.card{background:#10151d;border:1px solid #202936;border-radius:12px}.muted{color:#7f8998}.pill{border:1px solid #2a3340;border-radius:999px;padding:4px 8px;font-size:10px}.click{cursor:pointer}.click:hover{border-color:#4a5a70!important;transform:translateY(-1px)}button:disabled{opacity:.45;cursor:not-allowed}.scroll{scrollbar-width:thin;scrollbar-color:#2b3542 transparent}`}</style>
    <header style={{ height: 64, borderBottom: "1px solid #202936", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 22px", background: "#0B0F15", position: "sticky", top: 0, zIndex: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}><div style={{ width: 34, height: 34, borderRadius: 9, background: "#151D28", display: "grid", placeItems: "center", color: "#58A6FF", fontWeight: 900 }}>S</div><div><div style={{ fontWeight: 900, letterSpacing: 1.2 }}>STOCKEX <span style={{ color: "#596577", fontWeight: 600 }}>TRADING FLOOR</span></div><div className="muted" style={{ fontSize: 10 }}>MULTIPLAYER MARKET SIMULATION</div></div></div>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}><div style={{ fontSize: 11, color: connected ? "#33D17A" : "#FFB454" }}><span style={{ display: "inline-block", width: 7, height: 7, borderRadius: "50%", background: "currentColor", marginRight: 6 }} />{connected ? "LIVE / SUPABASE" : "CONNECTING"}</div><Stat label="Cash" value={`₹${fmt(portfolio.cash)}`} /><Stat label="Stocks" value={totalStocks} /><Stat label="Net worth" value={`₹${fmt(netWorth)}`} color={pnl >= 0 ? "#33D17A" : "#FF5C73"} bold /></div>
    </header>

    <main style={{ maxWidth: 1500, margin: "0 auto", padding: 18 }}>
      <div className="card" style={{ padding: 14, marginBottom: 14, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Trader name" style={{ background: "#0B0F15", color: "#fff", border: "1px solid #293241", borderRadius: 7, padding: "9px 11px", outline: "none" }} />
        <button onClick={joinGame} style={btnStyle("#16202d", "#7DC1FF")}>JOIN FLOOR</button>
        <span className="muted" style={{ fontSize: 11 }}>Game: {market.controller || "waiting for Headmaster"}</span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 7, alignItems: "center" }}><input type="password" value={masterPass} onChange={e => setMasterPass(e.target.value)} placeholder="Master key" style={{ width: 105, background: "#0B0F15", color: "#fff", border: "1px solid #293241", borderRadius: 7, padding: "8px 10px" }} /><button onClick={becomeMaster} style={btnStyle("#1B1710", "#E8B34C")}><Crown size={13} /> MASTER</button></div>
      </div>

      {isMaster && <section className="card" style={{ padding: 14, marginBottom: 14, borderColor: "#6c531e" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}><Crown size={16} color="#E8B34C" /><b>HEADMASTER CONTROL ROOM</b><span className="pill" style={{ color: "#E8B34C" }}>YOU CONTROL THE MARKET</span></div>
        <div style={{ display: "grid", gridTemplateColumns: "auto auto auto 1fr auto auto", gap: 8, alignItems: "center" }}>
          <button onClick={togglePause} style={btnStyle("#17202B", "#fff")}>{market.paused ? <Play size={14} /> : <Pause size={14} />} {market.paused ? "RESUME" : "PAUSE"}</button>
          <button onClick={resetGame} style={btnStyle("#1B1315", "#FF8796")}><RotateCcw size={14}/> RESET</button>
          <label className="muted" style={{ fontSize: 11 }}>Speed <select value={market.speed || 1} onChange={e => saveMarket({ ...market, speed: Number(e.target.value) })} style={{ marginLeft: 5, background: "#0B0F15", color: "#fff", border: "1px solid #293241", padding: 7, borderRadius: 6 }}><option value="0.5">0.5× slow</option><option value="1">1×</option><option value="1.5">1.5×</option><option value="2">2×</option></select></label>
          <div />
          <label className="muted" style={{ fontSize: 11 }}>Event <select value={eventScope} onChange={e => setEventScope(e.target.value)} style={{ background: "#0B0F15", color: "#fff", border: "1px solid #293241", padding: 7, borderRadius: 6 }}><option value="market">Market</option><option value="sector">Sector</option><option value="company">Company</option></select></label>
          <label className="muted" style={{ fontSize: 11 }}>{eventScope !== "market" && <select value={eventTarget} onChange={e => setEventTarget(e.target.value)} style={{ background: "#0B0F15", color: "#fff", border: "1px solid #293241", padding: 7, borderRadius: 6, marginRight: 5 }}>{(eventScope === "sector" ? SECTORS : COMPANIES.map(c => c.ticker)).map(x => <option key={x}>{x}</option>)}</select>}<input type="number" value={eventPct} onChange={e => setEventPct(e.target.value)} style={{ width: 62, background: "#0B0F15", color: "#fff", border: "1px solid #293241", padding: 7, borderRadius: 6 }} />%</label>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 9 }}><input value={headline} onChange={e => setHeadline(e.target.value)} placeholder="Write your random event / headline…" style={{ flex: 1, background: "#0B0F15", color: "#fff", border: "1px solid #293241", borderRadius: 7, padding: "9px 11px" }} /><button onClick={publishEvent} style={btnStyle("#39280C", "#E8B34C")}><Megaphone size={14}/> PUBLISH EVENT</button></div>
      </section>}

      {notice && <div style={{ marginBottom: 12, padding: "9px 12px", borderRadius: 7, background: "#111b26", border: "1px solid #24374c", color: "#9CCBFF", fontSize: 12 }}>{notice}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.5fr) minmax(330px, .8fr)", gap: 14 }}>
        <section>
          <div className="card" style={{ padding: 14, marginBottom: 14 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}><div><b>LIVE MARKET</b><div className="muted" style={{ fontSize: 10, marginTop: 3 }}>Every player sees the same prices • Tick #{market.tick}</div></div><div style={{ display: "flex", gap: 6 }}>{["All", ...SECTORS].map(x => <button key={x} onClick={() => setFilter(x)} style={{ ...btnStyle(filter === x ? "#182535" : "transparent", filter === x ? "#7DC1FF" : "#687386"), padding: "6px 9px" }}>{x}</button>)}</div></div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 9 }}>
              {visible.map(c => { const p = market.prices[c.ticker] || c.base; const h = market.historyTail?.[c.ticker] || []; const prev = h.length > 1 ? h[h.length - 2].p : c.base; const up = p >= prev; const owned = holdings[c.ticker] || 0; return <div key={c.ticker} className="card click" onClick={() => setSelected(c.ticker)} style={{ padding: 11, borderColor: selected === c.ticker ? SECTOR_COLOR[c.sector] : "#202936" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start" }}><div><b className="mono">{c.ticker}</b><div style={{ fontSize: 10, color: "#8d97a6", marginTop: 2 }}>{c.name}</div></div><span className="pill" style={{ color: SECTOR_COLOR[c.sector], borderColor: `${SECTOR_COLOR[c.sector]}44` }}>{c.sector}</span></div>
                <Spark data={h} up={up} color={SECTOR_COLOR[c.sector]} />
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "end" }}><div><div className="mono" style={{ fontSize: 16, fontWeight: 800 }}>₹{fmt2(p)}</div><div style={{ color: up ? "#33D17A" : "#FF5C73", fontSize: 10 }}>{up ? "▲" : "▼"} live</div></div><div style={{ textAlign: "right" }}><div className="muted" style={{ fontSize: 9 }}>YOUR HOLDING</div><div className="mono" style={{ fontWeight: 800 }}>{owned}</div></div></div>
              </div> })}
            </div>
          </div>

          <div className="card" style={{ padding: 14 }}><div style={{ display: "flex", gap: 8, marginBottom: 12 }}><button onClick={() => setTab("market")} style={btnStyle(tab === "market" ? "#182535" : "transparent", tab === "market" ? "#7DC1FF" : "#6B7280")}>COMPANY DIRECTORY</button><button onClick={() => setTab("portfolio")} style={btnStyle(tab === "portfolio" ? "#182535" : "transparent", tab === "portfolio" ? "#7DC1FF" : "#6B7280")}>MY PORTFOLIO</button></div>
            {tab === "market" ? <div style={{ overflowX: "auto" }}><table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}><thead><tr style={{ color: "#697486", textAlign: "left" }}>{["COMPANY","SECTOR","PRICE","YOUR STOCKS","BASE","RANGE","PROFILE"].map(x => <th key={x} style={{ padding: "7px 8px", borderBottom: "1px solid #202936" }}>{x}</th>)}</tr></thead><tbody>{COMPANIES.map(c => <tr key={c.ticker} onClick={() => setSelected(c.ticker)} className="click"><td style={{ padding: "9px 8px" }}><b className="mono">{c.ticker}</b><div className="muted">{c.name}</div></td><td style={{ color: SECTOR_COLOR[c.sector] }}>{c.sector}</td><td className="mono">₹{fmt2(market.prices[c.ticker])}</td><td className="mono">{holdings[c.ticker] || 0}</td><td className="mono">₹{fmt(c.base)}</td><td className="mono">±15%</td><td>{c.tier === "blue-chip" ? "Blue-chip" : c.tier === "high-risk" ? "High-risk" : "Balanced"}</td></tr>)}</tbody></table></div> : <div>{COMPANIES.filter(c => holdings[c.ticker] > 0).map(c => <div key={c.ticker} style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid #1d2530" }}><div><b className="mono">{c.ticker}</b><div className="muted">{c.name}</div></div><div className="mono">{holdings[c.ticker]} shares</div><div className="mono">₹{fmt(holdings[c.ticker] * market.prices[c.ticker])}</div></div>)}{totalStocks === 0 && <div className="muted" style={{ padding: 20, textAlign: "center" }}>No holdings yet. Select a company and place a trade.</div>}</div>}</div>
        </section>

        <aside style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="card" style={{ padding: 14 }}><div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><div><div className="muted" style={{ fontSize: 9, letterSpacing: 1 }}>SELECTED COMPANY</div><h2 style={{ margin: "4px 0 2px", fontSize: 22 }}>{company.ticker}</h2><div className="muted">{company.name}</div></div><span className="pill" style={{ color: SECTOR_COLOR[company.sector] }}>{company.sector}</span></div><div style={{ marginTop: 12, fontSize: 28, fontWeight: 900 }} className="mono">₹{fmt2(market.prices[company.ticker])}</div><Spark data={market.historyTail?.[company.ticker] || []} up={true} color={SECTOR_COLOR[company.sector]} /><div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }}><div style={{ background: "#0B0F15", borderRadius: 8, padding: 10 }}><div className="muted" style={{ fontSize: 9 }}>YOU OWN</div><b className="mono">{holdings[company.ticker] || 0}</b></div><div style={{ background: "#0B0F15", borderRadius: 8, padding: 10 }}><div className="muted" style={{ fontSize: 9 }}>POSITION VALUE</div><b className="mono">₹{fmt((holdings[company.ticker] || 0) * market.prices[company.ticker])}</b></div></div></div>

          <div className="card" style={{ padding: 14 }}><div style={{ fontWeight: 800, marginBottom: 10 }}>ORDER TICKET</div><div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, alignItems: "end" }}><label className="muted" style={{ fontSize: 10 }}>QUANTITY<input type="number" min="1" value={qty} onChange={e => setQty(e.target.value)} style={{ display: "block", width: "100%", boxSizing: "border-box", marginTop: 4, background: "#0B0F15", color: "#fff", border: "1px solid #293241", borderRadius: 7, padding: 9 }} /></label><div className="muted" style={{ fontSize: 10 }}>EST. VALUE<div className="mono" style={{ color: "#fff", fontSize: 14, marginTop: 6 }}>₹{fmt(Number(qty || 0) * market.prices[company.ticker])}</div></div></div><div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 10 }}><button onClick={() => trade("buy")} style={btnStyle("#123522", "#33D17A")}>BUY {company.ticker}</button><button onClick={() => trade("sell")} style={btnStyle("#35151c", "#FF5C73")}>SELL {company.ticker}</button></div></div>

          <div className="card" style={{ padding: 14, flex: 1, minHeight: 250 }}><div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}><b>MARKET NEWS</b><Radio size={15} color="#FF5C73" /></div><div className="scroll" style={{ maxHeight: 300, overflowY: "auto" }}>{(market.news || []).map(n => <div key={n.id} style={{ padding: "9px 0", borderBottom: "1px solid #1d2530" }}><div style={{ color: n.tone === "up" ? "#33D17A" : n.tone === "down" ? "#FF5C73" : "#AAB2BF", fontSize: 11, lineHeight: 1.4 }}>{n.admin && <Megaphone size={11} style={{ marginRight: 5 }} />}{n.msg}</div><div className="muted mono" style={{ fontSize: 8, marginTop: 4 }}>{n.ts}</div></div>)}{(!market.news || market.news.length === 0) && <div className="muted" style={{ textAlign: "center", padding: 25 }}>Waiting for market activity…</div>}</div></div>
        </aside>
      </div>

      <footer style={{ padding: "18px 4px", color: "#566172", fontSize: 10, display: "flex", justifyContent: "space-between" }}><span>STOCKEX • Educational trading simulation • No real-money trading</span><span>Multiplayer state: Supabase</span></footer>
    </main>
  </div>;
}
