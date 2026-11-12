// Field versions merge independent edits; explicit tombstones prevent deleted items returning.
const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
const key=path=>JSON.stringify(path);
const clone=value=>JSON.parse(JSON.stringify(value));
export function canonical(value){if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';if(value&&typeof value==='object')return '{'+Object.keys(value).filter(k=>value[k]!==undefined).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';return JSON.stringify(value)}
export function emptyModel(){return {version:1,fields:{}}}
export function normalizeModel(value){if(!value||value.version!==1||!value.fields||typeof value.fields!=='object'||Array.isArray(value.fields))throw Error('云端数据格式不正确，未替换本机数据');const fields={};for(const [id,entry] of Object.entries(value.fields)){let path;try{path=JSON.parse(id)}catch{throw Error('同步字段格式不正确')}if(!Array.isArray(path)||path.length>40||path.some(p=>typeof p!=='string'||p.length>300)||!entry||!Number.isFinite(entry.at)||typeof entry.by!=='string'||(!entry.deleted&&!own(entry,'value')))throw Error('同步字段格式不正确');fields[id]=clone(entry)}return {version:1,fields}}
export function compare(a,b){if(!a)return -1;if(!b)return 1;return a.at-b.at||(a.by<b.by?-1:a.by>b.by?1:0)||(canonical(a)<canonical(b)?-1:canonical(a)>canonical(b)?1:0)}
export function latest(model){return Object.values(model.fields).reduce((n,e)=>Math.max(n,e.at),0)}
export function merge(a,b){const fields={...a.fields};for(const [id,entry] of Object.entries(b.fields))if(!fields[id]||compare(entry,fields[id])>0)fields[id]=entry;return {version:1,fields}}
export function flatten(value){const fields={};function visit(node,path){if(Array.isArray(node)&&node.every(item=>item&&typeof item==='object'&&!Array.isArray(item)&&typeof item.id==='string')){fields[key([...path,'$kind'])]='list';fields[key([...path,'$order'])]=node.map(item=>item.id);for(const item of node){const p=[...path,'$item',item.id];fields[key([...p,'$exists'])]=true;for(const [name,v] of Object.entries(item))if(name!=='id'&&v!==undefined)visit(v,[...p,name])}return}if(Array.isArray(node)){fields[key([...path,'$kind'])]='array';fields[key([...path,'$length'])]=node.length;node.forEach((item,i)=>visit(item,[...path,'$index',String(i)]));return}if(node&&typeof node==='object'&&!Array.isArray(node)){fields[key([...path,'$kind'])]='object';for(const [name,v] of Object.entries(node))if(v!==undefined)visit(v,[...path,name]);return}fields[key([...path,'$kind'])]='value';fields[key([...path,'$value'])]=node}visit(value,[]);return fields}
export function reconcile(model,before,after,stamp){const a=flatten(before),b=flatten(after),fields={...model.fields},changed=[];for(const id of new Set([...Object.keys(a),...Object.keys(b)])){if(own(a,id)&&own(b,id)&&canonical(a[id])===canonical(b[id])&&own(fields,id))continue;const entry=own(b,id)?{...stamp,value:b[id]}:{...stamp,deleted:true};fields[id]=entry;changed.push(id)}return {model:{version:1,fields},changed}}
export function seedMissing(model,value,stamp){const fields={...model.fields},changed=[];for(const [id,v] of Object.entries(flatten(value)))if(!own(fields,id)){fields[id]={...stamp,value:v};changed.push(id)}return {model:{version:1,fields},changed}}
export function rebase(model,paths,stamp){const fields={...model.fields};for(const id of paths)if(fields[id])fields[id]={...fields[id],...stamp};return {version:1,fields}}
export function materialize(model){
 const root={children:new Map()};
 for(const [id,entry] of Object.entries(model.fields)){let node=root;for(const part of JSON.parse(id)){if(!node.children.has(part))node.children.set(part,{children:new Map()});node=node.children.get(part)}node.entry=entry}
 const scalar=node=>node?.entry&&!node.entry.deleted?node.entry.value:undefined;
 function object(node,id){const pairs=id===undefined?[]:[['id',id]];for(const [name,child] of node.children){if(name.startsWith('$'))continue;const value=visit(child);if(value!==undefined)pairs.push([name,value])}return Object.fromEntries(pairs)}
 function visit(node){if(!node)return undefined;const kind=scalar(node.children.get('$kind'));
  if(kind==='list'){const order=scalar(node.children.get('$order'))||[];if(!Array.isArray(order))throw Error('同步排序格式不正确');const items=node.children.get('$item')?.children||new Map();const live=[...items].filter(([,item])=>scalar(item.children.get('$exists'))===true).map(([id])=>id);const sorted=[...order.filter(id=>live.includes(id)),...live.filter(id=>!order.includes(id)).sort()];return [...new Set(sorted)].map(id=>object(items.get(id),id))}
  if(kind==='array'){const length=scalar(node.children.get('$length'))||0;if(!Number.isSafeInteger(length)||length<0||length>10000)throw Error('同步数组格式不正确');return Array.from({length},(_,i)=>visit(node.children.get('$index')?.children.get(String(i))))}
  if(kind==='object')return object(node);
  return scalar(node.children.get('$value'));
 }
 return visit(root)||{projects:[]};
}
// Current selection stays device-local; iframe item data is derived from stages.
export function workspaceForSync(state){
 const notes=value=>Array.isArray(value)&&value.length?clone(value):Array.from({length:12},()=>({title:'',rows:Array.from({length:3},()=>['',''])}));
 const simplifyDrawing=d=>d?{pageNotes:notes(d.pageNotes),keysById:Object.fromEntries((d.items||[]).filter(i=>i.keys).map(i=>[i.id,i.keys]))}:undefined;
 return {trash:clone(state.trash||[]),projects:state.projects.filter(p=>!(p.example&&!p.stages.length&&!p.flows?.length)).map(p=>{const copy=clone(p);delete copy.activeFlow;if(copy.flows?.length){delete copy.stages;copy.flows=copy.flows.map(f=>({...f,drawingData:simplifyDrawing(f.drawingData)}))}else copy.drawingData=simplifyDrawing(copy.drawingData);return copy})};
}
export function restoreWorkspace(value){
 if(!value||!Array.isArray(value.projects)||value.projects.length>1000)throw Error('同步内容格式不正确');
 const projects=clone(value.projects);
 for(const p of projects){
  if(typeof p.id!=='string'||typeof p.name!=='string')throw Error('同步项目格式不正确');
  for(const target of p.flows?.length?p.flows:[p]){
   if(!Array.isArray(target.stages)||target.stages.some(s=>!s||typeof s.id!=='string'||typeof s.title!=='string'||!Array.isArray(s.tasks)||!Array.isArray(s.notes)))throw Error('同步节点格式不正确');
   if(target.drawingData){const data=target.drawingData;target.drawingData={pageNotes:data.pageNotes||[],items:target.stages.map(s=>({id:s.id,title:s.title,category:s.category||'未分类',done:s.status==='done',inactive:!!s.inactive,dueDate:s.dueDate||'',notes:s.remark||'',keys:data.keysById?.[s.id]||''}))}}
  }
  if(p.flows?.length){p.activeFlow=p.flows[0].id;p.stages=p.flows[0].stages}
 }
 return {projects,trash:Array.isArray(value.trash)?clone(value.trash):[]};
}
export const cleanCode=value=>String(value||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,24);
export function generateCode(){const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';return Array.from(crypto.getRandomValues(new Uint8Array(20)),b=>alphabet[b%32]).join('')}
export async function documentId(code){const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode('project-flowline:'+cleanCode(code)));return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('').slice(0,24)}
export async function encryptionKey(code){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode('flowline-encryption-v1:'+cleanCode(code)));return crypto.subtle.importKey('raw',bytes,'AES-GCM',false,['encrypt','decrypt'])}
const base64=bytes=>{let text='';for(let i=0;i<bytes.length;i+=8192)text+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(text)};
const unbase64=value=>Uint8Array.from(atob(value),c=>c.charCodeAt(0));
async function gzip(bytes){if(globalThis.fflate?.gzipSync)return globalThis.fflate.gzipSync(bytes);if(typeof CompressionStream==='function')return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());return null}
async function gunzip(bytes){if(globalThis.fflate?.gunzipSync)return globalThis.fflate.gunzipSync(bytes);if(typeof DecompressionStream==='function')return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());throw Error('此浏览器无法读取压缩同步数据')}
export async function encrypt(model,key){let bytes=new TextEncoder().encode(JSON.stringify(model)),compression='none';if(bytes.length>8000000)throw Error('同步空间已接近容量上限，本机数据已保留，请先导出备份');const packed=await gzip(bytes);if(packed&&packed.length<bytes.length){bytes=packed;compression='gzip'}if(bytes.length>650000)throw Error('同步空间已接近容量上限，本机数据已保留，请先导出备份');const iv=crypto.getRandomValues(new Uint8Array(12)),data=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,bytes);return {format:'flowline-aesgcm-v1',compression,iv:base64(iv),data:base64(new Uint8Array(data))}}
export async function decrypt(value,key){if(!value)return emptyModel();if(value.format!=='flowline-aesgcm-v1'||typeof value.iv!=='string'||typeof value.data!=='string')throw Error('云端同步格式不匹配，本机数据未更改');try{let bytes=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:unbase64(value.iv)},key,unbase64(value.data)));if(value.compression==='gzip')bytes=await gunzip(bytes);if(bytes.length>8000000)throw Error('同步数据超过容量');return normalizeModel(JSON.parse(new TextDecoder().decode(bytes)))}catch{throw Error('无法读取云端内容，请检查同步码；本机数据未更改')}}
