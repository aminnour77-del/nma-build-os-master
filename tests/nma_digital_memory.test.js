
'use strict'; const test=require('node:test'); const assert=require('node:assert/strict'); const m=require('../nma_digital_memory');
for(let i=0;i<12;i++) test(`passport hash ${i}`,()=>{const s=m.sealPassport({passportId:'P'+i,assetId:'A',materials:[{q:i}]});assert.equal(s.integrityHash.length,64)});
for(let i=0;i<12;i++) test(`roi savings ${i}`,()=>{const r=m.roi({revenue:50000,fieldBefore:15000,fieldAfter:12000,officeBefore:4000,officeAfter:2000,materialBefore:20000,materialAfter:19000,reworkBefore:1000,reworkAfter:500});assert.equal(r.saved,6500);assert.ok(r.operationalOptimizationPct>0)});
for(let i=0;i<10;i++) test(`client view hides economics ${i}`,()=>{const v=m.clientQualityView({jobId:'J',margin:999,cost:100,operator:'X',qualityScore:98});assert.equal(v.margin,undefined);assert.equal(v.operator,undefined);assert.equal(v.qualityScore,98)});
for(let i=0;i<10;i++) test(`tag payload ${i}`,()=>{const p=m.tagPayload({tagId:'T'+i,passportId:'P',buildingId:'B'});assert.equal(p.version,1);assert.equal(p.tagId,'T'+i)});
for(let i=0;i<6;i++) test(`canonical passport stable ${i}`,()=>{const p=m.canonicalPassport({passportId:'P',unknown:'x'});assert.equal(p.unknown,undefined);assert.equal(p.passportId,'P')});
