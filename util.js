/* 共享工具：颜色、格式化、发布站鉴权与带重试的 fetch */
export const UP='#f5222d',DOWN='#52c41a',INK='#aab6cc',GRID='#2b3548';

export const fmt=(x,d=1)=>x==null?'—':Number(x).toFixed(d);
export const cls=x=>x==null?'':(x>0?'pos':x<0?'neg':'');
export const sgn=(x,d=1)=>x==null?'—':(x>0?'+':'')+Number(x).toFixed(d);
export const bandCls=b=>b&&b.indexOf('🟢')>=0?'band-green':(b&&b.indexOf('🟡')>=0?'band-amber':'band-gray');

/* WorkBuddy 发布站用 sharecode 鉴权；Cloudflare 上无 sharecode → 干净相对路径 */
export const SHARE=(new URLSearchParams(location.search)).get('sharecode')||'';
export const resUrl=(p,nonce)=>{const q=[];if(SHARE){q.push('sharecode='+encodeURIComponent(SHARE));if(nonce!=null)q.push('_r='+nonce);}return q.length?p+(p.indexOf('?')>=0?'&':'?')+q.join('&'):p;};

/* 静态托管偶发半包/截断；force-cache 会把坏响应永久缓存 → no-store + 每次带 nonce 重试 + 内容校验 */
export async function fetchJSON(path,validate,tries){
  tries=tries||6;let last;
  for(let i=0;i<tries;i++){
    try{
      const r=await fetch(resUrl(path,Date.now()+'_'+i),{cache:'no-store'});
      if(!r.ok)throw new Error('HTTP '+r.status);
      const d=await r.json();
      if(validate&&!validate(d))throw new Error('数据不完整');
      return d;
    }catch(e){last=e;if(i<tries-1)await new Promise(ok=>setTimeout(ok,180*(i+1)));}
  }
  throw last;
}

/* 分片版本缓存：key 用 meta.generated_at 失效；上限 24 片防止撑爆 localStorage */
const CK='qb_shard_cache',MAX_SHARDS=24;
const readShardCache=()=>{try{return JSON.parse(localStorage.getItem(CK)||'{}');}catch(_){return {};}};
export function fetchShard(path,version,validate){
  const c=readShardCache(),hit=c[path];
  if(hit&&hit.v===version&&(!validate||validate(hit.d)))return Promise.resolve(hit.d);
  return fetchJSON(path,validate).then(d=>{
    try{
      const keys=Object.keys(c);
      while(keys.length>=MAX_SHARDS)delete c[keys.shift()];
      c[path]={v:version,d};
      localStorage.setItem(CK,JSON.stringify(c));
    }catch(_){}
    return d;
  });
}
export function clearShardCache(){try{localStorage.removeItem(CK);}catch(_){}}
