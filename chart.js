/* K 线：TradingView lightweight-charts v5（Canvas 渲染 + 原生触摸手势）
   与 rps-review 同款：横拖平移、双指捏合缩放、滚轮平移、纵拖不抢页面滚动。
   对外 API 保持旧版一致（setData/zoom/reset/pan + MA 开关），detail.js 无需改。 */
/* TradingView lightweight-charts v5.2.0 官方 standalone 版（IIFE，无外部依赖）。
   由 detail.html 在模块前以 <script src> 加载，挂到 window.LightweightCharts。 */
const {createChart,CandlestickSeries,LineSeries,HistogramSeries,CrosshairMode,ColorType}=
  (globalThis.LightweightCharts||{});

/* 均线配色（仿 rps-review 图例） */
export const MA_DEF=[{k:'ma5',label:'MA5',color:'#5b8def'},
                     {k:'ma10',label:'MA10',color:'#e8a33d'},
                     {k:'ma20',label:'MA20',color:'#c563d9'},
                     {k:'ma60',label:'MA60',color:'#3fb6a8'},
                     {k:'ma120',label:'MA120',color:'#d95b8e'},
                     {k:'ma250',label:'MA250',color:'#9aa7bd'}];

const UP='#f5222d',DOWN='#52c41a',INK='#aab6cc',GRID='#2b3548',BG='#151d2e';

export class Chart{
  constructor(box,ctl,legendEl){
    this.box=box;this.ctl=ctl;this.legendEl=legendEl||null;
    this.obj=null;this.mode='daily';
    this.maOn={ma5:true,ma10:true,ma20:true,ma60:false,ma120:false,ma250:false};
    this.chart=null;this.cs=null;this.hist=null;this.maSeries={};
    this._syncing=false;this._ro=null;
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
    /* rps-review 无 +/- 按钮：缩放/平移全靠 Canvas 原生手势（拖拽、滚轮、捏合）。
       若页面仍带旧控件则保留绑定，否则完全交给 charts。 */
    const zc=this.ctl;if(!zc)return;
    const bind=(k,fn)=>{const el=zc.querySelector('[data-z="'+k+'"]');if(el)el.addEventListener('click',fn);};
    bind('out',()=>this.zoom(-1));bind('in',()=>this.zoom(1));bind('reset',()=>this.reset());
    const sl=zc.querySelector('[data-z="pan"]');if(sl)sl.addEventListener('input',e=>this.pan(+e.target.value));
  }
  /* 首次 setData 时建 chart：单 chart + overlay 成交量（避免双 chart range 同步回环） */
  _ensureChart(){
    if(this.chart)return;
    this.box.innerHTML='<div class="lwc-main"></div>';
    const main=this.box.querySelector('.lwc-main');
    const narrow=window.innerWidth<=560;
    const hMain=narrow?500:376;
    main.style.height=hMain+'px';
    const base={
      layout:{background:{type:ColorType.Solid,color:BG},textColor:INK,fontSize:narrow?12:11,
              fontFamily:"-apple-system,BlinkMacSystemFont,'PingFang SC',Arial,sans-serif"},
      grid:{vertLines:{color:GRID,visible:true},horzLines:{color:GRID,visible:true}},
      crosshair:{mode:CrosshairMode.Normal,
                 vertLine:{color:'#5a6b8c',width:1,style:2,labelBackgroundColor:'#334155'},
                 horzLine:{color:'#5a6b8c',width:1,style:2,labelBackgroundColor:'#334155'}},
      rightPriceScale:{borderColor:GRID,minimumWidth:narrow?52:62,scaleMargins:{top:0.08,bottom:0.26}},
      timeScale:{borderColor:GRID,timeVisible:false,secondsVisible:false,rightOffset:2,leftOffset:1},
      /* 与 rps-review 完全相同的手势口径 */
      handleScroll:{mouseWheel:true,pressedMouseMove:true,horzTouchDrag:true,vertTouchDrag:false},
      handleScale:{axisPressedMouseMove:{time:true,price:true},axisDoubleClickReset:true,mouseWheel:true,pinch:true},
      localization:{locale:'zh-CN'}
    };
    const w=Math.max(240,this.box.clientWidth||window.innerWidth-40);
    this.chart=createChart(main,{...base,width:w,height:hMain});
    this.chart.timeScale().subscribeVisibleLogicalRangeChange(r=>this._onRange(r));
    this._ro=new ResizeObserver(()=>{
      const cw=Math.max(240,this.box.clientWidth||window.innerWidth-40);
      if(this.chart)this.chart.applyOptions({width:cw});
    });
    this._ro.observe(this.box);
  }
  /* 历史 K 线 + 成交量 + MA 一次性装载；切日/月在同实例内 setData */
  setData(obj,mode){
    this.obj=obj;this.mode=mode;this._ensureChart();
    if(this.ctl)this.ctl.classList.remove('hide');
    const daily=mode==='daily';
    const dates=daily?obj.daily.dates:obj.monthly.ms.map(m=>m+'-01');
    const ohlc=daily?obj.daily.ohlc:obj.monthly.ohlc;
    const bars=daily?obj.daily.vol:obj.monthly.amt;
    const mas=daily?(obj.daily.ma||{}):(obj.monthly.ma||{});
    const n=Math.min(dates.length,ohlc.length);if(!n)return;
    /* 数据按 time 升序；lightweight-charts 要求时间严格递增且唯一 */
    const candles=[],hist=[];
    for(let i=0;i<n;i++){
      const o=ohlc[i];
      candles.push({time:dates[i],open:o[0],close:o[1],low:o[2],high:o[3]});
      hist.push({time:dates[i],value:bars[i]||0,color:o[1]>=o[0]?'rgba(245,34,45,.42)':'rgba(82,196,26,.42)'});
    }
    if(!this.cs){
      this.cs=this.chart.addSeries(CandlestickSeries,{
        upColor:UP,downColor:DOWN,borderUpColor:UP,borderDownColor:DOWN,
        wickUpColor:UP,wickDownColor:DOWN,priceLineVisible:false,lastValueVisible:true
      });
      this.hist=this.chart.addSeries(HistogramSeries,{
        priceScaleId:'',priceFormat:{type:'price',precision:2,minMove:0.01},
        priceLineVisible:false,lastValueVisible:false
      });
      /* 成交量 overlay 的 scaleMargins 必须设在 chart 的 overlay priceScale 上
         （series 创建之后才有该 scale），否则柱子占满主图遮挡 K 线 */
      this.chart.priceScale('').applyOptions({scaleMargins:{top:0.78,bottom:0.02}});
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
      const arr=mas[m.k]||[];const pts=[];
      for(let i=0;i<n;i++){const v=arr[i];if(v!=null)pts.push({time:dates[i],value:v});}
      this.maSeries[m.k].setData(pts);
    });
    /* 默认展示最近 ~120 根（手机 ~70 根），可拖可缩；与旧版观感接近。
       ⚠️ lightweight-charts 在 setData 同帧设 range 会被内部 fitContent 覆盖，
       必须等下一帧（rps-review 自身也是 rAF 延迟设置）。 */
    this._total=n;
    const def=window.innerWidth<=560?70:120;
    const from=Math.max(0,n-def),to=this._full().to;
    requestAnimationFrame(()=>this._applyRange({from,to}));
  }
  /* logical range 的合法区间：from 最小 0，to 最大 n-1+rightOffset。
     rightOffset=2 → toMax=n+1；可视根数 = r.to-r.from（含右侧留白，
     故满屏显示 n+1 而非 n，标签上按 min(n,跨度) 显示以免超过总数）。 */
  _full(){return {from:0,to:Math.max(1,(this._total||1)-1+2)};}
  /* 统一设置可视区间：charts 的 getVisibleLogicalRange 异步生效，
     故 UI 用目标值立即更新，订阅回调随后再校准一次 */
  _applyRange(r){
    if(!this.chart)return;
    this.chart.timeScale().setVisibleLogicalRange(r);
    if(this.ctl)this.ctl.classList.remove('hide');
    this._onRange(r);
  }
  _onRange(r){
    if(!this.ctl||!this._total||!r)return;
    const sl=this.ctl.querySelector('input[data-z="pan"]'),lab=this.ctl.querySelector('.zl');
    const full=this._full(),span=full.to-full.from;
    const cnt=Math.max(1,Math.round(r.to-r.from));
    const start=Math.max(0,Math.round(r.from));
    if(sl){sl.max=Math.max(0,Math.round(span-cnt));sl.value=start;}
    if(lab){
      const shown=Math.min(this._total,cnt);
      lab.textContent=`显示 ${shown}/${this._total} 根${shown<this._total?'（'+fmt((start+1)/this._total*100,0)+'–'+fmt(Math.min(this._total,start+cnt)/this._total*100,0)+'%）':''}`;
    }
  }
  /* 以可视窗口中心为锚缩放；dir>0 放大（根数变少 → K 线更大）。
     跨度上限用 full.to-full.from，不再跟数据根数 n 比较，避免 rightOffset 导致卡死。 */
  zoom(dir){
    if(!this.chart||!this._total)return;
    const ts=this.chart.timeScale(),r=ts.getVisibleLogicalRange();if(!r)return;
    const full=this._full(),span=full.to-full.from;
    // charts 内部可能返回负 from（leftOffset/fitContent 副作用），先夹到合法区间
    const rf=Math.max(full.from,r.from),rt=Math.min(full.to,r.to);
    const cnt=Math.max(8,rt-rf),anchor=(rf+rt)/2;
    const nc=dir>0?Math.max(6,Math.round(cnt/1.6)):Math.min(span,Math.round(cnt*1.6));
    if(nc>=span){this._applyRange(full);return;}
    const from=Math.max(full.from,Math.min(full.to-nc,Math.round(anchor-nc/2)));
    this._applyRange({from,to:from+nc});
  }
  reset(){
    if(!this.chart||!this._total)return;
    this._applyRange(this._full());
  }
  pan(v){
    if(!this.chart||!this._total)return;
    const ts=this.chart.timeScale(),r=ts.getVisibleLogicalRange();if(!r)return;
    const full=this._full(),cnt=Math.max(8,Math.min(full.to,full.from+ (r.to-r.from))-full.from);
    const from=Math.max(full.from,Math.min(full.to-cnt,v));
    this._applyRange({from,to:from+cnt});
  }
  dispose(){
    if(this._ro)this._ro.disconnect();
    if(this.chart)this.chart.remove();
  }
}
