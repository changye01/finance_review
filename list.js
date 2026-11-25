/* 共享列表口径：index 渲染与 detail 上下翻页必须一致，避免两处逻辑漂移 */
export function orderedList(M, ctx){
  const view=ctx.view||'pool',layer=ctx.layer||'__all',
        probeFilter=ctx.probeFilter||'all',sortKey=ctx.sortKey||null,sortDir=ctx.sortDir||1,
        query=(ctx.query||'').trim().toLowerCase();
  let a;
  if(view==='probe'){
    a=(M.probe||[]).slice();
    if(probeFilter==='fresh')a=a.filter(x=>x.fresh);
    else if(probeFilter==='green')a=a.filter(x=>x.band&&x.band.indexOf('🟢')>=0);
    else if(probeFilter==='back')a=a.filter(x=>x.band&&x.band.indexOf('⚪')>=0);
  }else if(view==='four'){
    a=(M.four||[]).slice();
    if(probeFilter==='fresh')a=a.filter(x=>x.fresh);
    else if(probeFilter&&probeFilter.indexOf('miss')===0)a=a.filter(x=>x.miss===probeFilter.slice(4));
  }else{
    a=(M.stocks||[]).slice();
    if(layer!=='__all')a=a.filter(x=>x.layer===layer);
  }
  if(query)a=a.filter(x=>(x.name||'').toLowerCase().includes(query)||(x.code||'').toLowerCase().includes(query));
  if(sortKey)a.sort((x,y)=>{
    let vx=x[sortKey],vy=y[sortKey];if(vx==null)vx='';if(vy==null)vy='';
    if(typeof vx==='string'||typeof vy==='string')return String(vx).localeCompare(String(vy),'zh')*sortDir;
    return (vx-vy)*sortDir;
  });
  return a;
}
