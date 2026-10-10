
'use strict';const test=require('node:test');const assert=require('node:assert/strict');const m=require('../nma_master_enterprise_43');
for(let i=0;i<12;i++) test(`redact secrets ${i}`,()=>{const x=m.redact({token:'x',password:'y',cost:9,ok:i,nested:{secret:'z',v:1}});assert.equal(x.token,undefined);assert.equal(x.cost,undefined);assert.equal(x.nested.secret,undefined);assert.equal(x.ok,i)});
for(let i=0;i<10;i++) test(`readiness pass ${i}`,()=>{const r=m.readiness({mongoConnected:true,files:['a','b'],required:['a','b'],auditOk:true});assert.equal(r.status,'PASS')});
for(let i=0;i<10;i++) test(`readiness stop missing ${i}`,()=>{const r=m.readiness({mongoConnected:true,files:['a'],required:['a','b'],auditOk:true});assert.equal(r.status,'STOP');assert.deepEqual(r.missing,['b'])});
for(let i=0;i<8;i++) test(`operator permission least privilege ${i}`,()=>{assert.equal(m.permission('operatore','audit.read'),false);assert.equal(m.permission('operatore','field.write'),true)});
for(let i=0;i<8;i++) test(`admin permission ${i}`,()=>{assert.equal(m.permission('admin','audit.read'),true);assert.equal(m.permission('admin','quality.share'),true)});
for(let i=0;i<8;i++) test(`audit hash ${i}`,()=>{const h=m.auditHash({type:'X',token:'secret',n:i});assert.equal(h.length,64)});
