if(process.env.FLOWLINE_LIVE_TEST!=='1')throw Error('Set FLOWLINE_LIVE_TEST=1 to run the disposable live-service test');
import assert from 'node:assert/strict';
import {initializeApp,deleteApp} from 'firebase/app';
import {getAuth,signInAnonymously} from 'firebase/auth';
import {getFirestore,doc,getDocFromServer,setDoc,deleteDoc,terminate,runTransaction} from 'firebase/firestore';
import {readFile} from 'node:fs/promises';
import {generateCode,documentId,encryptionKey,encrypt,decrypt,emptyModel,seedMissing,materialize} from '../cloud/model.mjs';
import {prepareStorage,readStorage} from '../cloud/storage.mjs';

const source=await readFile(new URL('../cloud/client.mjs',import.meta.url),'utf8');
const config=Object.fromEntries([...source.match(/const config=(\{[^\n]+\});/)[1].matchAll(/(\w+):'([^']*)'/g)].map(([,key,value])=>[key,value]));
const a=initializeApp(config,'flowline-test-a-'+Date.now());
const b=initializeApp(config,'flowline-test-b-'+Date.now());
let dbA,dbB;
const created=new Map();
try{
 await Promise.all([signInAnonymously(getAuth(a)),signInAnonymously(getAuth(b))]);
 dbA=getFirestore(a);dbB=getFirestore(b);
 const code=generateCode(),id=await documentId(code),key=await encryptionKey(code);
 const root=doc(dbA,'syncSpaces',id),readerRoot=doc(dbB,'syncSpaces',id);
 const workspace={projects:[
  {id:'synthetic',name:'同步连接验证',stages:[]},
  {id:'synthetic-template',name:'合成模板',isTemplate:true,stages:[]}
 ],trash:[{id:'trash-1',kind:'项目',item:{id:'removed',name:'合成回收站',stages:[]}}]};
 const model=seedMissing(emptyModel(),workspace,{at:Date.now(),by:'test'}).model;
 const legacy=await encrypt(model,key);
 await setDoc(root,{flowline:legacy});
 created.set(root.path,root);
 await runTransaction(dbA,async tx=>{
  const storage=await readStorage(dbA,await tx.get(root),key,ref=>tx.get(ref));
  assert.deepEqual(materialize(storage.model),workspace);
  const prepared=await prepareStorage(dbA,id,key,storage.model,storage);
  for(const {ref,encrypted} of prepared.writes){tx.set(ref,{flowline:encrypted});created.set(ref.path,ref)}
  tx.set(root,{flowline:prepared.manifest});
 });
 const snapshot=await getDocFromServer(readerRoot);
 const pulled=await readStorage(dbB,snapshot,key,getDocFromServer);
 assert.deepEqual(materialize(pulled.model),workspace);
 const backups=await Promise.all([...created.values()].filter(ref=>ref.path!==root.path).map(getDocFromServer));
 const backup=backups.find(item=>item.data()?.flowline?.iv===legacy.iv);
 assert.deepEqual(materialize(await decrypt(backup?.data().flowline,key)),workspace);
 console.log('PASS: Firebase accepted atomic migration, second-device read, and retained legacy backup');
}finally{
 await Promise.allSettled([...created.values()].map(deleteDoc));
 if(dbA)await terminate(dbA);
 if(dbB)await terminate(dbB);
 await Promise.all([deleteApp(a),deleteApp(b)]);
}
