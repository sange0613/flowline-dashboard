import {doc} from 'firebase/firestore';
import {canonical,decrypt,emptyModel,encrypt} from './model.mjs';

const manifestFormat='flowline-sharded-v1';
const manifestKey='["shards"]';
const collection='syncSpaces';

async function refFor(db,id,partition){
 const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(['flowline-storage-v1',id,partition])));
 const token=Array.from(new Uint8Array(hash).subarray(0,12),byte=>byte.toString(16).padStart(2,'0')).join('');
 return {token,ref:doc(db,collection,token)};
}

function partitionModel(model){
 const parts=new Map();
 for(const [field,record] of Object.entries(model.fields)){
  const [group,kind,item]=JSON.parse(field);
  const name=kind==='$item'&&group==='projects'?'project:'+item:
   kind==='$item'&&group==='trash'?'trash:'+item.slice(0,1):'workspace';
  if(!parts.has(name))parts.set(name,emptyModel());
  parts.get(name).fields[field]=record;
 }
 return parts;
}

export async function readStorage(db,snapshot,key,get){
 const payload=snapshot.exists()?snapshot.data().flowline:null;
 if(payload?.format!==manifestFormat)return {model:await decrypt(payload,key),legacy:payload,shards:new Map()};
 const index=await decrypt({...payload,format:'flowline-aesgcm-v1'},key);
 const entries=index.fields[manifestKey]?.value;
 if(!Array.isArray(entries)||entries.length>480||entries.some(entry=>!Array.isArray(entry)||entry.length!==2||!/^[0-9a-f]{24}$/.test(entry[0])||typeof entry[1]!=='string')||new Set(entries.map(entry=>entry[0])).size!==entries.length){
  throw Error('同步目录格式不正确');
 }
 const shards=new Map(await Promise.all(entries.map(async([token,iv])=>{
  const shard=await get(doc(db,collection,token));
  const encrypted=shard.exists()?shard.data().flowline:null;
  if(encrypted?.iv!==iv)throw Error('同步数据分片尚未就绪');
  return [token,{iv,model:await decrypt(encrypted,key)}];
 })));
 const model=emptyModel();
 for(const entry of shards.values())Object.assign(model.fields,entry.model.fields);
 return {model,legacy:null,shards};
}

export async function prepareStorage(db,id,key,model,previous){
 const partitions=partitionModel(model);
 if(partitions.size>480)throw Error('同步分片数量超过容量上限，本机资料已保留');
 const writes=[];
 const entries=await Promise.all([...partitions].map(async([name,part])=>{
  const {token,ref}=await refFor(db,id,name);
  const old=previous.shards.get(token);
  if(old&&canonical(old.model)===canonical(part))return [token,old.iv];
  const encrypted=await encrypt(part,key);
  writes.push({ref,encrypted});
  return [token,encrypted.iv];
 }));
 if(previous.legacy){
  const {ref}=await refFor(db,id,'legacy-backup');
  writes.push({ref,encrypted:previous.legacy});
 }
 const index={version:1,fields:{[manifestKey]:{at:0,by:'layout',value:entries}}};
 const manifest=await encrypt(index,key);
 return {writes,manifest:{...manifest,format:manifestFormat}};
}
