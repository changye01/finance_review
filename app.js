/* 主逻辑：列表渲染、详情、数据加载、启动 */
import {fmt,cls,sgn,bandCls,fetchJSON} from './util.js';
import {Chart} from './chart.js';

const LAYER_NAME={A:'A · 可用',B:'B · 观察',C:'C · 不做',恢复观察:'恢复观察',掉出预筛:'掉出预筛','4分回榜':'4分回榜'};
const LAYER_TIP={A:'四条准入全过：5分 / 回撤<30% / 周转≥2× / 距高<15%',B:'5分但准入未全过，或成立但缺第二日读数；连续两日成立才升A',C:'回撤>30% 一律留C，不因单日反弹或涨停升级',恢复观察:'结束判定被推翻，只核周转能否回2×，不升不降',掉出预筛:'上期在池、本期未过门槛，只留读数不参与分层','4分回榜':'重回预筛但未进5分，不参与分层'};
const PROBE_TIP='v5-noqx 启动探针 · 45日窗 · 严格T+5 · 固定只显示信号日在最近一个月内的标的。命中＝「从静默转放量」的形态候选，证据弱于五条打分，不表示可买、不是量化主控标的。⚠️「⚪已过参与窗口」仅作复盘。点标的看日线，可切月线。';
const COLS={pool:[{k:'layer',t:'层',f:0},{k:'name',t:'标的',f:0},{k:'chg',t:'涨跌',f:1},{k:'turn',t:'换手',f:1},{k:'thr',t:'÷阈值',f:1},{k:'dist_high',t:'距高',f:1},{k:'drawdown',t:'回撤',f:1},{k:'amt',t:'额',f:1}],probe:[{k:'dist',t:'距今',f:0},{k:'name',t:'标的',f:0},{k:'date',t:'信号日',f:0},{k:'chg',t:'涨幅',f:1},{k:'mult',t:'放大',f:1},{k:'turn',t:'换手',f:1},{k:'band',t:'窗口',f:0},{k:'state',t:'状态',f:0}]};
const ZOOM_HINT='　·　在图上左右拖动平移、滚轮缩放（范围越小K线越大），也可用下方 −／＋ 与滑块';
const NOTE_DAILY='不复权日线 · 上K线／下成交量（百万股）· 成交额为湖内精确值（amount 元）';
const NOTE_MONTH='前复权月线 · 上K线／下成交额（亿元）· 开＝月首日／收＝月末日';

let M=null,view='pool',curLayer='__all',probeFilter='all',sortKey=null,sortDir=1,detailId=null,detailData=null;
let chart=null,detailObj=null,detailMode='daily';

function dataset(){if(view==='probe')return (M.probe||[]).slice();let a=(M.stocks||[]).slice();if(curLayer!=='__all')a=a.filter(x=>x.layer===curLayer);return a;}
function filtered(){let a=dataset();if(view==='probe'){if(probeFilter==='fresh')a=a.filter(x=>x.fresh);else if(probeFilter==='green')a=a.filter(x=>x.band&&x.band.indexOf('🟢')>=0);else if(probeFilter==='back')a=a.filter(x=>x.band&&x.band.indexOf('⚪')>=0);}if(sortKey)a.sort((x,y)=>{let vx=x[sortKey],vy=y[sortKey];if(vx==null)vx='';if(vy==null)vy='';if(typeof vx==='string'||typeof vy==='string')return String(vx).localeCompare(String(vy),'zh')*sortDir;return (vx-vy)*sortDir;});return a;}
function cell(x,c){const v=x[c.k];if(c.k==='name'){const b=x.layer?`<span class="badge ${['A','B','C'].includes(x.layer)?x.layer:'other'}">${x.layer}</span> `:'';return `${b}${x.name}${x.fresh?'<span class="chip-new">新</span>':''}<br><span style="color:var(--ink3);font-size:10px">${x.code}</span>`;}if(c.k==='band')return `<span class="band-tag ${bandCls(v)}">${v||'—'}</span>`;if(c.k==='layer'||c.k==='state'||c.k==='date')return v||'—';if(typeof v!=='number')return v==null?'—':v;const isPct=['chg','turn','dist_high','drawdown'].includes(c.k);return `<span class="${isPct?cls(v):''}">${fmt(v,1)}${isPct?'%':(['thr','mult'].includes(c.k)?'×':'')}</span>`;}
function renderList(){
  document.getElementById('listHead').innerHTML=COLS[view].map(c=>`<th data-k="${c.k}">${c.t}${sortKey===c.k?(sortDir>0?' ↑':' ↓'):''}</th>`).join('');
  document.getElementById('listBody').innerHTML=filtered().map(x=>{const id=x.code+(x.date?'@'+x.date:'');return `<tr data-id="${id}" class="${id===detailId?'sel':''}">${COLS[view].map(c=>`<td class="${c.f?'mono':''}">${cell(x,c)}</td>`).join('')}</tr>`;}).join('');
  document.querySelectorAll('#listHead th[data-k]').forEach(th=>th.addEventListener('click',()=>{const k=th.dataset.k;if(sortKey===k)sortDir=-sortDir;else{sortKey=k;sortDir=1;}renderList();}));
}
async function showDetail(id){
  const x=dataset().find(p=>p.code+(p.date?'@'+p.date:'')===id);if(!x)return;
  detailId=id;detailData=x;detailMode='daily';detailObj=null;
  const isP=view==='probe',ind=x.ind||{};
  const meta=isP?`信号日 ${x.date||'—'} · 距今 ${x.dist==null?'—':x.dist} 日 · 涨幅 <span class="${cls(x.chg)}">${sgn(x.chg)}%</span> · 放大 ${fmt(x.mult,1)}× · 换手 ${fmt(x.turn,1)}%<br>${x.band||''} · ${x.state||''}`:`${x.concept||'—'}<br>涨跌 <span class="${cls(x.chg)}">${sgn(x.chg)}%</span> · 换手 ${fmt(x.turn,1)}% · ÷阈值 ${fmt(x.thr,1)}× · 距高 ${sgn(x.dist_high)}% · 回撤 ${sgn(x.drawdown)}% · 额 ${fmt(x.amt)}亿`;
  let kpis='',desc='';
  if(!isP){kpis=`<div class="kpis">${[['现价',fmt(ind.close,2),''],['距250日高',sgn(ind.dist),cls(-ind.dist)],['压缩度',fmt(ind.comp,2),''],['启动度',fmt(ind.start,2),''],['吸筹比',fmt(ind.absorb,2),''],['综合分',fmt(ind.score,1),'']].map(a=>`<div class="kpi"><div class="lab">${a[0]}</div><div class="val ${a[2]}">${a[1]}</div></div>`).join('')}</div>`;desc=`<div class="detail-desc"><b>对应操作</b> ${x.action||'—'}<br><b>预期形态</b> ${x.shape||'—'}<br><b>主升段</b> ${x.seg||'—'} · 遍数 ${fmt(x.rounds,1)} · 窗口涨幅 ${sgn(x.win_gain)}%</div>`;}
  const dp=document.getElementById('detailPanel');dp.classList.remove('detail-panel-hidden');
  dp.innerHTML=`<button class="back-btn" id="backBtn">← 返回列表</button><div class="detail-head"><div><div class="dn">${x.name}<span class="code">${x.code}</span>${isP&&x.fresh?'<span class="chip-new">新</span>':''}</div><div class="detail-meta">${meta}</div></div></div><div class="switch"><button class="on" data-m="daily">日线 · 不复权</button><button data-m="monthly">月线 · 前复权</button></div>${kpis}<div class="chartbox" id="chartbox"><div class="loading">载入图中…</div></div><div class="chart-ctl hide" id="zoomCtl"><button data-z="out" title="缩小范围（显示更多）">−</button><button data-z="in" title="放大范围（显示更少）">＋</button><input type="range" data-z="pan" min="0" max="0" value="0" title="拖动平移"><button data-z="reset" title="显示全部">重置</button><span class="zl"></span></div><div class="detail-note" id="detailNote"></div>${desc}`;
  chart=new Chart(dp.querySelector('#chartbox'),dp.querySelector('#zoomCtl'));
  const bb=document.getElementById('backBtn');if(bb)bb.addEventListener('click',()=>{clearDetail();renderList();window.scrollTo({top:0,behavior:'smooth'});});
  dp.querySelectorAll('.switch button').forEach(b=>b.addEventListener('click',()=>{
    dp.querySelectorAll('.switch button').forEach(z=>z.classList.remove('on'));b.classList.add('on');
    detailMode=b.dataset.m;
    if(detailObj)chart.setData(detailObj,detailMode); // 数据已在内存，切模式不重取
    document.getElementById('detailNote').textContent=(detailMode==='daily'?NOTE_DAILY:NOTE_MONTH)+ZOOM_HINT;
  }));
  if(window.innerWidth<=1000)dp.scrollIntoView({behavior:'smooth',block:'start'});
  renderList();await loadSeries(x,'daily');
}
async function loadSeries(x,mode){
  const box=document.getElementById('chartbox');if(!box)return;
  box.innerHTML='<div class="loading">载入图中…</div>';
  const key=(x.sid||x.code);
  try{
    // 按 sid 哈希取分片（分片文件数少，发布启动快；单片 <60KB 传输稳）
    let h=0;for(let i=0;i<key.length;i++)h=(h*31+key.charCodeAt(i))>>>0;
    const shard=h%M.shards;
    const all=await fetchJSON('./series/shard_'+shard+'.json',d=>!!(d&&d[key]));
    const obj=all[key];
    if(!obj)throw new Error('序列缺失 '+key);
    detailObj=obj;
    chart.setData(obj,mode);
    document.getElementById('detailNote').textContent=(mode==='daily'?NOTE_DAILY:NOTE_MONTH)+ZOOM_HINT;
  }catch(e){box.innerHTML='<div class="loading">图表数据载入失败：'+e.message+'</div>';}
}
function clearDetail(){if(detailId===null)return;detailId=null;detailData=null;detailObj=null;chart=null;const dp=document.getElementById('detailPanel');dp.classList.add('detail-panel-hidden');dp.innerHTML='<div class="detail-empty">点击左侧标的查看日线 / 月线<br>（切换仅改变图表，不代表信号变化）</div>';}
function setupView(){
  const isP=view==='probe',pm=M.probe_meta||{};
  const fs=document.getElementById('filters');
  const f=isP?[['all','全部'],['fresh','🆕新命中'],['green','🟢当期窗口'],['back','⚪仅回溯']]:[['all','全部']];
  fs.innerHTML=f.map(x=>`<button class="pf ${x[0]==='all'?'on':''}" data-f="${x[0]}">${x[1]}</button>`).join('');
  fs.querySelectorAll('.pf').forEach(b=>b.addEventListener('click',()=>{fs.querySelectorAll('.pf').forEach(z=>z.classList.remove('on'));b.classList.add('on');probeFilter=b.dataset.f;renderList();}));
  document.getElementById('listTitle').textContent=isP?'t_45 探针 · T 表':(curLayer==='__all'?'A/B/C 全池':LAYER_NAME[curLayer]||curLayer);
  document.getElementById('listMeta').textContent=isP?`${pm.probe_version||'—'} · ${pm.window||''} · ${pm.total||0}/${pm.total_all||0} 只`:`${dataset().length} 只 · 复盘日 ${M.date}`;
  document.getElementById('tip').textContent=isP?PROBE_TIP:(curLayer==='__all'?'A/B/C 全池（按分层排序）':(LAYER_TIP[curLayer]||''));
}
function boot(){
  document.getElementById('subline').textContent='复盘日 '+M.date+' · CNEquity 本地湖（'+M.lake_coverage+'）· 生成 '+M.generated_at;
  const pm=M.probe_meta||{};
  document.getElementById('footer').innerHTML=`<b>口径</b>　日线：${M.caliber.daily}<br>　　　　月线：${M.caliber.monthly}<br>　　　　指标：${M.caliber.indicators}<br><b>探针</b>　${pm.file||'缺'}，固定筛选 ${pm.window||'—'}（全窗 ${pm.total_all||0} → ${pm.total||0} 只），与 A/B/C 池不合并计数。命中≠可买。<br><b>边界</b>　主观分层，不构成建议。静态快照，复盘后须重跑并发布。`;
  const order=['A','B','C','恢复观察','掉出预筛','4分回榜'],counts={};order.forEach(l=>counts[l]=M.stocks.filter(s=>s.layer===l).length);
  let th=`<div class="tab on" data-v="pool" data-l="__all">全部 <span class="n">${M.stocks.length}</span></div>`;
  order.forEach(l=>{if(counts[l])th+=`<div class="tab" data-v="pool" data-l="${l}">${LAYER_NAME[l]} <span class="n">${counts[l]}</span></div>`;});
  th+=`<div class="tab probe" data-v="probe">t_45 探针 <span class="n">${(M.probe||[]).length}</span></div>`;
  const tabs=document.getElementById('tabs');tabs.innerHTML=th;
  tabs.addEventListener('click',e=>{const t=e.target.closest('.tab');if(!t)return;tabs.querySelectorAll('.tab').forEach(x=>x.classList.remove('on'));t.classList.add('on');view=t.dataset.v;curLayer=t.dataset.l||'__all';sortKey=null;sortDir=1;detailId=null;clearDetail();setupView();renderList();if(window.innerWidth<=1000)window.scrollTo({top:0,behavior:'smooth'});});
  document.getElementById('listBody').addEventListener('click',e=>{const tr=e.target.closest('tr[data-id]');if(tr)showDetail(tr.dataset.id);});
  setupView();renderList();
}
fetchJSON('./meta.json',d=>!!(d&&d.stocks&&d.shards)).then(d=>{M=d;boot();}).catch(e=>{document.getElementById('subline').textContent='数据载入失败（已重试6次）：'+e.message+'　请刷新页面重试。';});
