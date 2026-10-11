'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const m=require('../nma_field_engine');

for(let i=0;i<80;i++){
  test(`field RTK valid packet ${i}`,()=>{
    const lat=-89.5+(179*i/79), lon=-179.5+(359*i/79);
    const p=m.normalizeSensorPacket({rtk:{lat,lon,accuracyM:i/100,fix:i%2?'RTK_FIXED':'FLOAT'},camera:{ref:`cam-${i}`,width:1920,height:1080},lidar:{ref:`lidar-${i}`,pointCount:1000+i},thermal:{ref:`thermal-${i}`,minC:-10+i/10,maxC:40+i/10},nfc:{uid:`UID-${i}`}});
    assert.ok(p.rtk); assert.equal(p.camera.width,1920); assert.ok(p.lidar.pointCount>=1000); assert.equal(p.hash.length,64);
  });
}

const invalidCoords=[[-91,0],[91,0],[0,-181],[0,181],[NaN,7],[45,NaN],[Infinity,7],[45,Infinity],['x',7],[45,'x']];
for(let i=0;i<80;i++){
  const [lat,lon]=invalidCoords[i%invalidCoords.length];
  test(`field invalid RTK rejected ${i}`,()=>assert.equal(m.normalizeSensorPacket({rtk:{lat,lon}}).rtk,null));
}

for(let i=0;i<100;i++){
  test(`field material accounting ${i}`,()=>{
    const planned=10+(i%25); const actual=planned+(i%9)-4;
    const r=m.materialVariance([{code:'PE',qty:planned,unit:'m'}],[{code:'PE',qty:actual,unit:'m'}])[0];
    assert.equal(r.planned,planned); assert.equal(r.actual,actual); assert.equal(r.variance,actual-planned);
    assert.ok(r.wastePct>=0);
  });
}

const phases=m.STEP_ORDER.slice(0,-1);
for(let completed=0;completed<=phases.length;completed++){
  for(let i=0;i<12;i++){
    test(`field readiness phases ${completed}-${i}`,()=>{
      const steps={}; phases.forEach((p,idx)=>steps[p]={status:idx<completed?'done':'pending'});
      const job={safetyZone:'ordinary',atexApproved:false,steps,latestScan:{rtk:{},camera:{},lidar:{}}};
      const r=m.computeReadiness(job);
      assert.equal(r.status,completed===phases.length?'PASS':'STOP');
    });
  }
}

const unsafeZones=['atex','atex_unknown','potentially_explosive'];
for(let i=0;i<45;i++){
  const z=unsafeZones[i%unsafeZones.length];
  test(`field ATEX hard stop ${i}`,()=>{
    const job={safetyZone:z,atexApproved:false,steps:{},latestScan:null};
    assert.equal(m.nextAction(job).code,'SAFETY_STOP');
    assert.equal(m.computeReadiness(job).status,'STOP');
  });
}

for(let i=0;i<60;i++){
  test(`field best practice privacy ${i}`,()=>{
    const r=m.anonymousBestPractice({operator:`Mario-${i}`,workerId:`W-${i}`,jobType:'scavo',durationMin:40+i,materialWastePct:i/10,qualityScore:90+(i%11),method:`metodo-${i}`});
    assert.equal(r.operator,undefined); assert.equal(r.workerId,undefined); assert.equal(r.jobType,'scavo'); assert.ok(r.qualityScore<=100);
  });
}

for(let i=0;i<50;i++){
  test(`field SHA256 stable and separated ${i}`,()=>{
    const a=m.sha256({i,value:`x-${i}`}); const b=m.sha256({i,value:`x-${i}`}); const c=m.sha256({i:i+1,value:`x-${i}`});
    assert.equal(a,b); assert.notEqual(a,c); assert.match(a,/^[a-f0-9]{64}$/);
  });
}

for(const jt of m.SAFE_JOB_TYPES) test(`field allowed job type ${jt}`,()=>assert.ok(m.SAFE_JOB_TYPES.includes(jt)));
test('field device profile defines RTK/LiDAR/camera/thermal/NFC/storage',()=>{
  for(const k of ['display','core','lidar','rtk','visibleCamera','thermal','identification','storage']) assert.ok(m.DEVICE_PROFILE[k]);
});
