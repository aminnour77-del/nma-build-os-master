#!/usr/bin/env node
'use strict';
const {spawnSync}=require('child_process'); const fs=require('fs'); const path=require('path');
const root=process.cwd();
const required=['server.js','nma_field_engine.js','field_x1_v1.html','nma_digital_memory.js','digital_memory_v1.html','nma_master_enterprise_43.js','master_43.html','tests/nma_field_engine.test.js','tests/nma_digital_memory.test.js','tests/nma_master_gate.test.js'];
let fail=0; function ok(cond,msg){process.stdout.write(`${cond?'✅':'❌'} ${msg}\n`); if(!cond)fail++}
for(const f of required) ok(fs.existsSync(path.join(root,f))&&fs.statSync(path.join(root,f)).size>0,`file ${f}`);
const server=fs.readFileSync(path.join(root,'server.js'),'utf8');
for(const m of ['NMA-BUILD-MASTER-4.1-FIELD','NMA-BUILD-MASTER-4.2-MEMORY','NMA-BUILD-MASTER-4.3-ENTERPRISE']) ok(server.includes(m),`marker ${m}`);
for(const f of ['server.js','nma_field_engine.js','nma_digital_memory.js','nma_master_enterprise_43.js']){const r=spawnSync(process.execPath,['--check',f],{encoding:'utf8'});ok(r.status===0,`syntax ${f}`);if(r.status!==0)process.stdout.write(r.stderr||r.stdout)}
const tests=['tests/nma_field_engine.test.js','tests/nma_digital_memory.test.js','tests/nma_master_gate.test.js'];
if(fs.existsSync('tests/nma_enterprise_master.test.js'))tests.push('tests/nma_enterprise_master.test.js');
const tr=spawnSync(process.execPath,['--test','--test-reporter=tap',...tests],{encoding:'utf8',maxBuffer:20_000_000});process.stdout.write(tr.stdout||'');process.stderr.write(tr.stderr||'');
const mt=(tr.stdout||'').match(/# tests (\d+)/g); const mp=(tr.stdout||'').match(/# pass (\d+)/g); const mf=(tr.stdout||'').match(/# fail (\d+)/g); const last=a=>a?Number(a[a.length-1].split(' ').pop()):0; const count=last(mt), pass=last(mp), tfail=last(mf);
ok(tr.status===0,'node:test exit 0');ok(count>=100,`mega gate >=100 test (${count})`);ok(tfail===0,`0 test fail (${tfail})`);ok(pass===count&&count>0,`all tests pass (${pass}/${count})`);
const forbidden=['.env','BEGIN PRIVATE KEY']; const ownFiles=['nma_field_engine.js','nma_digital_memory.js','nma_master_enterprise_43.js','field_x1_v1.html','digital_memory_v1.html','master_43.html'];for(const f of ownFiles){const s=fs.readFileSync(f,'utf8');for(const x of forbidden)ok(!s.includes(x),`${f} no embedded ${x}`)}
console.log(`\nNMA BUILD OS MASTER 4.3 — ${fail===0?'MEGA COLLAUDO SUPERATO':'MEGA COLLAUDO FALLITO'}`);process.exit(fail?1:0);
