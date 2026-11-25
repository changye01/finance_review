/* 主逻辑：列表渲染、分层/探针 tab、排序、搜索、当日概览；点击标的 → 新标签页打开 detail.html */
import {fmt,cls,sgn,bandCls,fetchJSON} from './util.js';
import {orderedList} from './list.js';

const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

const LAYER_NAME={A:'A · 可用',B:'B · 观察',C:'C · 不做',恢复观察:'恢复观察',掉出预筛:'掉出预筛','4分回榜':'4分回榜'};
const LAYER_TIP={A:'四条准入全过：5分 / 回撤<30% / 周转≥2× / 距高<15%',B:'5分但准入未全过，或成立但缺第二日读数；连续两日成立才升A',C:'回撤>30% 一律留C，不因单日反弹或涨停升级',恢复观察:'结束判定被推翻，只核周转能否回2×，不升不降',掉出预筛:'上期在池、本期未过门槛，只留读数不参与分层','4分回榜':'重回预筛但未进5分，不参与分层'};
const PROBE_TIP='v5-noqx 启动探针 · 45日窗 · 严格T+5 · 固定只显示信号日在最近一个月内的标的。命中＝「从静默转放量」的形态候选，证据弱于五条打分，不表示可买、不是量化主控标的。⚠️「⚪已过参与窗口」仅作复盘。点标的在新页看日线，可切月线。';
const COLS={pool:[{k:'layer',t:'层',f:0},{k:'name',t:'标的',f:0},{k:'chg',t:'涨跌',f:1},{k:'turn',t:'换手',f:1},{k:'thr',t:'÷阈值',f:1},{k:'dist_high',t:'距高',f:1},{k:'drawdown',t:'回撤',f:1},{k:'amt',t:'额',f:1}],probe:[{k:'dist',t:'距今',f:0},{k:'name',t:'标的',f:0},{k:'date',t:'信号日',f:0},{k:'chg',t:'涨幅',f:1},{k:'mult',t:'放大',f:1},{k:'turn',t:'换手',f:1},{k:'band',t:'窗口',f:0},{k:'state',t:'状态',f:0}]};
const ORDER=['A','B','C','恢复观察','掉出预筛','4分回榜'];

let M=null,view='pool',curLayer='__all',probeFilter='all',sortKey=null,sortDir=1,query='';
let SNAP=null,ovMode=(new URLSearchParams(location.search)).get('ov')==='hist'?'hist':'now'; // SNAP=历史快照；ovMode=右栏 概览/迁移

function ctx(){return {view,layer:curLayer,probeFilter,sortKey,sortDir,query};}
function dataset(){return orderedList(M,ctx());}
function cell(x,c){const v=x[c.k];if(c.k==='name'){const b=x.layer?`<span class="badge ${['A','B','C'].includes(x.layer)?x.layer:'other'}">${x.layer}</span> `:'';return `${b}${x.name}${x.fresh?'<span class="chip-new">新</span>':''}<br><span style="color:var(--ink3);font-size:10px">${x.code}</span>`;}if(c.k==='band')return `<span class="band-tag ${bandCls(v)}">${v||'—'}</span>`;if(c.k==='layer'||c.k==='state'||c.k==='date')return v||'—';if(typeof v!=='number')return v==null?'—':v;const isPct=['chg','turn','dist_high','drawdown'].includes(c.k);return `<span class="${isPct?cls(v):''}">${fmt(v,1)}${isPct?'%':(['thr','mult'].includes(c.k)?'×':'')}</span>`;}
function renderList(){
  document.getElementById('listHead').innerHTML=COLS[view].map(c=>`<th data-k="${c.k}">${c.t}${sortKey===c.k?(sortDir>0?' ↑':' ↓'):''}</th>`).join('');
  const rows=dataset();
  document.getElementById('listBody').innerHTML=rows.map(x=>{const id=x.sid||x.code;return `<tr data-id="${id}" title="点击进入详情">${COLS[view].map(c=>`<td class="${c.f?'mono':''}">${cell(x,c)}</td>`).join('')}</tr>`;}).join('')||`<tr><td colspan="${COLS[view].length}" style="text-align:center;color:var(--ink3);padding:26px 0">无匹配标的</td></tr>`;
  document.querySelectorAll('#listHead th[data-k]').forEach(th=>th.addEventListener('click',()=>{const k=th.dataset.k;if(sortKey===k)sortDir=-sortDir;else{sortKey=k;sortDir=1;}renderList();}));
  const isP=view==='probe',pm=M.probe_meta||{};
  document.getElementById('listMeta').textContent=isP
    ?`${pm.probe_version||'—'} · ${pm.window||''} · ${pm.total||0}/${pm.total_all||0} 只${query?' · 搜到 '+rows.length:''}`
    :`${rows.length} 只 · 复盘日 ${M.date}${query?' · 已筛选':''}`;
}
function setupView(){
  const isP=view==='probe',pm=M.probe_meta||{};
  const fs=document.getElementById('filters');
  const f=isP?[['all','全部'],['fresh','🆕新命中'],['green','🟢当期窗口'],['back','⚪仅回溯']]:[['all','全部']];
  fs.innerHTML=f.map(x=>`<button class="pf ${x[0]===probeFilter?'on':''}" data-f="${x[0]}">${x[1]}</button>`).join('');
  fs.querySelectorAll('.pf').forEach(b=>b.addEventListener('click',()=>{fs.querySelectorAll('.pf').forEach(z=>z.classList.remove('on'));b.classList.add('on');probeFilter=b.dataset.f;renderList();}));
  document.getElementById('listTitle').textContent=isP?'t_45 探针 · T 表':(curLayer==='__all'?'A/B/C 全池':LAYER_NAME[curLayer]||curLayer);
  document.getElementById('tip').textContent=isP?PROBE_TIP:(curLayer==='__all'?'A/B/C 全池（按分层排序）':(LAYER_TIP[curLayer]||''));
}
function renderOverview(counts){
  const max=Math.max(1,...ORDER.map(l=>counts[l]));
  let h='<div class="ov-sec"><div class="ov-h">分层分布 · 点击切换</div>';
  ORDER.filter(l=>counts[l]).forEach(l=>{
    const pct=Math.round(counts[l]/M.stocks.length*100);
    h+=`<button class="ov-row" data-l="${l}"><span class="ov-lab">${LAYER_NAME[l]}</span><span class="ov-bar"><i style="width:${(counts[l]/max*100).toFixed(1)}%"></i></span><span class="ov-num">${counts[l]} <em>${pct}%</em></span></button>`;
  });
  h+='</div><div class="ov-sec"><div class="ov-h">分层口径</div>';
  ORDER.filter(l=>counts[l]).forEach(l=>{h+=`<div class="ov-def"><b>${LAYER_NAME[l]}</b><span>${LAYER_TIP[l]}</span></div>`;});
  h+='</div><div class="ov-sec"><div class="ov-h">探针</div><div class="ov-def"><span>命中 ${(M.probe||[]).length} 只 · 命中≠可买，完整口径见列表上方说明</span></div></div>';
  h+='<div class="ov-hint">点击左侧任一标的，在新标签页打开 K 线详情。日线／月线 · MA5/10/20/60/120/250 · 拖拽平移＋滚轮缩放</div>';
  const ov=document.getElementById('overview');ov.innerHTML=h;
  ov.querySelectorAll('[data-l]').forEach(b=>b.addEventListener('click',()=>{
    view='pool';curLayer=b.dataset.l;sortKey=null;sortDir=1;
    document.querySelectorAll('#tabs .tab').forEach(t=>t.classList.toggle('on',t.dataset.v==='pool'&&t.dataset.l===b.dataset.l));
    setupView();renderList();
  }));
}
/* 迁移视图：8 个真实快照日的探针 A 率轨迹 + 分层边界说明（历史分层无快照，不编造） */
function renderHistory(){
  const ov=document.getElementById('overview');
  if(!SNAP||!SNAP.snapshots||!SNAP.snapshots.length){ov.innerHTML='<div class="tl-empty">历史快照数据不可用（snapshots.json 未生成）。</div>';return;}
  const snaps=SNAP.snapshots.slice(-10); // 最多显示最近 10 日
  const maxA=Math.max(1,...snaps.map(s=>s.probe.total||0));
  let h='<div class="mig-legend"><span><i style="background:var(--up)"></i>探针「A 已验」占比</span><span>A率＝已验 / 当日探针总数</span></div>';
  h+='<div class="mig-h">探针 T+5 验证进度 · 真实历史快照</div>';
  snaps.forEach(s=>{
    const p=s.probe||{},rate=p.a_rate==null?'—':fmt(p.a_rate,1)+'%';
    const aPct=((p.a||0)/maxA*100).toFixed(1);
    h+=`<div class="mig-row"><span class="mig-date">${esc(s.date.slice(5))}</span>`;
    h+=`<span class="mig-bar" title="A ${p.a||0} / B ${p.b||0} / 共 ${p.total||0}"><i style="width:${aPct}%"></i></span>`;
    h+=`<span class="mig-rate">${rate}</span><span class="mig-ab">${p.a||0}/${p.total||0}</span></div>`;
  });
  const last=snaps[snaps.length-1],ly=last.layers||{};
  const layerTxt=ORDER.filter(l=>ly[l]).map(l=>`${l} ${ly[l]}`).join(' · ')||'无';
  h+=`<div class="mig-note"><b>口径边界</b>　探针 A 率来自每日真实探针产物（${esc(SNAP.asof)} 为止 ${SNAP.snapshots.length} 个快照日），反映「当日窗口内已通过 T+5 验证的占比」，跨日总量随窗口滚动而变化，不可直接相减当作新增。<br><b>分层迁移</b>　A/B/C 分层池仅复盘当日（${esc(last.date)}）有快照：${esc(layerTxt)}。历史各日无分层存档，故不画 A↔B↔C 迁移曲线——不编数据。<br>需要看单只标的的状态轨迹，点进探针详情底部「标的状态时间轴」。</div>`;
  ov.innerHTML=h;
}
function setOvMode(mode){
  ovMode=mode;
  document.querySelectorAll('.ov-sw button').forEach(b=>b.classList.toggle('on',b.dataset.ov===mode));
  if(mode==='hist')renderHistory();
  else{const counts={};ORDER.forEach(l=>counts[l]=M.stocks.filter(s=>s.layer===l).length);renderOverview(counts);}
}
function boot(){
  document.getElementById('subline').textContent='复盘日 '+M.date+' · CNEquity 本地湖（'+M.lake_coverage+'）· 生成 '+M.generated_at;
  const pm=M.probe_meta||{};
  document.getElementById('footer').innerHTML=`<b>口径</b>　日线：${M.caliber.daily}<br>　　　　月线：${M.caliber.monthly}<br>　　　　指标：${M.caliber.indicators}<br><b>探针</b>　${pm.file||'缺'}，固定筛选 ${pm.window||'—'}（全窗 ${pm.total_all||0} → ${pm.total||0} 只），与 A/B/C 池不合并计数。命中≠可买。<br><b>边界</b>　主观分层，不构成建议。静态快照，复盘后须重跑并发布。`;
  const counts={};ORDER.forEach(l=>counts[l]=M.stocks.filter(s=>s.layer===l).length);
  let th=`<div class="tab on" data-v="pool" data-l="__all">全部 <span class="n">${M.stocks.length}</span></div>`;
  ORDER.forEach(l=>{if(counts[l])th+=`<div class="tab" data-v="pool" data-l="${l}">${LAYER_NAME[l]} <span class="n">${counts[l]}</span></div>`;});
  th+=`<div class="tab probe" data-v="probe">t_45 探针 <span class="n">${(M.probe||[]).length}</span></div>`;
  th+=`<div class="tab article" data-v="article">复盘文章</div>`;
  th+=`<div class="tab doc" data-v="think">think</div>`;
  const tabs=document.getElementById('tabs');tabs.innerHTML=th;
  tabs.addEventListener('click',e=>{
    const t=e.target.closest('.tab');if(!t)return;
    tabs.querySelectorAll('.tab').forEach(x=>x.classList.remove('on'));t.classList.add('on');
    view=t.dataset.v;curLayer=t.dataset.l||'__all';sortKey=null;sortDir=1;
    const art=document.getElementById('articleWrap'),lay=document.querySelector('.layout');
    if(view==='article'||view==='think'){ lay.classList.add('hide'); art.classList.remove('hide'); showDoc(view); return; }
    lay.classList.remove('hide'); art.classList.add('hide');
    setupView();renderList();
  });
  const qi=document.getElementById('q');
  qi.addEventListener('input',()=>{query=qi.value;renderList();});
  // URL 参数直进文档视图（?v=article / ?v=think），便于分享与测试
  const dv=new URLSearchParams(location.search).get('v');
  if(dv==='article'||dv==='think'){
    const dt=tabs.querySelector(`.tab[data-v="${dv}"]`); if(dt) setTimeout(()=>dt.click(),0);
  }
  document.getElementById('listBody').addEventListener('click',e=>{
    const tr=e.target.closest('tr[data-id]');if(!tr)return;
    const c=ctx();
    const q=new URLSearchParams({sid:tr.dataset.id,v:c.view,l:c.layer,f:c.probeFilter,sk:c.sortKey||'',sd:String(c.sortDir)});
    if(c.query)q.set('q',c.query);
    // 透传 sharecode（WorkBuddy 发布站需要；Cloudflare 上为空）
    const sc=new URLSearchParams(location.search).get('sharecode');
    if(sc)q.set('sharecode',sc);
    window.open('./detail.html?'+q.toString(),'_blank','noopener');
  });
  document.getElementById('ovMeta').textContent=M.date;
  renderOverview(counts);
  setupView();renderList();
  // 右栏 概览/迁移 切换
  const osw=document.querySelector('.ov-sw');
  if(osw){
    osw.querySelectorAll('button').forEach(b=>b.classList.toggle('on',b.dataset.ov===ovMode));
    osw.addEventListener('click',e=>{const b=e.target.closest('button[data-ov]');if(b)setOvMode(b.dataset.ov);});
  }
  // 迁移数据并行加载；若用户已切到迁移页则渲染之
  fetchJSON('./snapshots.json',d=>!!(d&&d.snapshots)).then(d=>{
    SNAP=d;if(ovMode==='hist')renderHistory();
  }).catch(()=>{});
}
fetchJSON('./meta.json',d=>!!(d&&d.stocks&&d.shards)).then(d=>{M=d;boot();}).catch(e=>{document.getElementById('subline').textContent='数据载入失败：'+e.message+'　请刷新页面重试。';});

/* ── 文档 tab：复盘文章 / think（2026-11-25）────────────────
   构建时 qm_webgen.py 把当日复盘 MD → articles/latest.md、
   finance/think → articles/think.md。懒加载：首次点 tab 才下载，
   两个 tab 共用同一容器，按 key 缓存，来回切换不重复请求。 */
const DOC={article:{file:'latest.md',md:true},think:{file:'think.md',md:false}};
async function showDoc(key){
  const box=document.getElementById('articleWrap'),cfg=DOC[key];
  if(!box||!cfg) return;
  if(box.dataset.loaded==='1'&&box.dataset.key===key) return;
  const label=key==='think'?'think':'文章';
  box.innerHTML='<div class="loading">'+label+'载入中…</div>';
  try{
    const r=await fetch('./articles/'+cfg.file+'?t='+Date.now(),{cache:'no-store'});
    if(!r.ok) throw new Error('HTTP '+r.status);
    const text=await r.text();
    if(cfg.md){
      if(!window.marked) throw new Error('marked 未加载');
      box.innerHTML='<div class="md">'+window.marked.parse(text)+'</div>';
      // 表格外包一层，窄屏可横向滚动
      box.querySelectorAll('table').forEach(t=>{
        if(t.parentElement.classList.contains('md-tw'))return;
        const w=document.createElement('div');w.className='md-tw';
        t.parentNode.insertBefore(w,t);w.appendChild(t);
      });
    }else{
      // think 是原样随手记，不走 markdown（会吃掉换行）：按行渲染，保留缩进，日期行单独成块
      const lines=text.replace(/\r/g,'').split('\n');
      box.innerHTML='<div class="md think-md">'+lines.map(l=>{
        if(/^\s*\d{3,4}\s*$/.test(l)||/^\s*\d{1,2}\.\d{1,2}\b/.test(l))
          return '<div class="think-day">'+esc(l.trim())+'</div>';
        return '<div class="think-line">'+(l?esc(l):'&nbsp;')+'</div>';
      }).join('')+'</div>';
    }
    box.dataset.key=key;box.dataset.loaded='1';
  }catch(e){
    box.innerHTML='<div class="loading">'+label+'载入失败：'+esc(e.message)+'</div>';
  }
}
function showArticle(){return showDoc('article');}
