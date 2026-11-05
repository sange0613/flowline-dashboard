if(process.env.FLOWLINE_LIVE_TEST!=='1')throw Error('Set FLOWLINE_LIVE_TEST=1 to run the disposable live-service test');
import {initializeApp,deleteApp} from 'firebase/app';
import {getAuth,signInAnonymously} from 'firebase/auth';
import {getFirestore,doc,getDocFromServer,setDoc,deleteDoc,terminate} from 'firebase/firestore';
import {readFile} from 'node:fs/promises';
import {generateCode,documentId,encryptionKey,encrypt,decrypt,emptyModel,seedMissing,materialize} from '../cloud/model.mjs';
const source=await readFile(new URL('../cloud/client.mjs',import.meta.url),'utf8');const config=Function('return '+source.match(/const config=(\{[^\n]+\});/)[1])();
const a=initializeApp(config,'flowline-test-a-'+Date.now()),b=initializeApp(config,'flowline-test-b-'+Date.now());let dbA,dbB,refA;
try{await Promise.all([signInAnonymously(getAuth(a)),signInAnonymously(getAuth(b))]);dbA=getFirestore(a);dbB=getFirestore(b);const code=generateCode(),id=await documentId(code),key=await encryptionKey(code);refA=doc(dbA,'syncSpaces',id);const refB=doc(dbB,'syncSpaces',id);const model=seedMissing(emptyModel(),{projects:[{id:'synthetic',name:'同步连接验证',stages:[]}]},{at:Date.now(),by:'test'}).model;await setDoc(refA,{flowline:await encrypt(model,key)});const received=await getDocFromServer(refB);const value=materialize(await decrypt(received.data().flowline,key));if(value.projects[0].id!=='synthetic')throw Error('roundtrip failed');console.log('PASS: existing Firebase service accepts encrypted writes and reads across two anonymous devices');}finally{if(refA)await deleteDoc(refA);if(dbA)await terminate(dbA);if(dbB)await terminate(dbB);await Promise.all([deleteApp(a),deleteApp(b)])}
