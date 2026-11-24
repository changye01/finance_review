/* SVG K 线绘制 + 缩放：无外部库，状态封装在 Chart 实例内 */
import {UP,DOWN,INK,GRID,fmt} from './util.js';

export class Chart{
  constructor(box,ctl){
    this.box=box;this.ctl=ctl;
    this.obj=null;      // 当前序列 {daily,monthly}
    this.mode='daily';  // daily | monthly
    this.win=null;      // 缩放窗口 {start,count}，null=全量
    this._bindCtl();
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
    const W=800,H=340,PL=8,PR=58,PT=14,KH=218,GAP=10,VH=64;
    const IW=W-PL-PR,n=ohlc.length;
    const hi=Math.max(...ohlc.map(o=>o[3])),lo=Math.min(...ohlc.map(o=>o[2]));
    const pad=(hi-lo)*0.06||1,yMax=hi+pad,yMin=lo-pad;
    const sy=v=>PT+KH-(v-yMin)/(yMax-yMin)*KH;
    const cw=IW/n,bw=Math.max(1,Math.min(cw*0.62,28)),cx=i=>PL+cw*(i+0.5);
    let s=`<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">`;
    for(let g=0;g<4;g++){const y=PT+KH*g/3;s+=`<line x1="${PL}" y1="${y}" x2="${PL+IW}" y2="${y}" stroke="${GRID}" stroke-width="0.6"/><text x="${PL+IW+4}" y="${y+3}" fill="${INK}" font-size="10">${fmt(yMax-(yMax-yMin)*g/3,2)}</text>`;}
    ohlc.forEach((o,i)=>{const up=o[1]>=o[0],col=up?UP:DOWN,x=cx(i);s+=`<line x1="${x}" y1="${sy(o[3])}" x2="${x}" y2="${sy(o[2])}" stroke="${col}" stroke-width="1"/><rect x="${(x-bw/2).toFixed(1)}" y="${Math.min(sy(o[0]),sy(o[1])).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(1,Math.abs(sy(o[0])-sy(o[1]))).toFixed(1)}" fill="${up?col:'none'}" stroke="${col}" stroke-width="1"/>`;});
    const vTop=PT+KH+GAP,vMax=Math.max(...bars)||1;
    bars.forEach((b,i)=>{const up=ohlc[i][1]>=ohlc[i][0],h=b/vMax*VH;s+=`<rect x="${(cx(i)-bw/2).toFixed(1)}" y="${(vTop+VH-h).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" fill="${up?'rgba(245,34,45,.55)':'rgba(82,196,26,.55)'}"/>`;});
    s+=`<line x1="${PL}" y1="${vTop+VH}" x2="${PL+IW}" y2="${vTop+VH}" stroke="${GRID}" stroke-width="0.6"/>`;
    const nl=Math.min(6,n),lbl=[];for(let k=0;k<nl;k++)lbl.push(Math.round(k*(n-1)/(nl-1||1)));
    lbl.forEach(i=>{s+=`<text x="${cx(i)}" y="${H-4}" fill="${INK}" font-size="10" text-anchor="middle">${dates[i]}</text>`;});
    s+='</svg>';this.box.innerHTML=s;
    this._syncCtl(total,start,count);
  }
}
