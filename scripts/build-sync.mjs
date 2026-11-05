import {build} from 'esbuild';
await build({entryPoints:['cloud/client.mjs'],bundle:true,format:'iife',globalName:'FlowlineCloud',platform:'browser',target:['safari15','es2020'],outfile:'cloud-sync.js',minify:true,legalComments:'eof'});
