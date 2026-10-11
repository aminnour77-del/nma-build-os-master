'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const c=require('../nma_offline_core_45');

const mimes=['image/jpeg','image/png','image/webp','application/pdf'];
const sizes=[0,1,127,1024,8192,65535,262144,1048576,2097152,4194304,8388608,12582912,c.LIMITS.maxFileBytes-2,c.LIMITS.maxFileBytes-1,c.LIMITS.maxFileBytes];
for(const mime of mimes) for(const size of sizes){
  test(`final offline valid ${mime} ${size}`,()=>{
    const r=c.validateEvidenceMeta({interventionId:'INT-FINAL',mimeType:mime,size,fileName:'evidence.bin'});
    assert.equal(r.ok,true); assert.equal(r.size,size); assert.equal(r.mime,mime);
  });
}

const badMimes=['','text/plain','text/html','image/gif','image/svg+xml','application/zip','application/octet-stream','video/mp4','audio/mpeg','application/javascript','application/xml','multipart/form-data'];
for(let i=0;i<48;i++){
  const mime=badMimes[i%badMimes.length];
  test(`offline rejects unsupported mime ${i}`,()=>{
    const r=c.validateEvidenceMeta({interventionId:'INT',mimeType:mime,size:100,fileName:'x'});
    assert.equal(r.ok,false); assert.ok(r.errors.includes('mime_not_allowed'));
  });
}

for(let i=0;i<60;i++){
  test(`offline filename traversal sanitization ${i}`,()=>{
    const raw=`../../folder\\sub\r\nfile-${i}\0.pdf`;
    const x=c.sanitizeFileName(raw);
    assert.ok(x.length>0 && x.length<=180);
    assert.doesNotMatch(x,/[\\/\r\n\0]/);
  });
}

for(let i=0;i<40;i++){
  test(`offline retry exponential bounded ${i}`,()=>{
    const d=c.retryDelay(i);
    assert.ok(d>=c.LIMITS.baseRetryMs);
    assert.ok(d<=c.LIMITS.maxRetryMs);
    if(i>0) assert.ok(d>=c.retryDelay(i-1));
  });
}

for(let status=0;status<100;status++){
  test(`offline HTTP queue policy ${status}`,()=>{
    const expect=status===0 || status===408 || status===425 || status===429 || status>=500;
    assert.equal(c.shouldQueueHttp(status),expect);
  });
}

for(let count=0;count<45;count++){
  test(`offline queue stats exact ${count}`,()=>{
    const rows=Array.from({length:count},(_,i)=>({size:(i+1)*17,state:i%3===0?'failed':'queued'}));
    const s=c.queueStats(rows);
    assert.equal(s.count,count);
    assert.equal(s.bytes,17*count*(count+1)/2);
    assert.equal(s.failed,Math.ceil(count/3));
    assert.equal(s.queued,count-Math.ceil(count/3));
  });
}

for(let count=0;count<45;count++){
  test(`offline storage normal load ${count}`,()=>{
    const items=Array.from({length:count},()=>({size:1024,state:'queued'}));
    const r=c.storageDecision({items,incomingBytes:4096,usage:1024*1024,quota:1024*1024*1024});
    assert.equal(r.ok,true);
  });
}

for(let i=0;i<50;i++){
  test(`offline normalized queue record ${i}`,()=>{
    const r=c.normalizeQueueRecord({
      id:`row-${i}`,interventionId:`INT-${i}`,fileName:`a/b\\c-${i}.jpg`,mimeType:'IMAGE/JPEG',
      size:i*99,state:i%4===0?'failed':i%4===1?'syncing':i%4===2?'queued':'unknown',attempts:i-3,
      sha256:'ABCDEF',lastError:'x'.repeat(700)
    });
    assert.equal(r.id,`row-${i}`);
    assert.equal(r.mimeType,'image/jpeg');
    assert.ok(['queued','syncing','failed'].includes(r.state));
    assert.ok(r.attempts>=0);
    assert.ok(r.lastError.length<=500);
    assert.doesNotMatch(r.fileName,/[\\/]/);
  });
}

const now=Date.now();
for(let days=0;days<30;days++){
  test(`offline retention ${days}d`,()=>{
    const d=new Date(now-days*24*60*60*1000).toISOString();
    assert.equal(c.isExpired(d,now),days>7);
  });
}

for(let i=0;i<30;i++){
  test(`offline cache query handling ${i}`,()=>assert.equal(c.cacheablePath(`/cantiere?refresh=${i}`),true));
}

test('offline blocks queue at file count limit',()=>assert.equal(c.storageDecision({items:Array.from({length:c.LIMITS.maxQueuedFiles},()=>({size:1})),incomingBytes:1}).ok,false));
test('offline blocks queue at byte limit',()=>assert.equal(c.storageDecision({items:[{size:c.LIMITS.maxQueuedBytes}],incomingBytes:1}).ok,false));
test('offline blocks browser soft quota',()=>assert.equal(c.storageDecision({items:[],incomingBytes:2,usage:80,quota:100}).ok,false));
test('offline blocks oversize single file',()=>assert.equal(c.storageDecision({items:[],incomingBytes:c.LIMITS.maxFileBytes+1}).ok,false));
