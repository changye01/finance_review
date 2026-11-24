/* SVG K 线绘制 + 缩放 + 均线：无外部库，状态封装在 Chart 实例内 */
import {UP,DOWN,INK,GRID,fmt} from './util.js';

/* 均线配色（仿 rps-review 图例） */
export const MA_DEF=[{k:'ma5',label:'MA5',color:'#5b8def'},
                     {k:'ma10',label:'MA10',color:'#e8a33d'},
                     {k:'ma20',label:'MA20',color:'#c563d9'},
                     {k:'ma60',label:'MA60',color:'#3fb6a8'},
                     {k:'ma120',label:'MA120',color:'#d95b8e'},
                     {k:'ma250',label:'MA250',color:'#9aa7bd'}];

export class Chart{
  constructor(box,ctl,legendEl){
    this.box=box;this.ctl=ctl;this.legendEl=legendEl||null;
    this.obj=null;      // 当前序列 {daily,monthly}
    this.mode='daily';  // daily | monthly
    this.win=null;      // 缩放窗口 {start,count}，null=全量
    // 默认勾选 MA5/10/20（仿 rps-review 常用短中期均线）
    this.maOn={ma5:true,ma10:true,ma20:true,ma60:false,ma120:false,ma250:false};
    this.box.style.cursor='grab';
    this._bindCtl();
    this._bindDrag();
    if(this.legendEl)this._renderLegend();
  }
  _renderLegend(){
    this.legendEl.innerHTML=MA_DEF.map(m=>`<button type="button" class="ma-lg ${this.maOn[m.k]?'on':''}" data-ma="${m.k}"><i style="background:${m.color}"></i>${m.label}</button>`).join('');
    this.legendEl.querySelectorAll('[data-ma]').forEach(b=>b.addEventListener('click',()=>{
      const k=b.dataset.ma;this.maOn[k]=!this.maOn[k];b.classList.toggle('on',this.maOn[k]);
      if(this.obj)this.draw();
    }));
  }
  _bindCtl(){
    const zc=this.ctl;
    zc.querySelector('[data-z="out"]').addEventListener('click',()=>this.zoom(-1));
    zc.querySelector('[data-z="in"]').addEventListener('click',()=>this.zoom(1));
    zc.querySelector('[data-z="reset"]').addEventListener('click',()=>this.reset());
    zc.querySelector('[data-z="pan"]').addEventListener('input',e=>this.pan(+e.target.value));
    /* 鼠标滚轮以光标位置为中心缩放 */
    this.box.addEventListener('wheel',e=>{
      const total=this.total();if(!total)return;
      e.preventDefault();
      const r=this.box.getBoundingClientRect(),frac=Math.max(0,Math.min(1,(e.clientX-r.left)/r.width));
      const cur=this.win||{start:0,count:total};
      let cnt=e.deltaY<0?Math.max(8,Math.round(cur.count/1.35)):Math.min(total,Math.round(cur.count*1.35));
      if(cnt>=total)this.win=null;
      else{const anchor=cur.start+frac*cur.count;this.win={start:Math.max(0,Math.min(total-cnt,Math.round(anchor-frac*cnt))),count:cnt};}
      this.draw();
    },{passive:false});
  }
  /* 画布拖拽平移：按下记录起点，移动按像素→K线根数换算窗口起点
     手机优化：touchmove 用 rAF 节流（一帧最多重绘一次 SVG），配合 CSS
     touch-action:pan-y 让浏览器只管纵向滚动、横向交给本函数，避免每次
     move 全量重建 DOM 造成的掉帧与页面跟手滚动。 */
  _bindDrag(){
    const box=this.box;
    let dragging=false,startX=0,startWin=null,raf=0,pendingStart=null;
    const px=e=>e.touches&&e.touches.length?e.touches[0].clientX:e.clientX;
    const flush=()=>{ // rAF 内真正落一次窗口并绘制
      raf=0;
      if(pendingStart==null||!startWin)return;
      this.win={start:pendingStart,count:startWin.count};
      this.draw();
    };
    const down=e=>{
      const total=this.total();if(!total)return;
      // 全量视图无可平移空间：首次拖动时先收窄到右半段，让拖动立刻生效
      if(!this.win&&total>8){
        const cnt=Math.max(8,Math.round(total*0.5));
        this.win={start:total-cnt,count:cnt};
        this.draw();
      }
      dragging=true;startX=px(e);startWin=this.win?{...this.win}:null;pendingStart=null;
      box.style.cursor='grabbing';
    };
    const move=e=>{
      if(!dragging)return;
      const total=this.total(),cnt=startWin?startWin.count:total;
      if(cnt>=total)return; // 全量无可平移空间
      if(e.cancelable)e.preventDefault();
      const r=box.getBoundingClientRect();if(!r.width)return;
      const shift=Math.round((px(e)-startX)/r.width*cnt);
      const ns=Math.max(0,Math.min(total-cnt,(startWin?startWin.start:0)-shift));
      if(this.win&&this.win.start===ns&&pendingStart===ns)return;
      pendingStart=ns;
      if(!raf)raf=requestAnimationFrame(flush); // 同帧多次 move 合并为一次绘制
    };
    const up=()=>{
      if(!dragging)return;
      dragging=false;box.style.cursor='grab';
      if(raf){cancelAnimationFrame(raf);raf=0;}
      // 抬手时补齐最后一帧，停在手指离开的位置
      if(pendingStart!=null&&startWin&&(!this.win||this.win.start!==pendingStart)){
        this.win={start:pendingStart,count:startWin.count};this.draw();
      }
      pendingStart=null;startWin=null;
    };
    box.addEventListener('mousedown',down);
    box.addEventListener('touchstart',down,{passive:false});
    window.addEventListener('mousemove',move);
    box.addEventListener('touchmove',move,{passive:false});
    window.addEventListener('mouseup',up);
    box.addEventListener('touchend',up);
    box.addEventListener('touchcancel',up);
  }
  total(){if(!this.obj)return 0;return (this.mode==='daily'?this.obj.daily.ohlc:this.obj.monthly.ohlc).length;}
  /* 载入新标的：重置窗口。切日线/月线走同法（数据已在内存，无需重取） */
  setData(obj,mode){this.obj=obj;this.mode=mode;this.win=null;this.draw();}
  reset(){this.win=null;this.draw();}
  zoom(dir){
    const total=this.total();if(!total)return;
    const cur=this.win||{start:0,count:total};
    const cnt=dir>0?Math.max(8,Math.round(cur.count/1.6)):Math.min(total,Math.round(cur.count*1.6));
    if(cnt>=total)this.win=null;
    else{const right=cur.start+cur.count;this.win={start:Math.max(0,Math.min(total-cnt,right-cnt)),count:cnt};}
    this.draw();
  }
  pan(v){
    const total=this.total();if(!total||!this.win)return;
    const cnt=this.win.count;
    this.win={start:Math.max(0,Math.min(total-cnt,v)),count:cnt};
    this.draw();
  }
  _syncCtl(total,start,count){
    this.ctl.classList.remove('hide');
    const sl=this.ctl.querySelector('input[data-z="pan"]'),lab=this.ctl.querySelector('.zl');
    sl.max=Math.max(0,total-count);sl.value=start;sl.disabled=total<=count;
    lab.textContent=`显示 ${count}/${total} 根${count<total?'（'+fmt((start+1)/total*100,0)+'–'+fmt((start+count)/total*100,0)+'%）':''}`;
  }
  draw(){
    const obj=this.obj;if(!obj)return;
    const daily=this.mode==='daily';
    const allDates=daily?obj.daily.dates:obj.monthly.ms.map(m=>m+'-01');
    const allOhlc=daily?obj.daily.ohlc:obj.monthly.ohlc;
    const allBars=daily?obj.daily.vol:obj.monthly.amt;
    const total=allOhlc.length;if(!total)return;
    let start=0,count=total;
    if(this.win){count=Math.max(8,Math.min(total,this.win.count|0));start=Math.max(0,Math.min(total-count,this.win.start|0));this.win={start,count};}
    const dates=allDates.slice(start,start+count),ohlc=allOhlc.slice(start,start+count),bars=allBars.slice(start,start+count);
    /* 手机窄屏：拉高 viewBox（K线区/量区同比放大），显示高度随宽度按比例变高 */
    const narrow=window.innerWidth<=560;
    const W=800,PL=8,PR=narrow?46:58,PT=14,
          KH=narrow?450:218,GAP=narrow?14:10,VH=narrow?130:64;
    const H=PT+KH+GAP+VH+(narrow?32:34);
    const IW=W-PL-PR,n=ohlc.length;
    const FS=narrow?16:10,LSW=narrow?1.4:0.6,CSW=narrow?1.6:1;
    const mas=daily?(obj.daily.ma||{}):(obj.monthly.ma||{});
    const visMa=MA_DEF.filter(m=>this.maOn[m.k]&&mas[m.k]);
    const hi=Math.max(...ohlc.map(o=>o[3])),lo=Math.min(...ohlc.map(o=>o[2]));
    const maVals=visMa.flatMap(m=>mas[m.k].slice(start,start+count)).filter(v=>v!=null);
    const yHi=maVals.length?Math.max(hi,...maVals):hi,yLo=maVals.length?Math.min(lo,...maVals):lo;
    const pad=(yHi-yLo)*0.06||1,yMax=yHi+pad,yMin=yLo-pad;
    const sy=v=>PT+KH-(v-yMin)/(yMax-yMin)*KH;
    const cw=IW/n,bw=Math.max(1,Math.min(cw*0.62,narrow?42:28)),cx=i=>PL+cw*(i+0.5);
    let s=`<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">`;
    for(let g=0;g<4;g++){const y=PT+KH*g/3;s+=`<line x1="${PL}" y1="${y}" x2="${PL+IW}" y2="${y}" stroke="${GRID}" stroke-width="${LSW}"/><text x="${PL+IW+4}" y="${y+4}" fill="${INK}" font-size="${FS}">${fmt(yMax-(yMax-yMin)*g/3,2)}</text>`;}
    /* 均线折线（忽略 null，遇 null 断线） */
    visMa.forEach(m=>{
      const arr=mas[m.k].slice(start,start+count);let seg=[],paths=[];
      arr.forEach((v,i)=>{if(v==null){if(seg.length>1)paths.push(seg);seg=[];}else seg.push(`${cx(i).toFixed(1)},${sy(v).toFixed(1)}`);});
      if(seg.length>1)paths.push(seg);
      paths.forEach(p=>{s+=`<polyline points="${p.join(' ')}" fill="none" stroke="${m.color}" stroke-width="${narrow?2.2:1.5}" opacity="0.92"/>`;});
    });
    ohlc.forEach((o,i)=>{const up=o[1]>=o[0],col=up?UP:DOWN,x=cx(i);s+=`<line x1="${x}" y1="${sy(o[3])}" x2="${x}" y2="${sy(o[2])}" stroke="${col}" stroke-width="${CSW}"/><rect x="${(x-bw/2).toFixed(1)}" y="${Math.min(sy(o[0]),sy(o[1])).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(1,Math.abs(sy(o[0])-sy(o[1]))).toFixed(1)}" fill="${up?col:'none'}" stroke="${col}" stroke-width="${CSW}"/>`;});
    const vTop=PT+KH+GAP,vMax=Math.max(...bars)||1;
    bars.forEach((b,i)=>{const up=ohlc[i][1]>=ohlc[i][0],h=b/vMax*VH;s+=`<rect x="${(cx(i)-bw/2).toFixed(1)}" y="${(vTop+VH-h).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" fill="${up?'rgba(245,34,45,.55)':'rgba(82,196,26,.55)'}"/>`;});
    s+=`<line x1="${PL}" y1="${vTop+VH}" x2="${PL+IW}" y2="${vTop+VH}" stroke="${GRID}" stroke-width="${LSW}"/>`;
    const nl=Math.min(narrow?4:6,n),lbl=[];for(let k=0;k<nl;k++)lbl.push(Math.round(k*(n-1)/(nl-1||1)));
    lbl.forEach(i=>{s+=`<text x="${cx(i)}" y="${H-6}" fill="${INK}" font-size="${FS}" text-anchor="middle">${dates[i]}</text>`;});
    s+='</svg>';this.box.innerHTML=s;
    this._syncCtl(total,start,count);
  }
}
