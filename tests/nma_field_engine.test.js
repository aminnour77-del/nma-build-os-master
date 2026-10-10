
'use strict';
const test=require('node:test'); const assert=require('node:assert/strict');
const m=require('../nma_field_engine');
for(let i=0;i<12;i++) test(`sha256 deterministic ${i}`,()=>{assert.equal(m.sha256({a:i}),m.sha256({a:i}));assert.equal(m.sha256({a:i}).length,64)});
for(let i=0;i<10;i++) test(`normalize RTK valid ${i}`,()=>{const p=m.normalizeSensorPacket({rtk:{lat:45+i/1000,lon:7,accuracyM:.02},camera:{ref:'c'},lidar:{ref:'l'}});assert.equal(p.rtk.fix,'unknown');assert.ok(p.hash)});
for(let i=0;i<8;i++) test(`material variance ${i}`,()=>{const x=m.materialVariance([{code:'A',qty:10,unit:'m'}],[{code:'A',qty:10+i}])[0];assert.equal(x.variance,i)});
for(let i=0;i<8;i++) test(`safety STOP ${i}`,()=>{const j={safetyZone:'atex_unknown',atexApproved:false,steps:{}};assert.equal(m.computeReadiness(j).status,'STOP');assert.equal(m.nextAction(j).code,'SAFETY_STOP')});
for(let i=0;i<7;i++) test(`anonymous best practice excludes identity ${i}`,()=>{const x=m.anonymousBestPractice({operator:'Mario',jobType:'scavo',durationMin:90,qualityScore:99});assert.equal(x.operator,undefined);assert.equal(x.jobType,'scavo')});
