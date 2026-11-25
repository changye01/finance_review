/* K 线：TradingView lightweight-charts v5.2.0 —— 完整照搬 rps-review 的交互架构
   ① 双独立 chart（主图 K线+MA / 副图成交量），各自 canvas，互不重排
   ② range 边界钳制 _clamp + 共享 guard 双向同步（rps 的 _e / Oe）
   ③ rightOffset=8；④ 双指上下捏合改高度 180–1800px（rps 特色）
   ⑤ range 回调零 DOM 写入：范围文字用 rAF 节流，拖拽帧不碰布局
   库：官方 standalone IIFE，由 detail.html 在模块前加载 → window.LightweightCharts */
import {fmt} from './util.js';
const {createChart,CandlestickSeries,LineSeries,HistogramSeries,CrosshairMode,ColorType}=
  (globalThis.LightweightCharts||{});

export const MA_DEF=[{k:'ma5',label:'MA5',color:'#5b8def'},
                     {k:'ma10',label:'MA10',color:'#e8a33d'},
                     {k:'ma20',label:'MA20',color:'#c563d9'},
                     {k:'ma60',label:'MA60',color:'#3fb6a8'},
                     {k:'ma120',label:'MA120',color:'#d95b8e'},
                     {k:'ma250',label:'MA250',color:'#9aa7bd'}];

const UP='#f5222d',DOWN='#52c41a',INK='#aab6cc',GRID='#2b3548',BG='#151d2e';
const RIGHT_OFF=8, MIN_SPAN=10;              // rps: et=8, 最小可视跨度 10
const _VW=(typeof window!=='undefined')?window.innerWidth:1300;
const _VH=(typeof window!=='undefined')?window.innerHeight:900;
const IS_NARROW=_VW<=560;
const MIN_H=180, MAX_H=1800;
// 2026-11-25 改为**视口自适应**（参考 rps-review.com 的 useViewportChartHeight 思路）：
// 固定 px 在小屏手机上会占满、在大屏上又偏小，按屏高比例算更稳。
// 手机 0.58×屏高（夹 420–600）；平板 0.62（夹 520–720）；桌面固定 520。
const DEF_H = _VW<=560 ? Math.round(Math.min(Math.max(_VH*0.45, 320), 480))
           : _VW<=1100 ? Math.round(Math.min(Math.max(_VH*0.58, 480), 680))
           : 520;
const HS_KEY='lwc_chart_height';

const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));
const num=(v,d)=>(v==null||v===''||!Number.isFinite(+v))?d:Math.round(+v);
/* rps 的 Xe()：总量按类型分配主/副图高度，副图 clamp 到 [60,120] 之间 */
function splitH(total){
  const o=Math.max(MIN_H,num(total,DEF_H)),sep=17,body=Math.max(1,o-sep);
  const want=Math.round(o*0.2);
  const sub=clamp(want,Math.min(60,Math.max(1,body)),Math.min(120,Math.max(1,body)));
  return {main:body-sub,sub,sep};
}

export class Chart{
  constructor(box,ctl,legendEl){
    this.box=box;this.ctl=ctl;this.legendEl=legendEl||null;
    this.obj=null;this.mode='daily';this._total=0;
    this.maOn={ma5:true,ma10:true,ma20:true,ma60:false,ma120:false,ma250:false};
    this.chart=null;this.chartSub=null;this.cs=null;this.hist=null;this.maSeries={};
    this._syncing=false;this._ro=null;this._labelRAF=0;
    let saved=DEF_H;try{saved=num(localStorage.getItem(HS_KEY),DEF_H);}catch(_){}
    this._height=clamp(IS_NARROW?DEF_H:saved,MIN_H,MAX_H);  // 手机忽略旧存储值
    this._mainEl=null;this._subEl=null;
    this._pinch=null;this._onResize=null;this._touch=null;
    this._bindCtl();
    if(this.legendEl)this._renderLegend();
  }
  _renderLegend(){
    this.legendEl.innerHTML=MA_DEF.map(m=>`<button type="button" class="ma-lg ${this.maOn[m.k]?'on':''}" data-ma="${m.k}"><i style="background:${m.color}"></i>${m.label}</button>`).join('');
    this.legendEl.querySelectorAll('[data-ma]').forEach(b=>b.addEventListener('click',()=>{
      const k=b.dataset.ma;this.maOn[k]=!this.maOn[k];b.classList.toggle('on',this.maOn[k]);
      const s=this.maSeries[k];if(s)s.applyOptions({visible:this.maOn[k]});
    }));
  }
  _bindCtl(){
    this._label=this.ctl?this.ctl.querySelector('.zl'):null;
  }
  /* 主/副图各自的公共配置；手势口径与 rps 完全一致 */
  _base(){
    const narrow=window.innerWidth<=560;
    return {
      layout:{background:{type:ColorType.Solid,color:BG},textColor:INK,fontSize:narrow?12:11,
              fontFamily:"-apple-system,BlinkMacSystemFont,'PingFang SC',Arial,sans-serif"},
      grid:{vertLines:{color:GRID,visible:true},horzLines:{color:GRID,visible:true}},
      crosshair:{mode:CrosshairMode.Normal,
                 vertLine:{color:'#5a6b8c',width:1,style:2,labelBackgroundColor:'#334155'},
                 horzLine:{color:'#5a6b8c',width:1,style:2,labelBackgroundColor:'#334155'}},
      rightPriceScale:{borderColor:GRID,minimumWidth:narrow?52:62,scaleMargins:{top:0.08,bottom:0.08}},
      timeScale:{borderColor:GRID,timeVisible:false,secondsVisible:false,rightOffset:RIGHT_OFF,leftOffset:1,
                 ...(narrow?{minBarSpacing:0.5}:{})},
      handleScroll:{mouseWheel:true,pressedMouseMove:true,horzTouchDrag:true,vertTouchDrag:false},
      handleScale:{axisPressedMouseMove:{time:true,price:true},axisDoubleClickReset:true,mouseWheel:true,pinch:true},
      localization:{locale:'zh-CN'}
    };
  }
  /* rps Xe()：设置两图高度（双指捏合时实时调用） */
  _setHeight(h){
    this._height=clamp(Math.round(h),MIN_H,MAX_H);
    const s=splitH(this._height);
    if(this._mainEl)this._mainEl.style.height=s.main+'px';
    if(this._subEl)this._subEl.style.height=s.sub+'px';
    if(this.chart)this.chart.applyOptions({height:s.main});
    if(this.chartSub)this.chartSub.applyOptions({height:s.sub});
  }
  _ensureChart(){
    if(this.chart)return;
    this.box.innerHTML='<div class="lwc-main"></div><div class="lwc-sep"></div><div class="lwc-sub"></div>';
    const main=this.box.querySelector('.lwc-main'),sub=this.box.querySelector('.lwc-sub');
    this._mainEl=main;this._subEl=sub;
    const s=splitH(this._height);
    main.style.height=s.main+'px';sub.style.height=s.sub+'px';
    const w=Math.max(240,this.box.clientWidth||window.innerWidth-40),base=this._base();
    this.chart=createChart(main,{...base,width:w,height:s.main});
    this.chartSub=createChart(sub,{...base,width:w,height:s.sub,
      rightPriceScale:{...base.rightPriceScale,scaleMargins:{top:0.10,bottom:0.06}},
      // 2026-11-25 修：副图原本也开着 mouseWheel/pinch 缩放，会和主图各自缩放导致错位。
      // 关掉副图的一切独立缩放，只保留拖动（拖动由 link 双向同步），量柱才能始终跟住 K 线。
      handleScale:{...base.handleScale,mouseWheel:false,pinch:false,
                   axisPressedMouseMove:{time:false,price:false}},
      crosshair:{...base.crosshair,horzLine:{visible:false}}
    });
    /* rps 的 Oe()：双向同步 + 边界钳制 + 共享 guard（防回环）。
       只有钳制后 range 真的变了才回写，避免事件风暴。 */
    // 2026-11-25 修：原用实例级 this._syncing 做防回环，两条 link 共用一个标志，
    // 拖动主图时副图的回调可能正好撞上 true 被跳过 → 量柱不跟随。
    // 改成每条 link 各自一个局部 busy 标志，互不干扰。
    const link=(a,b)=>{
      let busy=false;
      a.timeScale().subscribeVisibleLogicalRangeChange(r=>{
        if(busy||!r)return;
        busy=true;
        try{
          const c=this._clamp(r);
          if(c.from!==r.from||c.to!==r.to)a.timeScale().setVisibleLogicalRange(c);
          b.timeScale().setVisibleLogicalRange(c);
          this._queueLabel(c);
        }finally{busy=false;}
      });
    };
    link(this.chart,this.chartSub);
    link(this.chartSub,this.chart);
    /* 宽度自适应（观察 box，不观察 chart 内部，避免回环） */
    this._ro=new ResizeObserver(()=>{
      const cw=Math.max(240,this.box.clientWidth||window.innerWidth-40);
      if(this.chart)this.chart.applyOptions({width:cw});
      if(this.chartSub)this.chartSub.applyOptions({width:cw});
    });
    this._ro.observe(this.box);
    /* rps 特色：双指上下捏合改图表高度（180–1800），横向捏合仍交给 charts 缩放时间轴 */
    // 🔴 2026-11-24：双指手势交给 light charts 缩放 K 线。
    //    原 _bindPinchHeight 监听双指 Y 间距改图表高度，与 pinch 缩放抢手势——
    //    用户捏合时「整个 K 线框放大」实际是它在改高度，不是页面缩放。
    //    函数保留（改三指或长按可再启用），此处不再绑定。
    // this._bindPinchHeight();
  }
  /* rps 的 _e()：把 range 钳进 [0, n-1+rightOffset]，跨度至少 MIN_SPAN */
  _clamp(r){
    const maxTo=Math.max((this._total||1)-1+RIGHT_OFF,0);
    const want=Math.max(r.to-r.from,MIN_SPAN),cap=Math.max(maxTo,MIN_SPAN),w=Math.min(want,cap);
    let from=r.from,to=r.to;
    if(from<0){from=0;to=w;}
    if(to>maxTo){to=maxTo;from=Math.max(0,to-w);}
    return {from,to};
  }
  _full(){return {from:0,to:Math.max(MIN_SPAN,(this._total||1)-1+RIGHT_OFF)};}
  /* 范围文字用 rAF 节流：拖拽每帧最多写一次，且只写缓存的 label 节点 */
  _queueLabel(r){
    if(!this._label||!this._total||!r)return;
    if(this._labelRAF)return;
    this._labelRAF=requestAnimationFrame(()=>{
      this._labelRAF=0;
      const cnt=Math.max(1,Math.round(r.to-r.from)),start=Math.max(0,Math.round(r.from));
      const shown=Math.min(this._total,cnt);
      this._label.textContent=`显示 ${shown}/${this._total} 根${shown<this._total?'（'+fmt((start+1)/this._total*100,0)+'–'+fmt(Math.min(this._total,start+cnt)/this._total*100,0)+'%）':''}`;
    });
  }
  _applyRange(r){
    if(!this.chart)return;
    const c=this._clamp(r);
    this.chart.timeScale().setVisibleLogicalRange(c);
    this.chartSub.timeScale().setVisibleLogicalRange(c);
    if(this.ctl)this.ctl.classList.remove('hide');
    this._queueLabel(c);
  }
  /* rps 双指改高度：监听容器 touch，双指 Y 间距变化 → 高度 */
  _bindPinchHeight(){
    const box=this.box;
    const spanY=e=>Math.abs(e.touches[0].clientY-e.touches[1].clientY);
    const start=e=>{
      if(e.touches.length===2){this._pinch={d:spanY(e),h:this._height};}
    };
    const move=e=>{
      if(!this._pinch||e.touches.length!==2)return;
      e.preventDefault(); // 阻止父容器滚动
      const h=clamp(Math.round(this._pinch.h+(spanY(e)-this._pinch.d)*1.15),MIN_H,MAX_H);
      if(h===this._height)return;
      this._setHeight(h);
    };
    const end=e=>{
      if(this._pinch&&e.touches.length<2){
        try{localStorage.setItem(HS_KEY,String(this._height));}catch(_){}
        this._pinch=null;
      }
    };
    box.addEventListener('touchstart',start,{passive:true});
    box.addEventListener('touchmove',move,{passive:false});
    box.addEventListener('touchend',end,{passive:true});
    box.addEventListener('touchcancel',end,{passive:true});
    // 🔴 2026-11-24：iOS Safari 的双指缩放走 gesture* 事件，CSS touch-action 拦不住，
    //    必须在图表容器上显式 preventDefault，否则双指捏合会变成整页缩放（布局错位）。
    //    Android 由 .chartbox{touch-action:pan-y} 拦住，两者互补。
    ['gesturestart','gesturechange','gestureend'].forEach(t=>
      box.addEventListener(t,e=>e.preventDefault(),{passive:false}));
    this._touch={start,move,end};
  }
  /* 历史 K 线 + 成交量 + MA 一次性装载；切日/月在同实例 setData */
  setData(obj,mode){
    this.obj=obj;this.mode=mode;this._ensureChart();
    if(this.ctl)this.ctl.classList.remove('hide');
    const daily=mode==='daily';
    const dates=daily?obj.daily.dates:obj.monthly.ms.map(m=>m+'-01');
    const ohlc=daily?obj.daily.ohlc:obj.monthly.ohlc;
    const bars=daily?obj.daily.vol:obj.monthly.amt;
    const mas=daily?(obj.daily.ma||{}):(obj.monthly.ma||{});
    const n=Math.min(dates.length,ohlc.length);if(!n)return;
    const candles=[],hist=[];
    for(let i=0;i<n;i++){
      const o=ohlc[i];
      candles.push({time:dates[i],open:o[0],close:o[1],low:o[2],high:o[3]});
      hist.push({time:dates[i],value:bars[i]||0,color:o[1]>=o[0]?'rgba(245,34,45,.55)':'rgba(82,196,26,.55)'});
    }
    if(!this.cs){
      this.cs=this.chart.addSeries(CandlestickSeries,{
        // 2026-11-25 用户「红柱改为空心」：阳线填充透明、只留红色边框，
        // 这样均线穿过阳线时不被遮挡，重叠区也能看清。
        upColor:'rgba(0,0,0,0)',downColor:DOWN,
        borderUpColor:UP,borderDownColor:DOWN,
        wickUpColor:UP,wickDownColor:DOWN,
        priceLineVisible:false,lastValueVisible:true
      });
      this.hist=this.chartSub.addSeries(HistogramSeries,{
        priceFormat:{type:'price',precision:2,minMove:0.01},priceLineVisible:false,lastValueVisible:false
      });
      MA_DEF.forEach(m=>{
        this.maSeries[m.k]=this.chart.addSeries(LineSeries,{
          color:m.color,lineWidth:1,priceLineVisible:false,lastValueVisible:false,
          visible:this.maOn[m.k],crosshairMarkerVisible:false
        });
      });
    }
    this.cs.setData(candles);
    this.hist.setData(hist);
    MA_DEF.forEach(m=>{
      const arr=mas[m.k]||[],pts=[];
      for(let i=0;i<n;i++){const v=arr[i];if(v!=null)pts.push({time:dates[i],value:v});}
      this.maSeries[m.k].setData(pts);
    });
    /* 默认展示最近 250 根（手机 120；2026-11-24 由 120/70 上调，用户「120 根不够」），rAF 延迟设置 */
    this._total=n;
    const def=_VW<=560?50:(_VW<=1100?120:250),from=Math.max(0,n-def),to=this._full().to;  // 手机50 / 平板120 / 桌面250（2026-11-25 用户定），可双指放大
    requestAnimationFrame(()=>this._applyRange({from,to}));
  }
  dispose(){
    if(this._labelRAF)cancelAnimationFrame(this._labelRAF);
    if(this._ro)this._ro.disconnect();
    if(this._touch){
      this.box.removeEventListener('touchstart',this._touch.start);
      this.box.removeEventListener('touchmove',this._touch.move);
      this.box.removeEventListener('touchend',this._touch.end);
      this.box.removeEventListener('touchcancel',this._touch.end);
    }
    if(this.chart)this.chart.remove();
    if(this.chartSub)this.chartSub.remove();
  }
}
