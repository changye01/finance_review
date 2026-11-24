/* 独立详情页：?sid=xxx 定位标的 → meta 找信息 → 分片取序列 → Chart 绘制 */
import {fmt,cls,sgn,fetchJSON} from './util.js';
import {Chart} from './chart.js';

const NOTE_DAILY='不复权日线 · 上K线／下成交量（百万股）· 成交额为湖内精确值（amount 元）';
const NOTE_MONTH='前复权月线 · 上K线／下成交额（亿元）· 开＝月首日／收＝月末日';
const ZOOM_HINT='　·　图上左右拖动平移、滚轮缩放（范围越小K线越大）；点上方均线开关可叠加 MA5/10/20/60/120/250';

const sid=new URLSearchParams(location.search).get('sid')||'';
let M=null,chart=null,detailObj=null,mode='daily';

function findStock(){
  const all=(M.stocks||[]).concat(M.probe||[]);
  return all.find(x=>(x.sid||x.code)===sid)||null;
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
  renderHead(x);loadData(x);
}).catch(e=>{document.getElementById('dName').textContent='数据载入失败：'+e.message;});
