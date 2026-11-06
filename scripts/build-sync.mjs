import {build} from 'esbuild';
import {readFile} from 'node:fs/promises';
const common={bundle:true,format:'iife',platform:'browser',target:['safari15','es2020'],minify:true,legalComments:'eof'};
await build({...common,entryPoints:['cloud/client.mjs'],globalName:'FlowlineCloud',outfile:'cloud-sync.js'});
const html=await readFile('index.html','utf8'),compression=html.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1];
await build({...common,entryPoints:['cloud/reader.mjs'],globalName:'FlowlineReader',outfile:'flowline-reader.js',banner:{js:compression}});
