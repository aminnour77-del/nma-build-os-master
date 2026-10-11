'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const c=require('../nma_offline_core_45');

const mimes=['image/jpeg','image/png','image/webp','application/pdf'];
for(const mime of mimes){
  for(const size of [0,1,1024,1048576,c.LIMITS.maxFileBytes]){
    test(`offline meta valid ${mime} ${size}`,()=>{
      const r=c.validateEvidenceMeta({interventionId:'INT-X',mimeType:mime,size,fileName:'a.jpg'});
      assert.equal(r.ok,true); assert.equal(r.size,size);
    });
  }
}
for(const mime of ['text/plain','image/gif','application/zip','application/octet-stream','']){
  test(`offline meta rejects mime ${mime||'empty'}`,()=>{
    const r=c.validateEvidenceMeta({interventionId:'INT-X',mimeType:mime,size:10,fileName:'x'});
    assert.equal(r.ok,false); assert.ok(r.errors.includes('mime_not_allowed'));
  });
}
for(const size of [-1,c.LIMITS.maxFileBytes+1,c.LIMITS.maxFileBytes+999999]){
  test(`offline meta rejects size ${size}`,()=>{
    const r=c.validateEvidenceMeta({interventionId:'INT-X',mimeType:'image/jpeg',size,fileName:'x'});
    assert.equal(r.ok,false);
  });
}
for(let i=0;i<40;i++){
  test(`filename sanitization ${i}`,()=>{
    const raw=`../bad\\name\r\n${i}.jpg`;
    const x=c.sanitizeFileName(raw);
    assert.ok(!x.includes('\\')); assert.ok(!x.includes('\n')); assert.ok(x.length<=180);
  });
}
for(let i=0;i<25;i++){
  test(`retry delay monotonic ${i}`,()=>{
    const a=c.retryDelay(i), b=c.retryDelay(i+1);
    assert.ok(a>=5000); assert.ok(a<=c.LIMITS.maxRetryMs); assert.ok(b>=a);
  });
}
const queued=[0,408,425,429,500,502,503,599];
const notQueued=[200,201,204,400,401,403,404,409,413,415,422];
for(const s of queued)test(`http ${s} queues`,()=>assert.equal(c.shouldQueueHttp(s),true));
for(const s of notQueued)test(`http ${s} does not queue`,()=>assert.equal(c.shouldQueueHttp(s),false));
for(let count=0;count<=20;count++){
  test(`queue stats count ${count}`,()=>{
    const rows=Array.from({length:count},(_,i)=>({size:i+1,state:i%2?'queued':'failed'}));
    const s=c.queueStats(rows); assert.equal(s.count,count); assert.equal(s.bytes,count*(count+1)/2);
  });
}
for(let n=0;n<30;n++){
  test(`storage decision normal ${n}`,()=>{
    const items=Array.from({length:n},()=>({size:1024,state:'queued'}));
    const r=c.storageDecision({items,incomingBytes:2048,usage:10000,quota:100000000});
    assert.equal(r.ok,true);
  });
}
test('storage blocks count',()=>assert.equal(c.storageDecision({items:Array.from({length:100},()=>({size:1})),incomingBytes:1}).ok,false));
test('storage blocks bytes',()=>assert.equal(c.storageDecision({items:[{size:c.LIMITS.maxQueuedBytes}],incomingBytes:1}).ok,false));
test('storage blocks quota',()=>assert.equal(c.storageDecision({items:[],incomingBytes:30,usage:79,quota:100}).ok,false));
for(const p of ['/cantiere','/offline.html','/manifest.webmanifest','/nma_offline_enterprise_45.js'])test(`cacheable ${p}`,()=>assert.equal(c.cacheablePath(p),true));
for(const p of ['/api/health','/api/interventi','/master','/server.js','/.env'])test(`not cacheable ${p}`,()=>assert.equal(c.cacheablePath(p),false));
for(let i=0;i<30;i++){
  test(`normalize queue record ${i}`,()=>{
    const r=c.normalizeQueueRecord({id:'x'+i,interventionId:'INT',fileName:'a/b.jpg',mimeType:'IMAGE/JPEG',size:i,state:'weird',attempts:-1,lastError:'x'.repeat(600)});
    assert.equal(r.state,'queued'); assert.equal(r.attempts,0); assert.equal(r.mimeType,'image/jpeg'); assert.ok(r.fileName.indexOf('/')<0); assert.equal(r.lastError.length,500);
  });
}
