import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync,gunzipSync} from 'node:zlib';
import {encodeCache,decodeCache} from '../cloud/cache.mjs';
const codec={gzipSync,gunzipSync};
test('compressed cache preserves workspace, pending changes and deletion versions',()=>{const value={model:{version:1,fields:Object.fromEntries(Array.from({length:250},(_,i)=>['field-'+i,{at:12345,by:'device',value:'项目备注与待办内容'.repeat(10)}]))},visible:{projects:[{id:'p',name:'项目',stages:[]}]},pending:['待同步字段'],deleted:{at:12345,by:'device'}};const packed=encodeCache(value,codec);assert(packed.startsWith('flowline-cache-gzip-v1:'));assert(packed.length<JSON.stringify(value).length/5);assert.deepEqual(decodeCache(packed,codec),value)});
test('existing plain JSON cache remains readable',()=>{const value={model:{version:1,fields:{}},visible:{projects:[]},pending:[]};assert.deepEqual(decodeCache(JSON.stringify(value),codec),value);assert.deepEqual(decodeCache(encodeCache(value,null),null),value);assert.equal(decodeCache(null,codec),null)});
