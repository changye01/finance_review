/* 独立详情页：?sid=xxx 定位标的 → meta 找信息 → 分片取序列 → Chart 绘制 */
import {fmt,cls,sgn,fetchJSON} from './util.js';
import {Chart} from './chart.js';
import {orderedList} from './list.js';

const NOTE_DAILY='不复权日线 · 上K线／下成交量（百万股）· 成交额为湖内精确值（amount 元）';
const NOTE_MONTH='前复权月线 · 上K线／下成交额（亿元）· 开＝月首日／收＝月末日';
const ZOOM_HINT='　·　左右拖动平移、滚轮/双指捏合缩放（范围越小K线越大，rps-review 式）；点均线开关切换 MA5/10/20/60/120/250；←/→ 键翻上/下一个标的';

const qs=new URLSearchParams(location.search);
const sid=qs.get('sid')||'';
// 列表上下文（由 index 打开时透传），用于按当前筛选/排序顺序上下翻页
const listCtx={view:qs.get('v')||'pool',layer:qs.get('l')||'__all',
               probeFilter:qs.get('f')||'all',sortKey:qs.get('sk')||null,
               sortDir:qs.get('sd')==='-1'?-1:1};
let M=null,chart=null,detailObj=null,mode='daily',prevSid=null,nextSid=null;

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
  return rows[i];
}
function goSid(target){
  if(!target)return;
  const q=new URLSearchParams({sid:target,v:listCtx.view,l:listCtx.layer,
    f:listCtx.probeFilter,sk:listCtx.sortKey||'',sd:String(listCtx.sortDir)});
  const sc=qs.get('sharecode');if(sc)q.set('sharecode',sc);
  location.href='./detail.html?'+q.toString();
}
function bindNav(){
  const p=document.getElementById('dPrev'),n=document.getElementById('dNext');
  p.disabled=!prevSid;n.disabled=!nextSid;
  p.addEventListener('click',()=>goSid(prevSid));
  n.addEventListener('click',()=>goSid(nextSid));
  window.addEventListener('keydown',e=>{
    if(e.target&&/INPUT|TEXTAREA/.test(e.target.tagName))return;
    if(e.key==='ArrowLeft'&&prevSid)goSid(prevSid);
    if(e.key==='ArrowRight'&&nextSid)goSid(nextSid);
  });
}
function renderHead(x){
  const isP=!!x.date,ind=x.ind||{};
  document.title=`${x.name} · 量化看板`;
  document.getElementById('dName').innerHTML=`${x.name}<span class="code">${x.code}</span>`;
  let meta;
  if(isP){
    meta=`t_45 探针 · 信号日 ${x.date||'—'} · 距今 ${x.dist==null?'—':x.dist} 日 · 涨幅 <span class="${cls(x.chg)}">${sgn(x.chg)}%</span> · 放大 ${fmt(x.mult,1)}× · 换手 ${fmt(x.turn,1)}%<br>${x.band||''} · ${x.state||''}`;
  }else{
    meta=`${x.layer||''} · 涨跌 <span class="${cls(x.chg)}">${sgn(x.chg)}%</span> · 换手 ${fmt(x.turn,1)}% · ÷阈值 ${fmt(x.thr,1)}× · 距高 ${sgn(x.dist_high)}% · 回撤 ${sgn(x.drawdown)}% · 额 ${fmt(x.amt)}亿`+(x.concept?`<br>${x.concept}`:'');
  }
  document.getElementById('dMeta').innerHTML=meta;
  // KPI（仅 A/B/C 池有六指标）
  const kp=document.getElementById('dKpis');
  if(!isP&&ind&&ind.close!=null){
    kp.innerHTML=`<div class="kpis">${[['现价',fmt(ind.close,2),''],['距250日高',sgn(ind.dist),cls(-ind.dist)],['压缩度',fmt(ind.comp,2),''],['启动度',fmt(ind.start,2),''],['吸筹比',fmt(ind.absorb,2),''],['综合分',fmt(ind.score,1),'']].map(a=>`<div class="kpi"><div class="lab">${a[0]}</div><div class="val ${a[2]}">${a[1]}</div></div>`).join('')}</div>`;
  }else kp.innerHTML='';
}
async function loadData(x){
  const box=document.getElementById('chartbox');
  try{
    let h=0;for(let i=0;i<sid.length;i++)h=(h*31+sid.charCodeAt(i))>>>0;
    const shard=h%M.shards;
    // 详情页展示根数更多（日线 120→全部下表），直接取分片里整条序列
    const all=await fetchJSON('./series/shard_'+shard+'.json',d=>!!(d&&d[sid]));
    const obj=all[sid];if(!obj)throw new Error('序列缺失 '+sid);
    detailObj=obj;
    chart=new Chart(box,document.getElementById('zoomCtl'),document.getElementById('maLegend'));
    chart.setData(obj,mode);
    document.getElementById('detailNote').textContent=(mode==='daily'?NOTE_DAILY:NOTE_MONTH)+ZOOM_HINT;
  }catch(e){box.innerHTML='<div class="loading">图表数据载入失败：'+e.message+'</div>';}
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
  M=d;const x=findStock();
  if(!x){document.getElementById('dName').textContent='未找到标的 '+sid;return;}
  renderHead(x);bindNav();loadData(x);
}).catch(e=>{document.getElementById('dName').textContent='数据载入失败：'+e.message;});
