/* 独立详情页：?sid=xxx → meta 定位 → 分片取序列 → Chart 绘制
   翻页走 History API 局部更新（复用 chart 实例与已载分片），不再整页重载 */
import {fmt,cls,sgn,fetchJSON,fetchShard} from './util.js';
import {Chart} from './chart.js';
import {orderedList} from './list.js';

const NOTE_DAILY='不复权日线 · 上K线／下成交量（百万股）· 成交额为湖内精确值（amount 元）';
const NOTE_MONTH='前复权月线 · 上K线／下成交额（亿元）· 开＝月首日／收＝月末日';
const ZOOM_HINT='　·　左右拖动平移、滚轮/双指捏合缩放（范围越小K线越大），双指上下拖动调图表高度（180–1800px，自动记住）；rps-review 同款交互 · 点均线开关切换 MA5/10/20/60/120/250 · ←/→ 键翻上/下一个标的';

const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const parseCtx=q=>({view:q.get('v')||'pool',layer:q.get('l')||'__all',
                    probeFilter:q.get('f')||'all',sortKey:q.get('sk')||null,
                    sortDir:q.get('sd')==='-1'?-1:1,query:q.get('q')||''});

const qs=new URLSearchParams(location.search);
let sid=qs.get('sid')||'';
let listCtx=parseCtx(qs);
let M=null,chart=null,detailObj=null,mode='daily',prevSid=null,nextSid=null,loadSeq=0;
const memShards={};

function findStock(){
  let rows=orderedList(M,listCtx);
  let i=rows.findIndex(x=>(x.sid||x.code)===sid);
  if(i<0){ // 上下文与标的不符（如直接改 URL）：回退到全集顺序翻页
    rows=(M.stocks||[]).concat(M.probe||[]);
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
  renderHead(x);loadData();
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
  const isP=!!x.date,ind=x.ind||{};
  document.title=`${x.name} · 量化看板`;
  document.getElementById('dName').innerHTML=`${esc(x.name)}<span class="code">${esc(x.code)}</span>`;
  let meta;
  if(isP){
    meta=`t_45 探针 · 信号日 ${esc(x.date||'—')} · 距今 ${x.dist==null?'—':x.dist} 日 · 涨幅 <span class="${cls(x.chg)}">${sgn(x.chg)}%</span> · 放大 ${fmt(x.mult,1)}× · 换手 ${fmt(x.turn,1)}%<br>${esc(x.band||'')} · ${esc(x.state||'')}`;
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
    let h=0;for(let i=0;i<sid.length;i++)h=(h*31+sid.charCodeAt(i))>>>0;
    const shard=h%M.shards;
    let all=memShards[shard];
    if(!all){
      all=await fetchShard('./series/shard_'+shard+'.json',M.generated_at,d=>!!(d&&d[sid]));
      memShards[shard]=all;
    }
    if(seq!==loadSeq)return; // 快速连按翻页时丢弃过期请求
    const obj=all[sid];if(!obj)throw new Error('序列缺失 '+sid);
    detailObj=obj;
    if(!chart)chart=new Chart(box,document.getElementById('zoomCtl'),document.getElementById('maLegend'));
    chart.setData(obj,mode);
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
  renderHead(x);bindNav();loadData();
}).catch(e=>{document.getElementById('dName').textContent='数据载入失败：'+e.message;});
