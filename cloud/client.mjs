import {initializeApp,getApps,getApp} from 'firebase/app';
import {getAuth,signInAnonymously} from 'firebase/auth';
import {getFirestore,doc,getDocFromServer,onSnapshot,runTransaction,serverTimestamp} from 'firebase/firestore';
import {canonical,emptyModel,normalizeModel,merge,reconcile,seedMissing,rebase,materialize,latest,workspaceForSync,restoreWorkspace,cleanCode,generateCode,documentId,encryptionKey,encrypt,decrypt} from './model.mjs';
export {cleanCode,generateCode};
// Public Firebase web-app configuration reused from the user's existing sync service.
const config={apiKey:'AIzaSyDbLCcDs-Gk6ev2zSUT4cdYAgvpqUzSUEY',authDomain:'daily-calorie-tracker-3ec47.firebaseapp.com',projectId:'daily-calorie-tracker-3ec47',appId:'1:197589959166:web:711ca2487ef48c9c42c0af'};
const CODE_KEY='flowline.cloud.code.v1',DEVICE_KEY='flowline.cloud.device.v1';
const copy=value=>JSON.parse(JSON.stringify(value));
const sameRecord=(a,b)=>canonical(a?.value)===canonical(b?.value)&&!!a?.deleted===!!b?.deleted;
export function createSyncClient(api){
 let session=null,generation=0,display='尚未连接',retryTimer,disposed=false;
 let device=localStorage.getItem(DEVICE_KEY)||crypto.randomUUID();localStorage.setItem(DEVICE_KEY,device);
 const status=message=>{display=message;api.status(message)};
 const stamp=s=>({at:Math.max(Date.now(),latest(s.model)+1),by:device});
 const persist=s=>{try{localStorage.setItem('flowline.cloud.cache.'+s.id,JSON.stringify({model:s.model,visible:s.visible,pending:[...s.pending]}))}catch{status('本机同步缓存空间不足，请导出备份')}};
 const isCurrent=s=>session===s&&!s.closed&&!disposed;
 function capture(s){if(!isCurrent(s))return;const next=workspaceForSync(api.read()),change=reconcile(s.model,s.visible,next,stamp(s));s.visible=copy(next);if(change.changed.length){s.model=change.model;for(const id of change.changed)s.pending.add(id);s.revision++;persist(s);schedule(s)}else persist(s)}
 function paint(s){if(!isCurrent(s)||api.busy())return;const next=materialize(s.model);restoreWorkspace(next);if(canonical(next)!==canonical(workspaceForSync(api.read()))){api.apply(restoreWorkspace(next));s.visible=copy(workspaceForSync(api.read()));persist(s)}}
 function receive(s,remote){const before=s.model;let merged=merge(before,remote);const pending=[...s.pending].filter(id=>before.fields[id]&&!sameRecord(before.fields[id],remote.fields[id]));const nextStamp={at:Math.max(Date.now(),latest(merged)+1),by:device};for(const id of pending)merged.fields[id]={...before.fields[id],...nextStamp};s.model=merged;persist(s);paint(s)}
 function schedule(s,delay=1400){if(!isCurrent(s))return;clearTimeout(s.timer);status(navigator.onLine?'有修改待同步':'离线 · 已保存在本机');s.timer=setTimeout(()=>{s.timer=null;void push(s)},delay)}
 function retry(s){if(!isCurrent(s))return;s.retry=Math.min((s.retry||2500)*2,60000);clearTimeout(s.timer);s.timer=setTimeout(()=>{s.timer=null;void push(s)},s.retry)}
 async function push(s){if(!isCurrent(s)||!s.ready)return;if(!navigator.onLine){status('离线 · 已保存在本机');return}if(s.uploading){s.again=true;return}s.uploading=true;s.again=false;const pendingModel=copy(s.model),pendingPaths=[...s.pending];status('正在同步');try{
  const committed=await runTransaction(s.db,async transaction=>{const snapshot=await transaction.get(s.document);const remote=snapshot.exists()?await decrypt(snapshot.data().flowline,s.key):emptyModel();const changeStamp={at:Math.max(Date.now(),latest(remote)+1,latest(pendingModel)+1),by:device};const next=merge(remote,rebase(pendingModel,pendingPaths,changeStamp));restoreWorkspace(materialize(next));if(canonical(next)!==canonical(remote)){const encrypted=await encrypt(next,s.key);transaction.set(s.document,{flowline:encrypted,updatedAt:serverTimestamp()},{merge:true})}return next});
  if(!isCurrent(s))return;const localBefore=s.model;for(const id of pendingPaths)if(sameRecord(localBefore.fields[id],pendingModel.fields[id]))s.pending.delete(id);let next=merge(localBefore,committed);const remainingStamp={at:Math.max(Date.now(),latest(next)+1),by:device};for(const id of s.pending)if(localBefore.fields[id])next.fields[id]={...localBefore.fields[id],...remainingStamp};s.model=next;s.retry=2500;persist(s);paint(s);status(s.pending.size?'有修改待同步':'已同步');
 }catch(error){if(isCurrent(s)){status(error.message?.includes('容量')?error.message:navigator.onLine?'同步未成功 · 本机已保存，稍后重试':'离线 · 已保存在本机');retry(s)}}finally{s.uploading=false;if(isCurrent(s)&&(s.pending.size||s.again)&&!s.timer)schedule(s,s.retry)}}
 function stop(){generation++;clearTimeout(retryTimer);if(session){session.closed=true;clearTimeout(session.timer);session.unsubscribe?.()}session=null}
 async function connect(raw,{remember=true}={}){const code=cleanCode(raw);if(code.length<12)throw Error('同步码至少需要12位字母或数字');stop();const token=generation;status('正在连接');if(remember)localStorage.setItem(CODE_KEY,code);
  try{const name='flowline-cloud-sync',app=getApps().some(a=>a.name===name)?getApp(name):initializeApp(config,name);const auth=getAuth(app);if(!auth.currentUser)await signInAnonymously(auth);if(token!==generation||disposed)return;
   const id=await documentId(code),key=await encryptionKey(code);if(token!==generation)return;const db=getFirestore(app),document=doc(db,'syncSpaces',id);let cached;try{cached=JSON.parse(localStorage.getItem('flowline.cloud.cache.'+id))}catch{}
   const visible=workspaceForSync(api.read());const s={code,id,key,db,document,model:emptyModel(),visible:copy(visible),pending:new Set(),revision:0,ready:false,closed:false,retry:2500};session=s;
   if(cached?.model){s.model=normalizeModel(cached.model);s.pending=new Set((cached.pending||[]).filter(id=>s.model.fields[id]));const change=reconcile(s.model,cached.visible||materialize(s.model),visible,stamp(s));s.model=change.model;change.changed.forEach(id=>s.pending.add(id))}
   else{s.seed=copy(visible)}
   const snapshot=await getDocFromServer(document);if(!isCurrent(s))return;const remote=snapshot.exists()?await decrypt(snapshot.data().flowline,key):emptyModel();if(s.seed){const current=workspaceForSync(api.read()),baseStamp={at:Math.max(Date.now(),latest(remote)+1),by:device};const seeded=seedMissing(remote,current,baseStamp);const early=reconcile(seeded.model,s.seed,current,{at:baseStamp.at+1,by:device});s.model=early.model;s.pending=new Set([...seeded.changed,...early.changed]);s.visible=copy(current);delete s.seed}else receive(s,remote);
   s.ready=true;persist(s);paint(s);
   // Serialize async decryption so an older snapshot never paints after a newer one.
   s.queue=Promise.resolve();s.unsubscribe=onSnapshot(document,{includeMetadataChanges:true},snapshot=>{if(!isCurrent(s)||snapshot.metadata.hasPendingWrites||snapshot.metadata.fromCache)return;s.queue=s.queue.then(async()=>{const remote=snapshot.exists()?await decrypt(snapshot.data().flowline,key):emptyModel();if(!isCurrent(s))return;receive(s,remote);if(s.pending.size||canonical(s.model)!==canonical(remote))schedule(s);else if(!s.uploading)status('已同步')}).catch(error=>{if(isCurrent(s))status(error.message)})},()=>{if(isCurrent(s)){status('连接中断 · 本机数据已保留');s.unsubscribe?.();retryTimer=setTimeout(()=>{if(isCurrent(s))void connect(code,{remember:false})},5000)}});
   if(s.pending.size||canonical(s.model)!==canonical(remote))await push(s);else status('已同步');
  }catch(error){if(token!==generation)return;status(error.message?.includes('格式')||error.message?.includes('同步码')?error.message:navigator.onLine?'连接未成功 · 本机已保存，稍后重试':'离线 · 已保存在本机');retryTimer=setTimeout(()=>{if(token===generation&&!disposed)void connect(code,{remember:false})},10000)}
 }
 function changed(){if(session){capture(session)}}
 function disconnect(){stop();localStorage.removeItem(CODE_KEY);status('已断开 · 数据保留在本机')}
 function flush(){if(session){capture(session);paint(session);if(session.pending.size)void push(session)}}
 window.addEventListener('online',()=>{const code=localStorage.getItem(CODE_KEY);if(code)void connect(code,{remember:false})});
 window.addEventListener('offline',()=>{if(session)status('离线 · 已保存在本机')});
 window.addEventListener('focus',flush);document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')flush()});
 document.addEventListener('focusout',()=>setTimeout(()=>{if(session)paint(session)},0));document.querySelectorAll('dialog').forEach(d=>d.addEventListener('close',()=>setTimeout(flush,0)));window.addEventListener('dragend',()=>setTimeout(flush,0));
 window.addEventListener('storage',event=>{if(event.key===CODE_KEY){const code=localStorage.getItem(CODE_KEY);if(code)void connect(code,{remember:false});else{stop();status('尚未连接')}}});
 return {connect,disconnect,changed,flush,status:()=>display,connected:()=>!!session?.ready,dispose(){stop();disposed=true}};
}
