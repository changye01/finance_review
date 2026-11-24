/* 主逻辑：列表渲染、分层/探针 tab、排序；点击标的 → 新标签页打开 detail.html */
import {fmt,cls,sgn,bandCls,fetchJSON,resUrl} from './util.js';
import {orderedList} from './list.js';

const LAYER_NAME={A:'A · 可用',B:'B · 观察',C:'C · 不做',恢复观察:'恢复观察',掉出预筛:'掉出预筛','4分回榜':'4分回榜'};
const LAYER_TIP={A:'四条准入全过：5分 / 回撤<30% / 周转≥2× / 距高<15%',B:'5分但准入未全过，或成立但缺第二日读数；连续两日成立才升A',C:'回撤>30% 一律留C，不因单日反弹或涨停升级',恢复观察:'结束判定被推翻，只核周转能否回2×，不升不降',掉出预筛:'上期在池、本期未过门槛，只留读数不参与分层','4分回榜':'重回预筛但未进5分，不参与分层'};
const PROBE_TIP='v5-noqx 启动探针 · 45日窗 · 严格T+5 · 固定只显示信号日在最近一个月内的标的。命中＝「从静默转放量」的形态候选，证据弱于五条打分，不表示可买、不是量化主控标的。⚠️「⚪已过参与窗口」仅作复盘。点标的在新页看日线，可切月线。';
const COLS={pool:[{k:'layer',t:'层',f:0},{k:'name',t:'标的',f:0},{k:'chg',t:'涨跌',f:1},{k:'turn',t:'换手',f:1},{k:'thr',t:'÷阈值',f:1},{k:'dist_high',t:'距高',f:1},{k:'drawdown',t:'回撤',f:1},{k:'amt',t:'额',f:1}],probe:[{k:'dist',t:'距今',f:0},{k:'name',t:'标的',f:0},{k:'date',t:'信号日',f:0},{k:'chg',t:'涨幅',f:1},{k:'mult',t:'放大',f:1},{k:'turn',t:'换手',f:1},{k:'band',t:'窗口',f:0},{k:'state',t:'状态',f:0}]};

let M=null,view='pool',curLayer='__all',probeFilter='all',sortKey=null,sortDir=1;

function ctx(){return {view,layer:curLayer,probeFilter,sortKey,sortDir};}
function dataset(){return orderedList(M,ctx());}
function cell(x,c){const v=x[c.k];if(c.k==='name'){const b=x.layer?`<span class="badge ${['A','B','C'].includes(x.layer)?x.layer:'other'}">${x.layer}</span> `:'';return `${b}${x.name}${x.fresh?'<span class="chip-new">新</span>':''}<br><span style="color:var(--ink3);font-size:10px">${x.code}</span>`;}if(c.k==='band')return `<span class="band-tag ${bandCls(v)}">${v||'—'}</span>`;if(c.k==='layer'||c.k==='state'||c.k==='date')return v||'—';if(typeof v!=='number')return v==null?'—':v;const isPct=['chg','turn','dist_high','drawdown'].includes(c.k);return `<span class="${isPct?cls(v):''}">${fmt(v,1)}${isPct?'%':(['thr','mult'].includes(c.k)?'×':'')}</span>`;}
function renderList(){
  document.getElementById('listHead').innerHTML=COLS[view].map(c=>`<th data-k="${c.k}">${c.t}${sortKey===c.k?(sortDir>0?' ↑':' ↓'):''}</th>`).join('');
  document.getElementById('listBody').innerHTML=dataset().map(x=>{const id=x.sid||x.code;return `<tr data-id="${id}" title="点击进入详情">${COLS[view].map(c=>`<td class="${c.f?'mono':''}">${cell(x,c)}</td>`).join('')}</tr>`;}).join('');
  document.querySelectorAll('#listHead th[data-k]').forEach(th=>th.addEventListener('click',()=>{const k=th.dataset.k;if(sortKey===k)sortDir=-sortDir;else{sortKey=k;sortDir=1;}renderList();}));
}
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
  tabs.addEventListener('click',e=>{const t=e.target.closest('.tab');if(!t)return;tabs.querySelectorAll('.tab').forEach(x=>x.classList.remove('on'));t.classList.add('on');view=t.dataset.v;curLayer=t.dataset.l||'__all';sortKey=null;sortDir=1;setupView();renderList();});
  document.getElementById('listBody').addEventListener('click',e=>{
    const tr=e.target.closest('tr[data-id]');if(!tr)return;
    const c=ctx();
    const q=new URLSearchParams({sid:tr.dataset.id,v:c.view,l:c.layer,f:c.probeFilter,sk:c.sortKey||'',sd:String(c.sortDir)});
    // 透传 sharecode（WorkBuddy 发布站需要；Cloudflare 上为空）
    const sc=new URLSearchParams(location.search).get('sharecode');
    if(sc)q.set('sharecode',sc);
    window.open('./detail.html?'+q.toString(),'_blank','noopener');
  });
  setupView();renderList();
}
fetchJSON('./meta.json',d=>!!(d&&d.stocks&&d.shards)).then(d=>{M=d;boot();}).catch(e=>{document.getElementById('subline').textContent='数据载入失败（已重试6次）：'+e.message+'　请刷新页面重试。';});
