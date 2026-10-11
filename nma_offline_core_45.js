'use strict';

const LIMITS = Object.freeze({
  maxFileBytes: 15 * 1024 * 1024,
  maxQueuedFiles: 100,
  maxQueuedBytes: 250 * 1024 * 1024,
  quotaSoftRatio: 0.80,
  maxAttempts: 12,
  baseRetryMs: 5000,
  maxRetryMs: 10 * 60 * 1000,
  queueRetentionMs: 7 * 24 * 60 * 60 * 1000
});

const ALLOWED_MIME = new Set([
  'image/jpeg','image/png','image/webp','application/pdf'
]);

function text(v,f=''){ return v===undefined||v===null?f:String(v).trim(); }
function num(v,f=0){ const n=Number(v); return Number.isFinite(n)?n:f; }
function sanitizeFileName(name){
  return text(name,'evidenza')
    .replace(/[\\/\r\n\0]/g,'_')
    .replace(/\s+/g,' ')
    .slice(0,180) || 'evidenza';
}
function validateEvidenceMeta(meta={}){
  const size=num(meta.size,-1);
  const mime=text(meta.mimeType||meta.type).toLowerCase();
  const interventionId=text(meta.interventionId||meta.id_intervento);
  const errors=[];
  if(!interventionId) errors.push('intervention_id_missing');
  if(size<0) errors.push('file_size_invalid');
  if(size>LIMITS.maxFileBytes) errors.push('file_too_large');
  if(!ALLOWED_MIME.has(mime)) errors.push('mime_not_allowed');
  return {ok:errors.length===0,errors,size,mime,interventionId,fileName:sanitizeFileName(meta.fileName||meta.name)};
}
function retryDelay(attempts){
  const n=Math.max(0,Math.floor(num(attempts,0)));
  return Math.min(LIMITS.maxRetryMs, LIMITS.baseRetryMs * (2 ** Math.min(n,7)));
}
function shouldQueueHttp(status){
  const s=Math.floor(num(status,0));
  return s===0 || s===408 || s===425 || s===429 || s>=500;
}
function queueStats(items=[]){
  const rows=Array.isArray(items)?items:[];
  return rows.reduce((a,x)=>{
    a.count++;
    a.bytes+=Math.max(0,num(x.size,0));
    if(text(x.state)==='failed') a.failed++;
    if(text(x.state)==='queued') a.queued++;
    return a;
  },{count:0,bytes:0,failed:0,queued:0});
}
function storageDecision({items=[],incomingBytes=0,usage=0,quota=0}={}){
  const s=queueStats(items);
  const incoming=Math.max(0,num(incomingBytes,0));
  const reasons=[];
  if(s.count>=LIMITS.maxQueuedFiles) reasons.push('queue_file_limit');
  if(s.bytes+incoming>LIMITS.maxQueuedBytes) reasons.push('queue_byte_limit');
  if(quota>0 && usage+incoming>quota*LIMITS.quotaSoftRatio) reasons.push('browser_quota_soft_limit');
  if(incoming>LIMITS.maxFileBytes) reasons.push('file_too_large');
  return {ok:reasons.length===0,reasons,stats:s,projectedBytes:s.bytes+incoming};
}
function isExpired(createdAt, now=Date.now()){
  const t=new Date(createdAt||0).getTime();
  return Number.isFinite(t) && t>0 && now-t>LIMITS.queueRetentionMs;
}
function cacheablePath(raw){
  const p=text(raw).split('?')[0];
  return ['/cantiere','/offline.html','/manifest.webmanifest','/nma_offline_enterprise_45.js'].includes(p);
}
function normalizeQueueRecord(x={}){
  return {
    id:text(x.id),
    interventionId:text(x.interventionId),
    fileName:sanitizeFileName(x.fileName),
    mimeType:text(x.mimeType).toLowerCase(),
    size:Math.max(0,num(x.size,0)),
    sha256:text(x.sha256).toLowerCase(),
    state:['queued','syncing','failed'].includes(text(x.state))?text(x.state):'queued',
    attempts:Math.max(0,Math.floor(num(x.attempts,0))),
    createdAt:text(x.createdAt)||new Date().toISOString(),
    nextAttemptAt:text(x.nextAttemptAt),
    lastError:text(x.lastError).slice(0,500)
  };
}

module.exports={LIMITS,ALLOWED_MIME,sanitizeFileName,validateEvidenceMeta,retryDelay,shouldQueueHttp,queueStats,storageDecision,isExpired,cacheablePath,normalizeQueueRecord};
