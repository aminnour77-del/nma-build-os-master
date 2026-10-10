import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root=process.argv[2]||process.cwd();
const required=['server.js','master_control_v1.html','nma_master_final.js','package.json'];
for(const f of required){if(!fs.existsSync(path.join(root,f)))throw new Error(`Manca ${f}`);}
const html=fs.readFileSync(path.join(root,'master_control_v1.html'),'utf8');
for(const marker of ['NMA BUILD OS MASTER','/api/master/final/summary','/api/master/final/map','Mappa operativa cantieri e rete gas','Workflow operatore sul campo']){if(!html.includes(marker))throw new Error(`Dashboard marker mancante: ${marker}`);}
const server=fs.readFileSync(path.join(root,'server.js'),'utf8');
if(!server.includes('NMA-MASTER-FINAL-MODULE-v1'))throw new Error('Modulo finale non collegato a server.js');
const moduleText=fs.readFileSync(path.join(root,'nma_master_final.js'),'utf8');
for(const marker of ['/api/master/final/summary','/api/master/final/collaudi','/api/master/final/cantieri','/api/master/final/map','/api/master/final/asset','/api/master/final/logs']){if(!moduleText.includes(marker))throw new Error(`Endpoint marker mancante: ${marker}`);}
console.log('NMA BUILD OS MASTER FINAL — STATIC SMOKE PASS');
