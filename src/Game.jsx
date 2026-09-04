import React, { useEffect, useMemo, useRef, useState } from "react";
import { LineChart, Line, ResponsiveContainer, Tooltip, YAxis } from "recharts";
import {
  Activity, BarChart3, Copy, Crown, LogIn, LogOut, Megaphone, Pause, Play,
  QrCode, Radio, RotateCcw, Search, TrendingDown, TrendingUp, Trophy, Users, Zap
} from "lucide-react";
import { getClientId, read, write } from "./storage";

const COMPANIES = [
  { ticker:"ARSR", name:"Alpine ReSecure", sector:"Insurance", base:1800, vol:.008, bias:.0018, recoveryMult:1.4, tier:"blue-chip" },
  { ticker:"BRSK", name:"Bavaria Risk ReSecure", sector:"Insurance", base:1600, vol:.013, bias:-.0006, recoveryMult:.25, tier:"high-risk" },
  { ticker:"UNSA", name:"UnityShield Assurance", sector:"Insurance", base:950, vol:.011 },
  { ticker:"SGIN", name:"SummitGuard Insurance", sector:"Insurance", base:700, vol:.007 },
  { ticker:"FTSG", name:"FortiSure Insurance Group", sector:"Insurance", base:550, vol:.011, bias:-.0004, recoveryMult:.3, tier:"high-risk" },
  { ticker:"CCBK", name:"Capital Crest", sector:"Banking", base:1250, vol:.005 },
  { ticker:"GLDC", name:"Goldcrest Capital", sector:"Banking", base:2400, vol:.009, bias:.002, recoveryMult:1.5, tier:"blue-chip" },
  { ticker:"SPFN", name:"Sterling Peak Financial", sector:"Banking", base:1900, vol:.014, bias:-.0005, recoveryMult:.3, tier:"high-risk" },
  { ticker:"GHBK", name:"Global Horizon Bank", sector:"Banking", base:850, vol:.008 },
  { ticker:"VTCS", name:"Vertex Consulting Solutions", sector:"Consulting", base:1450, vol:.014, bias:.0015, recoveryMult:1.3, tier:"blue-chip" },
  { ticker:"SNXA", name:"Strategic Nexus Advisors", sector:"Consulting", base:1100, vol:.017, bias:-.0006, recoveryMult:.25, tier:"high-risk" },
  { ticker:"PRAD", name:"Pinnacle Risk Advisors", sector:"Consulting", base:900, vol:.008 }
];
const SECTORS=["Insurance","Banking","Consulting"];
const COLORS={Insurance:"#45d6c1",Banking:"#f0b84b",Consulting:"#a98cff"};
const STARTING_CASH=100000, TICK_MS=3000, POLL_MS=3000, HISTORY_LEN=40, BAND=.15, SLACK=BAND*1.05;
const MARKET_NEWS=["Broad calm across the STOCKEX floor","Steady trading, no major moves","Volumes tick up slightly market-wide","Investors watch quietly for the next headmaster update"];
const SPIKE_NEWS={
  Insurance:["shares rocket on surprise reinsurance windfall","plunges after shock catastrophe losses","soars as underwriting profits beat all forecasts","craters on a wave of unexpected claims"],
  Banking:["surges on blockbuster trading revenue","tumbles on sudden credit-quality fears","rockets after a landmark M&A win","sinks as regulators open a snap probe"],
  Consulting:["explodes higher on a mega AI contract win","sinks as a flagship client walks away","soars on a surprise government mandate","drops sharply on a stalled transformation deal"]
};
const money=n=>Math.round(n||0).toLocaleString("en-IN");
const money2=n=>Number(n||0).toLocaleString("en-IN",{minimumFractionDigits:2,maximumFractionDigits:2});
const now=()=>new Date().toLocaleTimeString("en-IN",{hour12:false});
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));

function driftStep(prev,anchor,base,vol,bias=0,recoveryMult=1){
  const inLoss=prev<base;
  const revertCoef=inLoss?.004*recoveryMult:.015;
  const mean=(anchor-prev)*revertCoef;
  const noise=prev*vol*(Math.random()*2-1);
  let next=prev+mean+prev*bias+noise;
  const maxDelta=prev*.012;
  next=prev+clamp(next-prev,-maxDelta,maxDelta);
  const dev=(next-base)/base, soft=BAND*.65;
  if(dev>soft){const o=Math.min((dev-soft)/(BAND-soft),1.4);next-=next*o*o*.09;}
  else if(dev<-soft){const o=Math.min((-dev-soft)/(BAND-soft),1.4);next+=next*o*o*.02;}
  return Math.max(Math.round(clamp(next,base*(1-SLACK),base*(1+SLACK))*100)/100,base*.4);
}
function freshState(){
  return {tick:0,paused:false,speed:1,wildSwings:false,prices:Object.fromEntries(COMPANIES.map(c=>[c.ticker,c.base])),anchors:Object.fromEntries(COMPANIES.map(c=>[c.ticker,c.base])),decay:{},history:Object.fromEntries(COMPANIES.map(c=>[c.ticker,Array.from({length:HISTORY_LEN},(_,i)=>({t:i,p:c.base}))])),news:[],controller:"",updatedAt:Date.now()};
}
function tickMarket(ms){
  const prices={...ms.prices}, anchors={...(ms.anchors||{})}, decay={...(ms.decay||{})}, history={...ms.history};
  COMPANIES.forEach(c=>{
    const d=decay[c.ticker];
    if(d?.ticksLeft>0){let next=prices[c.ticker]+(d.target-prices[c.ticker])*.4;prices[c.ticker]=Math.round(clamp(next,c.base*(1-SLACK),c.base*(1+SLACK))*100)/100;d.ticksLeft-=1;if(d.ticksLeft<=0){anchors[c.ticker]=prices[c.ticker];delete decay[c.ticker];}}
    else prices[c.ticker]=driftStep(prices[c.ticker],anchors[c.ticker]??c.base,c.base,c.vol,c.bias||0,c.recoveryMult||1);
    const a=history[c.ticker]||[];history[c.ticker]=[...a.slice(1),{t:(a.at(-1)?.t||0)+1,p:prices[c.ticker]}];
  });
  let news=ms.news||[];
  if(ms.wildSwings!==false && Math.random()<.1){
    const sectorPick=Math.random()<.4, dir=Math.random()<.5?-1:1, mag=.05+Math.random()*.2;
    if(sectorPick){
      const sector=SECTORS[Math.floor(Math.random()*SECTORS.length)];
      COMPANIES.filter(c=>c.sector===sector).forEach(c=>{prices[c.ticker]=Math.round(clamp(prices[c.ticker]*(1+dir*mag*.7),c.base*(1-SLACK),c.base*(1+SLACK))*100)/100;const a=history[c.ticker];history[c.ticker]=[...a.slice(0,-1),{...a.at(-1),p:prices[c.ticker]}];});
      const h=SPIKE_NEWS[sector][Math.floor(Math.random()*SPIKE_NEWS[sector].length)];news=[{id:`spike-${ms.tick}-${Date.now()}`,msg:`${sector.toUpperCase()} SECTOR ${h}`,tone:dir>0?"up":"down",ts:now()},...news].slice(0,30);
    }else{
      const c=COMPANIES[Math.floor(Math.random()*COMPANIES.length)];prices[c.ticker]=Math.round(clamp(prices[c.ticker]*(1+dir*mag),c.base*(1-SLACK),c.base*(1+SLACK))*100)/100;const a=history[c.ticker];history[c.ticker]=[...a.slice(0,-1),{...a.at(-1),p:prices[c.ticker]}];const h=SPIKE_NEWS[c.sector][Math.floor(Math.random()*SPIKE_NEWS[c.sector].length)];news=[{id:`spike-${ms.tick}-${Date.now()}`,msg:`${c.ticker} — ${c.name} ${h}`,tone:dir>0?"up":"down",ts:now()},...news].slice(0,30);
    }
  }
  if(ms.tick%9===0)news=[{id:`m-${ms.tick}-${Date.now()}`,msg:MARKET_NEWS[Math.floor(Math.random()*MARKET_NEWS.length)],tone:"neutral",ts:now()},...news].slice(0,30);
  return {...ms,prices,anchors,decay,history,news,tick:ms.tick+1,updatedAt:Date.now()};
}
function applyEvent(ms,scope,target,pct,headline){
  const prices={...ms.prices},anchors={...(ms.anchors||{})},decay={...(ms.decay||{})},history={...ms.history};
  COMPANIES.forEach(c=>{const hit=scope==="market"||(scope==="sector"&&c.sector===target)||(scope==="company"&&c.ticker===target);if(!hit)return;const before=prices[c.ticker];let next=clamp(before*(1+pct/100),c.base*(1-SLACK),c.base*(1+SLACK));next=Math.max(Math.round(next*100)/100,1);prices[c.ticker]=next;if(pct>0){const retain=before+(next-before)*.2;decay[c.ticker]={ticksLeft:5,target:Math.round(clamp(retain,c.base*(1-SLACK),c.base*(1+SLACK))*100)/100};}else if(pct<0){anchors[c.ticker]=next;delete decay[c.ticker];}const a=history[c.ticker];history[c.ticker]=[...a.slice(1),{t:(a.at(-1)?.t||0)+1,p:next}];});
  const label=scope==="market"?"MARKET-WIDE":scope==="sector"?`${target.toUpperCase()} SECTOR`:target;const msg=headline?.trim()?`${label}: ${headline.trim()}`:`${label}: headmaster announcement (${pct>=0?"+":""}${pct}%)`;
  return {...ms,prices,anchors,decay,history,news:[{id:`ev-${Date.now()}`,msg,tone:pct>=0?"up":"down",ts:now(),admin:true},...(ms.news||[])].slice(0,30),updatedAt:Date.now()};
}
const sharedKey=k=>read("shared",k);const sharedWrite=(k,v)=>write("shared",k,v);const privateKey=(id,k)=>read(`user:${id}`,k);const privateWrite=(id,k,v)=>write(`user:${id}`,k,v);

export default function Game(){
  const client=getClientId();
  const [role,setRole]=useState(null),[identity,setIdentity]=useState(null),[screen,setScreen]=useState("select");
  const [name,setName]=useState(""),[pass,setPass]=useState(""),[passExists,setPassExists]=useState(null),[authError,setAuthError]=useState("");
  const [market,setMarket]=useState(null),[cash,setCash]=useState(STARTING_CASH),[holdings,setHoldings]=useState({}),[costBasis,setCostBasis]=useState({}),[trades,setTrades]=useState([]);
  const [selected,setSelected]=useState("ARSR"),[qty,setQty]=useState(1),[query,setQuery]=useState(""),[sector,setSector]=useState("All");
  const [speed,setSpeed]=useState(1),[eventScope,setEventScope]=useState("market"),[eventTarget,setEventTarget]=useState("Insurance"),[eventPct,setEventPct]=useState(5),[headline,setHeadline]=useState("");
  const [notice,setNotice]=useState(""),[popup,setPopup]=useState(null),[players,setPlayers]=useState([]),[qrFailed,setQrFailed]=useState(false);
  const seen=useRef(new Set());
  const link=typeof window!=="undefined"?window.location.href:"";
  const holdingsValue=market?Object.entries(holdings).reduce((s,[t,q])=>s+q*(market.prices[t]||0),0):0;
  const portfolioValue=cash+holdingsValue,pnl=portfolioValue-STARTING_CASH,pnlPct=pnl/STARTING_CASH*100;
  const selectedCompany=COMPANIES.find(c=>c.ticker===selected)||COMPANIES[0];
  const filtered=useMemo(()=>COMPANIES.filter(c=>(sector==="All"||c.sector===sector)&&(!query||`${c.ticker} ${c.name} ${c.sector}`.toLowerCase().includes(query.toLowerCase()))),[sector,query]);
  const sectorPulse=useMemo(()=>SECTORS.map(s=>{const rows=COMPANIES.filter(c=>c.sector===s);return{s,avg:rows.reduce((a,c)=>a+((market?.prices[c.ticker]??c.base)-c.base)/c.base*100,0)/rows.length}}),[market]);
  const leaderboard=useMemo(()=>players.map(p=>({...p,value:(p.cash||0)+Object.entries(p.holdings||{}).reduce((a,[t,q])=>a+(market?.prices[t]||0)*q,0)})).sort((a,b)=>b.value-a.value).slice(0,25),[players,market]);

  useEffect(()=>{(async()=>{try{const saved=await privateKey(client,"identity");if(saved){const i=saved;setIdentity(i);setRole(i.role);setScreen("game");if(i.role==="trader"){const p=await privateKey(client,"portfolio");if(p){setCash(p.cash??STARTING_CASH);setHoldings(p.holdings??{});setCostBasis(p.costBasis??{});setTrades(p.trades??[]);}}if(i.role==="headmaster"){const s=await sharedKey("market:state");const m=s||freshState();setMarket(m);setSpeed(m.speed||1);}}}catch{}})()},[client]);
  useEffect(()=>{if(role!=="headmaster")return;let live=true;const loop=async()=>{try{const s=await sharedKey("market:state");if(!s||s.paused)return;const next=tickMarket(s);if(live){setMarket(next);await sharedWrite("market:state",next)}}catch{}};const t=setInterval(loop,TICK_MS/speed);return()=>{live=false;clearInterval(t)}},[role,speed]);
  useEffect(()=>{if(!role||role==="headmaster")return;let live=true;const load=async()=>{try{const s=await sharedKey("market:state");if(s&&live)setMarket(s)}catch{}};load();const t=setInterval(load,POLL_MS);return()=>{live=false;clearInterval(t)}},[role]);
  useEffect(()=>{if(!market?.news?.[0])return;const n=market.news[0];if(n.admin&&!seen.current.has(n.id)){seen.current.add(n.id);if(role==="trader"){setPopup(n);setTimeout(()=>setPopup(null),6000);}}},[market,role]);
  useEffect(()=>{if(!identity||role!=="trader")return;privateWrite(client,"portfolio",{cash,holdings,costBasis,trades}).catch(()=>{});privateWrite(client,"player",{name:identity.name,cash,value:portfolioValue,holdings,tradeCount:trades.length,lastSeen:Date.now()}).catch(()=>{});},[identity,role,cash,holdings,costBasis,trades,portfolioValue,client]);
  useEffect(()=>{if(!role)return;let live=true;const load=async()=>{try{const ids=await sharedKey("market:players"),rows=[];for(const id of (Array.isArray(ids)?ids:[]).slice(-100)){const p=await privateKey(id,"player");if(p)rows.push(p)}if(live)setPlayers(rows)}catch{}};load();const t=setInterval(load,5000);return()=>{live=false;clearInterval(t)}},[role]);
  useEffect(()=>{if(!identity)return;sharedKey("market:players").then(a=>{const ids=Array.isArray(a)?a:[];if(!ids.includes(client))sharedWrite("market:players",[...ids,client])}).catch(()=>{});},[identity,client]);

  const joinTrader=async()=>{const n=name.trim().slice(0,24);if(!n)return setAuthError("Enter your name.");const i={id:client,name:n,role:"trader"};setIdentity(i);setRole("trader");setScreen("game");await privateWrite(client,"identity",i);setAuthError("");};
  const openMaster=async()=>{setAuthError("");setPass("");setPassExists(null);try{const p=await sharedKey("market:adminPasscode");setPassExists(!!p)}catch{setPassExists(false)}setScreen("master")};
  const enterMaster=async()=>{const n=name.trim().slice(0,24)||"Headmaster";if(!pass.trim())return setAuthError("Enter a passcode.");const old=await sharedKey("market:adminPasscode").catch(()=>null);if(old&&old!==pass.trim())return setAuthError("Incorrect passcode.");if(!old){if(pass.trim().length<4)return setAuthError("Use at least 4 characters.");await sharedWrite("market:adminPasscode",pass.trim())}const i={id:client,name:n,role:"headmaster"};let m=await sharedKey("market:state");if(!m)m=freshState();m={...m,controller:n,speed:m.speed||1,wildSwings:m.wildSwings!==false,anchors:m.anchors||Object.fromEntries(COMPANIES.map(c=>[c.ticker,m.prices?.[c.ticker]??c.base])),decay:m.decay||{}};await sharedWrite("market:state",m);await privateWrite(client,"identity",i);setIdentity(i);setRole("headmaster");setMarket(m);setSpeed(m.speed||1);setScreen("game")};
  const leave=async()=>{await privateWrite(client,"identity",null).catch(()=>{});setIdentity(null);setRole(null);setMarket(null);setScreen("select");setName("")};
  const trade=async side=>{if(!market||market.paused)return;const q=Math.max(1,Math.floor(Number(qty)||1)),price=market.prices[selected],have=holdings[selected]||0;if(side==="BUY"){if(price*q>cash)return setNotice("Not enough virtual cash.");setCash(v=>v-price*q);setHoldings(h=>({...h,[selected]:(h[selected]||0)+q}));setCostBasis(cb=>{const nq=have+q;return{...cb,[selected]:((cb[selected]||0)*have+price*q)/nq}});setTrades(t=>[{id:Date.now(),tk:selected,side:"BUY",qty:q,price,ts:now()},...t])}else{if(q>have)return setNotice("You do not own enough shares.");setCash(v=>v+price*q);setHoldings(h=>{const n={...h,[selected]:have-q};if(!n[selected])delete n[selected];return n});setCostBasis(cb=>{if(have-q<=0){const n={...cb};delete n[selected];return n}return cb});setTrades(t=>[{id:Date.now(),tk:selected,side:"SELL",qty:q,price,ts:now()},...t])}setNotice(`${side==="BUY"?"Bought":"Sold"} ${q} ${selected}`)};
  const pause=async()=>{const s={...market,paused:!market.paused,updatedAt:Date.now()};setMarket(s);await sharedWrite("market:state",s)};
  const reset=async()=>{const s={...freshState(),controller:identity?.name||"Headmaster"};setMarket(s);setSpeed(1);await sharedWrite("market:state",s)};
  const changeSpeed=async m=>{setSpeed(m);const s={...market,speed:m,updatedAt:Date.now()};setMarket(s);await sharedWrite("market:state",s)};
  const toggleWild=async()=>{const s={...market,wildSwings:!(market.wildSwings!==false),updatedAt:Date.now()};setMarket(s);await sharedWrite("market:state",s)};
  const fireEvent=async()=>{const s=applyEvent(market,eventScope,eventScope==="market"?null:eventTarget,Number(eventPct)||0,headline);setMarket(s);await sharedWrite("market:state",s);setHeadline("");setNotice("Event broadcast to the floor.")};
  const copy=()=>navigator.clipboard?.writeText(link).then(()=>setNotice("Invite link copied."));

  if(!role)return <div className="sx-shell"><div className="sx-login"><div className="sx-mark">SX</div><div className="sx-kicker">STOCKEX / LIVE MARKET</div>{screen==="select"?<><h1>Run the floor.</h1><p className="sx-muted">A live multiplayer stock-market simulation. One Headmaster controls the market; everyone else trades the same prices.</p><button className="sx-primary" onClick={()=>setScreen("trader")}><LogIn size={16}/> Join as participant</button><button className="sx-gold" onClick={openMaster}><Crown size={16}/> Open Headmaster control room</button></>:screen==="trader"?<><h2>Join the market</h2><p className="sx-muted">Trade with ₹1,00,000 of virtual starting cash.</p><input className="sx-input" value={name} onChange={e=>{setName(e.target.value);setAuthError("")}} onKeyDown={e=>e.key==="Enter"&&joinTrader()} placeholder="Your name" autoFocus/>{authError&&<div className="sx-error">{authError}</div>}<button className="sx-primary" onClick={joinTrader}>Enter trading floor</button><button className="sx-link" onClick={()=>setScreen("select")}>← Back</button></>:<><h2><Crown size={18}/> Headmaster</h2><p className="sx-muted">{passExists===false?"Create the control-room passcode for this market.":"Enter the existing control-room passcode."}</p><input className="sx-input" value={name} onChange={e=>setName(e.target.value)} placeholder="Your name"/><input className="sx-input" value={pass} onChange={e=>{setPass(e.target.value);setAuthError("")}} onKeyDown={e=>e.key==="Enter"&&enterMaster()} placeholder={passExists===false?"Create passcode":"Passcode"} type="password"/>{authError&&<div className="sx-error">{authError}</div>}<button className="sx-gold" onClick={enterMaster}>Enter control room</button><button className="sx-link" onClick={()=>setScreen("select")}>← Back</button></>}</div></div>;
  if(!market)return <div className="sx-shell"><div className="sx-wait"><Radio size={18}/><b>Waiting for the Headmaster to open the market…</b><span>Keep this page open. The market will appear automatically.</span></div></div>;

  return <div className="sx-app"><header className="sx-top"><div className="sx-brand"><div className="sx-mark small">SX</div><div><b>STOCKEX</b><span>TRADING FLOOR</span><small>{role==="headmaster"?`CONTROL ROOM · ${identity.name}`:`TRADING AS · ${identity.name}`}</small></div></div><div className="sx-stats"><div><span>PLAYERS</span><b><Users size={13}/>{players.length}</b></div>{role==="trader"&&<><div><span>CASH</span><b>₹{money(cash)}</b></div><div><span>PORTFOLIO</span><b>₹{money(portfolioValue)}</b></div><div><span>P&L</span><b className={pnl>=0?"up":"down"}>{pnl>=0?"+":""}₹{money(pnl)}</b></div></>}<div className={market.paused?"status paused":"status"}><i/>{market.paused?"PAUSED":"LIVE"} · {market.speed||1}×</div><button className="sx-icon" onClick={leave} title="Leave"><LogOut size={14}/></button></div></header>
  <div className="sx-ticker">{(market.news||[]).slice(0,6).map(n=><span key={n.id} className={n.tone}>{n.ts} · {n.msg}</span>)}</div>
  <main className="sx-layout"><section className="sx-main"><div className="sx-pulse">{sectorPulse.map(x=><div key={x.s} className="pulse-card"><span>{x.s}</span><b className={x.avg>=0?"up":"down"}>{x.avg>=0?"+":""}{x.avg.toFixed(2)}%</b><small>vs base</small></div>)}</div><div className="sx-board-head"><div><span>MARKET BOARD</span><h1>Listed companies</h1></div><div className="sx-search"><Search size={14}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search company or ticker"/></div></div><div className="sx-filters"><button className={sector==="All"?"active":""} onClick={()=>setSector("All")}>ALL</button>{SECTORS.map(s=><button key={s} className={sector===s?"active":""} onClick={()=>setSector(s)}>{s}</button>)}</div><div className="sx-companies">{filtered.map(c=>{const price=market.prices[c.ticker],change=(price-c.base)/c.base*100,up=change>=0;return <article key={c.ticker} className={selected===c.ticker?"company selected":"company"} onClick={()=>setSelected(c.ticker)}><div className="company-id"><div><b>{c.ticker}</b>{c.tier&&<em className={c.tier}>{c.tier==="blue-chip"?"BLUE-CHIP":"HIGH-RISK"}</em>}</div><span>{c.name}</span><small>{c.sector}</small></div><div className="spark"><ResponsiveContainer width="100%" height="100%"><LineChart data={market.history[c.ticker]}><YAxis hide domain={["dataMin","dataMax"]}/><Line dataKey="p" type="monotone" stroke={up?"#3FD17F":"#FF5C5C"} strokeWidth={2} dot={false} isAnimationActive={false}/></LineChart></ResponsiveContainer></div><div className="quote"><b>₹{money2(price)}</b><span className={up?"up":"down"}>{up?"+":""}{change.toFixed(2)}%</span></div></article>})}</div></section>
  <aside className="sx-side">{role==="trader"?<div className="sx-panel order"><div className="panel-head"><span>ORDER TICKET</span><b>{selectedCompany.ticker}</b></div><div className="selected-quote"><div><b>{selectedCompany.name}</b><small>{selectedCompany.sector} · base ₹{money2(selectedCompany.base)}</small></div><strong>₹{money2(market.prices[selected])}</strong></div><div className="big-chart"><ResponsiveContainer width="100%" height="100%"><LineChart data={market.history[selected]}><YAxis hide domain={["dataMin","dataMax"]}/><Tooltip contentStyle={{background:"#0e141b",border:"1px solid #26313b",fontSize:11}} formatter={v=>[`₹${money2(v)}`,"Price"]}/><Line dataKey="p" stroke={COLORS[selectedCompany.sector]} strokeWidth={2} dot={false}/></LineChart></ResponsiveContainer></div><label>QUANTITY</label><input className="sx-input dark" type="number" min="1" value={qty} onChange={e=>setQty(Math.max(1,parseInt(e.target.value)||1))}/><div className="order-value"><span>Order value</span><b>₹{money(qty*market.prices[selected])}</b></div><div className="buy-sell"><button onClick={()=>trade("BUY")} disabled={market.paused}>BUY</button><button onClick={()=>trade("SELL")} disabled={market.paused}>SELL</button></div><div className="holding-note">You own <b>{holdings[selected]||0}</b> shares{holdings[selected]?` · avg ₹${money2(costBasis[selected])}`:""}</div></div>:<div className="sx-panel control"><div className="panel-head"><span>HEADMASTER CONTROL ROOM</span><Crown size={15}/></div><div className="control-actions"><button onClick={pause}>{market.paused?<Play size={14}/>:<Pause size={14}/>} {market.paused?"RESUME":"PAUSE"}</button><button onClick={reset}><RotateCcw size={14}/> RESET</button></div><div className="speed"><div><span>TICK SPEED</span><b>{(TICK_MS/speed/1000).toFixed(1)}s</b></div>{[.5,1,2,4].map(m=><button key={m} className={speed===m?"active":""} onClick={()=>changeSpeed(m)}>{m}×</button>)}</div><button className={market.wildSwings!==false?"wild active":"wild"} onClick={toggleWild}><Zap size={14}/> Wild swings: {market.wildSwings!==false?"ON":"OFF"}</button><div className="event-box"><div className="panel-label"><Megaphone size={13}/> MARKET EVENT</div><div className="event-row"><select value={eventScope} onChange={e=>{setEventScope(e.target.value);if(e.target.value==="sector")setEventTarget(SECTORS[0]);if(e.target.value==="company")setEventTarget(COMPANIES[0].ticker)}}><option value="market">Whole market</option><option value="sector">Sector</option><option value="company">Single company</option></select>{eventScope!=="market"&&<select value={eventTarget} onChange={e=>setEventTarget(e.target.value)}>{(eventScope==="sector"?SECTORS:COMPANIES.map(c=>c.ticker)).map(x=><option key={x}>{x}</option>)}</select>}</div><div className="event-row"><input type="number" value={eventPct} onChange={e=>setEventPct(e.target.value)}/><span>% price change</span></div><input value={headline} onChange={e=>setHeadline(e.target.value)} placeholder="Headline / announcement"/><button className="publish" onClick={fireEvent}>BROADCAST EVENT</button></div></div>}
  <div className="sx-panel leaderboard"><div className="panel-head"><span><Trophy size={14}/> LEADERBOARD</span></div>{leaderboard.length===0?<div className="empty">No traders yet.</div>:leaderboard.map((p,i)=><div className="rank" key={p.name+i}><span>#{i+1}</span><b>{p.name}</b><strong>₹{money(p.value)}</strong></div>)}</div>
  {role==="trader"&&<div className="sx-panel trade-log"><div className="panel-head"><span><Activity size={14}/> TRADE LOG</span><small>{trades.length}</small></div>{trades.slice(0,10).map(t=><div className="trade" key={t.id}><b className={t.side==="BUY"?"up":"down"}>{t.side}</b><span>{t.qty}× {t.tk} @ ₹{money2(t.price)}</span><small>{t.ts}</small></div>)}{!trades.length&&<div className="empty">Your trades will appear here.</div>}</div>}
  {role==="trader"&&<div className="sx-panel holdings-panel"><div className="panel-head"><span><BarChart3 size={14}/> YOUR HOLDINGS</span><small>{Object.values(holdings).reduce((a,v)=>a+v,0)} shares</small></div>{Object.entries(holdings).filter(([,q])=>q>0).map(([tk,q])=>{const c=COMPANIES.find(x=>x.ticker===tk),p=market.prices[tk];return <div className="holding-row" key={tk} onClick={()=>setSelected(tk)}><b>{tk}</b><span>{q} sh · avg ₹{money2(costBasis[tk])}</span><strong>₹{money(q*p)}</strong></div>})}{!Object.keys(holdings).length&&<div className="empty">No positions yet.</div>}</div>}
  {role==="headmaster"&&<div className="sx-panel invite"><div className="panel-head"><span><QrCode size={14}/> INVITE TRADERS</span></div>{!qrFailed?<img alt="Join QR code" src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(link)}`} onError={()=>setQrFailed(true)}/>:<div className="qr-fail">QR unavailable — share the link below.</div>}<div className="invite-link">{link}</div><button onClick={copy}><Copy size={13}/> COPY INVITE LINK</button></div>}</aside></main>
  {popup&&<div className="sx-overlay" onClick={()=>setPopup(null)}><div className="event-popup" onClick={e=>e.stopPropagation()}><Megaphone size={28}/><small>HEADMASTER ANNOUNCEMENT</small><h2>{popup.msg}</h2><button onClick={()=>setPopup(null)}>ACKNOWLEDGE</button></div></div>}{notice&&<button className="sx-toast" onClick={()=>setNotice("")}>{notice}</button>}</div>;
}
