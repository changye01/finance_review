/* 独立详情页：?sid=xxx → meta 定位 → 分片取序列 → Chart 绘制
   翻页走 History API 局部更新（复用 chart 实例与已载分片），不再整页重载 */
import {fmt,cls,sgn,fetchJSON,fetchShard} from './util.js';
import {Chart} from './chart.js';
import {orderedList} from './list.js';

const NOTE_DAILY='不复权日线 · 上K线／下成交量（百万股）· 成交额为湖内精确值（amount 元）';
const NOTE_MONTH='前复权月线 · 上K线／下成交额（亿元）· 开＝月首日／收＝月末日';
const ZOOM_HINT='　·　左右拖动平移、滚轮/双指捏合缩放（范围越小K线越大），双指捏合缩放 K 线；rps-review 同款交互 · 点均线开关切换 MA5/10/20/60/120/250 · ←/→ 键翻上/下一个标的';

const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const parseCtx=q=>({view:q.get('v')||'pool',layer:q.get('l')||'__all',
                    probeFilter:q.get('f')||'all',sortKey:q.get('sk')||null,
                    sortDir:q.get('sd')==='-1'?-1:1,query:q.get('q')||''});

/* 🔴 iOS 整页禁缩放（2026-11-24）：touch-action 与容器级 gesture 都拦不住
   Safari 的双指缩放，必须在 document 上无条件阻止。K 线缩放由 light charts
   的 handleScale.pinch 处理，不依赖浏览器手势。 */
['gesturestart','gesturechange','gestureend'].forEach(t=>
  document.addEventListener(t,e=>e.preventDefault(),{passive:false}));

const qs=new URLSearchParams(location.search);
let sid=qs.get('sid')||'';
let listCtx=parseCtx(qs);
let M=null,chart=null,detailObj=null,mode='daily',prevSid=null,nextSid=null,loadSeq=0;
let TL=null,tlLoading=null,curX=null; // 信号时间轴：sid → [{snap,state,band,dist,max_gain}]
const memShards={};

/* 信号时间轴：只渲染当前 sid 在各快照日的 state/band 迁移，状态首次变化高亮 */
function tlStateCls(s){return s&&String(s).indexOf('A')===0?'a':'b';}
function renderTimeline(x){
  const box=document.getElementById('dTimeline');
  if(!box)return;
  if(!x||!x.date){box.innerHTML='';return;} // 主池 A/B/C 无探针时间轴（历史分层无快照，不编造）
  // 时间轴已并进分片（obj.tl），不再单独下载 signal_timeline.json（462 KB）
  const src=(detailObj&&detailObj.tl)||(TL&&TL[sid])||null;
  if(!src){box.innerHTML='<div class="tl-box"><div class="tl-sub">状态时间轴载入中…</div></div>';return;}
  const rows=src;
  if(!rows.length){box.innerHTML='';return;}
  let firstA=-1;
  rows.forEach((r,i)=>{if(firstA<0&&String(r.state||'').indexOf('A')===0)firstA=i;});
  let h='<div class="tl-box"><div class="tl-h">标的状态时间轴 · T+5 验证轨迹</div>';
  h+=`<div class="tl-sub">信号日 ${esc(x.date)} · 跨 ${rows.length} 个复盘快照；状态来自每日真实探针产物，非插值。🔴＝转「A 已验」节点。</div><div class="tl-line">`;
  rows.forEach((r,i)=>{
    const isA=String(r.state||'').indexOf('A')===0;
    const chg=(i===firstA&&firstA>0);
    h+=`<div class="tl-node${chg?' chg':''}"><div class="tl-top"><span class="tl-day">${esc(r.snap)}</span>`;
    h+=`<span class="tl-st ${tlStateCls(r.state)}">${esc(r.state||'—')}</span>`;
    if(chg)h+='<span class="tl-arrow">▲ 转正</span>';
    h+='</div>';
    const bits=[];
    if(r.dist!=null)bits.push(`距今 ${r.dist} 日`);
    if(r.max_gain!=null)bits.push(`最大浮盈 ${fmt(r.max_gain,1)}%`);
    if(r.band)bits.push(esc(r.band));
    if(bits.length)h+=`<div class="tl-detail">${bits.join(' · ')}</div>`;
    h+='</div>';
  });
  h+='</div></div>';
  box.innerHTML=h;
}
/* 已弃用：时间轴改从分片 obj.tl 读（2026-11-24）。仅作兜底，当前无调用点。 */
function loadTimeline(){
  if(TL){renderTimeline(curX);return;}
  if(!tlLoading)tlLoading=fetchJSON('./signal_timeline.json',d=>!!(d&&typeof d==='object'))
    .then(d=>{TL=d;renderTimeline(curX);return d;}).catch(()=>{});
  return tlLoading;
}

function findStock(){
  let rows=orderedList(M,listCtx);
  let i=rows.findIndex(x=>(x.sid||x.code)===sid);
  if(i<0){ // 上下文与标的不符（如直接改 URL）：回退到全集顺序翻页
    rows=(M.stocks||[]).concat(M.four||[],M.probe||[]);
    i=rows.findIndex(x=>(x.sid||x.code)===sid);
    if(i<0)return null;
  }
  prevSid=i>0?(rows[i-1].sid||rows[i-1].code):null;
  nextSid=i<rows.length-1?(rows[i+1].sid||rows[i+1].code):null;
  document.getElementById('dPos').textContent=`${i+1} / ${rows.length}`;
  updateNav();
  return rows[i];
}
function updateNav(){
  const p=document.getElementById('dPrev'),n=document.getElementById('dNext');
  p.disabled=!prevSid;n.disabled=!nextSid;
}
function buildURL(target){
  const q=new URLSearchParams({sid:target,v:listCtx.view,l:listCtx.layer,
    f:listCtx.probeFilter,sk:listCtx.sortKey||'',sd:String(listCtx.sortDir)});
  if(listCtx.query)q.set('q',listCtx.query);
  const sc=qs.get('sharecode');if(sc)q.set('sharecode',sc);
  return './detail.html?'+q.toString();
}
function goSid(target,push=true){
  if(!target||target===sid)return;
  sid=target;
  if(push)history.pushState({sid},'',buildURL(target));
  refresh();
}
function refresh(){
  const x=findStock();
  if(!x){document.getElementById('dName').textContent='未找到标的 '+sid;return;}
  curX=x;
  renderHead(x);renderTimeline(x);loadData();
  window.scrollTo(0,0);
}
function bindNav(){
  document.getElementById('dPrev').addEventListener('click',()=>goSid(prevSid));
  document.getElementById('dNext').addEventListener('click',()=>goSid(nextSid));
  window.addEventListener('keydown',e=>{
    if(e.target&&/INPUT|TEXTAREA/.test(e.target.tagName))return;
    if(e.key==='ArrowLeft'&&prevSid)goSid(prevSid);
    if(e.key==='ArrowRight'&&nextSid)goSid(nextSid);
  });
  window.addEventListener('popstate',()=>{
    const q=new URLSearchParams(location.search);
    sid=q.get('sid')||'';
    listCtx=parseCtx(q);
    refresh();
  });
}
function renderHead(x){
  const isP=!!x.date,isF=!!x.miss,ind=x.ind||{};
  document.title=`${x.name} · 量化看板`;
  document.getElementById('dName').innerHTML=`${esc(x.name)}<span class="code">${esc(x.code)}</span>`;
  let meta;
  if(isP){
    meta=`t_45 探针 · 信号日 ${esc(x.date||'—')} · 距今 ${x.dist==null?'—':x.dist} 日 · 涨幅 <span class="${cls(x.chg)}">${sgn(x.chg)}%</span> · 放大 ${fmt(x.mult,1)}× · 换手 ${fmt(x.turn,1)}%<br>${esc(x.band||'')} · ${esc(x.state||'')}`;
  }else if(isF){
    meta=`4 分速览 · 缺 ${esc(x.miss)} · 窗口涨幅 <span class="${cls(x.win_gain)}">${sgn(x.win_gain)}%</span> · 放大 ${fmt(x.mult,1)}× · 周转 ${fmt(x.rounds,2)} 次 · 振幅 ${fmt(x.amp_mult,2)}×<br>日均换手 ${fmt(x.turn,1)}% · 最大回撤 ${sgn(x.drawdown)}% · 主升 ${esc(x.seg||'—')}${x.fresh?' · 🆕首达 4 分':''}`;
  }else{
    meta=`${esc(x.layer||'')} · 涨跌 <span class="${cls(x.chg)}">${sgn(x.chg)}%</span> · 换手 ${fmt(x.turn,1)}% · ÷阈值 ${fmt(x.thr,1)}× · 距高 ${sgn(x.dist_high)}% · 回撤 ${sgn(x.drawdown)}% · 额 ${fmt(x.amt)}亿`+(x.concept?`<br>${esc(x.concept)}`:'');
  }
  document.getElementById('dMeta').innerHTML=meta;
  const kp=document.getElementById('dKpis');
  if(!isP&&ind&&ind.close!=null){
    kp.innerHTML=`<div class="kpis">${[['现价',fmt(ind.close,2),''],['距250日高',sgn(ind.dist),cls(-ind.dist)],['压缩度',fmt(ind.comp,2),''],['启动度',fmt(ind.start,2),''],['吸筹比',fmt(ind.absorb,2),''],['综合分',fmt(ind.score,1),'']].map(a=>`<div class="kpi"><div class="lab">${a[0]}</div><div class="val ${a[2]}">${a[1]}</div></div>`).join('')}</div>`;
  }else kp.innerHTML='';
  // 研判文本：拆页时丢失、这里恢复（action/shape/胜率收益/轮数/段位）
  const dd=document.getElementById('dDesc');
  if(isP){
    dd.innerHTML=`<div class="dd-row"><b>探针口径</b><span>t_45 启动探针 · 45 日窗 · 严格 T+5；命中仅代表「从静默转放量」形态，证据弱于五条打分，不构成可买判断。${esc(x.state||'')} ${esc(x.band||'')}</span></div>`;
  }else if(isF){
    const NM={'①':'成交额放大 <6×','②':'筹码周转 <3 次','③':'振幅 <1.7×','④':'主升段不在第 1/2 段','⑤':'上影≥下影不成立'};
    let ph=`<div class="dd-row"><b>4 分口径</b><span>五条打分过四条，缺 ${esc(x.miss)}＝${esc(NM[x.miss]||'待核')}。4 分不分层、不进 A/B/C 池、不与 5 分合并计数；首达 4 分≠首达 5 分，不按 5 分首达的收益结论外推。</span></div>`;
    if(x.probeHit){
      const sg=(x.probeSignals||[]).map(q=>`${q.date||'—'} ${q.state||''}${q.band?' '+q.band:''}`).join('；');
      ph+=`<div class="dd-row"><b>∩探针重合</b><span>该票同时在 t_45 探针 T 表（${(x.probeSignals||[]).length} 条信号：${esc(sg)}）。⚠️ 两者共用同一根启动 K 线，是同源标注，不是两个独立证据的互相确认；探针状态与 4 分打分各按自身口径判，不合并计数。</span></div>`;
    }else{
      ph+=`<div class="dd-row"><b>探针</b><span>未进 t_45 探针 T 表。原因按各自口径：可能是启动价 ≥40 被 PIT 剔除，或 45 日窗内无「放大 ≥3× 且涨幅 ≥3%」的同日信号——不等于资金质量差或数据缺失。</span></div>`;
    }
    dd.innerHTML=ph
      +`<div class="dd-nums"><span>窗口涨幅 <b>${fmt(x.win_gain,1)}%</b></span><span>周转 <b>${fmt(x.rounds,2)} 次</b></span><span>放大 <b>${fmt(x.mult,1)}×</b></span><span>振幅 <b>${fmt(x.amp_mult,2)}×</b></span><span>上-下影 <b>${fmt(x.up_sh,2)}</b></span></div>`;
  }else{
    const rows=[];
    if(x.action)rows.push(`<div class="dd-row"><b>操作建议</b><span>${esc(x.action)}</span></div>`);
    if(x.shape)rows.push(`<div class="dd-row"><b>形态归档</b><span>${esc(x.shape)}</span></div>`);
    const nums=[];
    if(x.win_gain!=null)nums.push(`<span>胜率收益 <b>${fmt(x.win_gain,1)}%</b></span>`);
    if(x.rounds!=null)nums.push(`<span>轮数 <b>${fmt(x.rounds,2)}</b></span>`);
    if(x.seg)nums.push(`<span>段位 <b>${esc(x.seg)}</b></span>`);
    if(nums.length)rows.push(`<div class="dd-nums">${nums.join('')}</div>`);
    dd.innerHTML=rows.join('');
  }
}
async function loadData(){
  const seq=++loadSeq,box=document.getElementById('chartbox');
  try{
    // 一票一文件（2026-11-24）：详情页只取自己那只，不再下载整片
    let all=memShards[sid];
    if(!all){
      all=await fetchShard('./series/'+sid+'.json',M.generated_at,d=>!!(d&&d[sid]));
      memShards[sid]=all;
    }
    if(seq!==loadSeq)return; // 快速连按翻页时丢弃过期请求
    const obj=all[sid];if(!obj)throw new Error('序列缺失 '+sid);
    detailObj=obj;
    if(!chart)chart=new Chart(box,document.getElementById('zoomCtl'),document.getElementById('maLegend'));
    chart.setData(obj,mode);
    drawMinute(obj);
    if(curX&&curX.date)renderTimeline(curX);   // 分片到手后再画时间轴
    document.getElementById('detailNote').textContent=(mode==='daily'?NOTE_DAILY:NOTE_MONTH)+ZOOM_HINT;
  }catch(e){if(seq===loadSeq)box.innerHTML='<div class="loading">图表数据载入失败：'+esc(e.message)+'</div>';}
}
document.getElementById('dBack').addEventListener('click',()=>{
  if(window.history.length>1)window.close();
  location.href='./index.html';
});
document.querySelectorAll('.switch button').forEach(b=>b.addEventListener('click',()=>{
  document.querySelectorAll('.switch button').forEach(z=>z.classList.remove('on'));b.classList.add('on');
  mode=b.dataset.m;
  if(detailObj)chart.setData(detailObj,mode);
  document.getElementById('detailNote').textContent=(mode==='daily'?NOTE_DAILY:NOTE_MONTH)+ZOOM_HINT;
}));
fetchJSON('./meta.json',d=>!!(d&&d.stocks&&d.shards)).then(d=>{
  M=d;
  const x=findStock();
  if(!x){document.getElementById('dName').textContent='未找到标的 '+sid;return;}
  curX=x;
  renderHead(x);renderTimeline(x);bindNav();loadData();
  // 时间轴已并进分片（obj.tl），此处不再拉 signal_timeline.json（462 KB）
}).catch(e=>{document.getElementById('dName').textContent='数据载入失败：'+e.message;});

/* ── 当日分时（canvas，2026-11-24 新增）────────────────────────────
   数据来自 qm_webgen.py 的 load_minute()（东财 trends2，1 分钟）；
   校验过 times[0] 的日期 == asof，错日不画。 */
function drawMinute(obj){
  const cv=document.getElementById('mnCanvas'), hint=document.getElementById('mnHint');
  if(!cv) return;
  const mi=obj&&obj.minute;
  if(!mi||!mi.times||!mi.times.length){
    if(hint)hint.textContent='无当日分时数据';
    cv.style.height='0'; return;
  }
  const cs=getComputedStyle(document.body);
  const V=k=>((cs.getPropertyValue(k)||'').trim());
  const ink=V('--ink3')||'#8b9bb4', line=V('--line')||'#232c3d';
  const UP='#f5222d', DOWN='#52c41a', AVG='#e8a33d';
  const W=cv.clientWidth||900, H=window.innerWidth<=560?300:340;
  const dpr=window.devicePixelRatio||1;
  cv.width=Math.round(W*dpr); cv.height=Math.round(H*dpr); cv.style.height=H+'px';
  const g=cv.getContext('2d'); g.setTransform(dpr,0,0,dpr,0,0); g.clearRect(0,0,W,H);
  const padL=6,padR=58,padT=12,gap=16,subH=64,axisH=20;
  const mainH=Math.max(60,H-padT-subH-gap-axisH);
  const n=mi.times.length, pre=mi.pre_close||null;
  let lo=Infinity,hi=-Infinity;
  for(const v of mi.price){ if(v<lo)lo=v; if(v>hi)hi=v; }
  for(const v of mi.avg){ if(v!=null){ if(v<lo)lo=v; if(v>hi)hi=v; } }
  if(pre){ lo=Math.min(lo,pre); hi=Math.max(hi,pre); }
  if(!isFinite(lo)||!isFinite(hi)){ if(hint)hint.textContent='分时数据异常'; return; }
  const pad=(hi-lo)*0.1||0.05; lo-=pad; hi+=pad;
  const X=i=>padL+(W-padL-padR)*(n<=1?0:i/(n-1));
  const Y=v=>padT+mainH*(1-(v-lo)/(hi-lo));
  g.strokeStyle=line; g.lineWidth=1;
  for(let k=0;k<=4;k++){ const yy=padT+mainH*k/4; g.beginPath(); g.moveTo(padL,yy); g.lineTo(W-padR,yy); g.stroke(); }
  if(pre){ g.save(); g.setLineDash([4,4]); g.strokeStyle='#5a6b8c';
           const yy=Y(pre); g.beginPath(); g.moveTo(padL,yy); g.lineTo(W-padR,yy); g.stroke(); g.restore(); }
  const last=mi.price[n-1], up=pre?last>=pre:true;
  g.strokeStyle=up?UP:DOWN; g.lineWidth=1.4; g.beginPath();
  mi.price.forEach((v,i)=>{ i?g.lineTo(X(i),Y(v)):g.moveTo(X(i),Y(v)); }); g.stroke();
  g.strokeStyle=AVG; g.lineWidth=1; g.beginPath(); let started=false;
  mi.avg.forEach((v,i)=>{ if(v==null)return; started?g.lineTo(X(i),Y(v)):g.moveTo(X(i),Y(v)); started=true; }); g.stroke();
  const vTop=padT+mainH+gap;
  let vmax=0; for(const v of mi.vol) if(v>vmax)vmax=v;
  const bw=Math.max(1,(W-padL-padR)/n-0.6);
  if(vmax>0) for(let i=0;i<n;i++){
    const h=subH*(mi.vol[i]/vmax);
    g.fillStyle=(i?(mi.price[i]>=mi.price[i-1]):up)?'rgba(245,34,45,.55)':'rgba(82,196,26,.55)';
    g.fillRect(X(i)-bw/2,vTop+subH-h,bw,h);
  }
  g.fillStyle=ink; g.font='11px ui-monospace,Menlo,monospace'; g.textAlign='left';
  for(let k=0;k<=4;k++){ const v=hi-(hi-lo)*k/4; g.fillText(v.toFixed(2),W-padR+6,padT+mainH*k/4+4); }
  g.textAlign='center';
  ['09:30','10:30','11:30','14:00','15:00'].forEach((m,idx)=>{
    let i=mi.times.findIndex(t=>t.slice(11,16)===m);
    if(i<0)i=mi.times.findIndex(t=>t.slice(11,16)>m);  // 降采样后无整点，取其后第一个点
    if(i<0&&idx===0)i=0;          // 数据从 09:31 起，首刻度用第一个点
    if(i<0)return;
    g.strokeStyle=line; g.beginPath(); g.moveTo(X(i),padT); g.lineTo(X(i),vTop+subH); g.stroke();
    g.fillStyle=ink; g.fillText(m,X(i),H-6);
  });
  if(hint){
    const chg=pre?((last/pre-1)*100):0;
    hint.textContent=`昨收 ${pre??'-'} · 现价 ${last} · ${chg>=0?'+':''}${chg.toFixed(2)}% · ${n} 点`;
  }
}
window.addEventListener('resize',()=>{ if(detailObj) drawMinute(detailObj); });
