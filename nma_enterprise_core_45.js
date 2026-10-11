'use strict';
const crypto=require('crypto');
const VERSION='4.5.0';
const REQUIRED_FILES=[
  'server.js','package.json','master_control_v1.html','campo_operatore_v1.html',
  'nma_field_engine.js','nma_digital_memory.js','nma_master_enterprise_43.js',
  'nma_master_shell_44.js','nma_offline_enterprise_45.js','nma_offline_core_45.js',
  'sw.js','manifest.webmanifest','enterprise_control_v1.html'
];
function text(v,f=''){return v===undefined||v===null?f:String(v).trim()}
function requestId(){return `req-${Date.now().toString(36)}-${crypto.randomBytes(5).toString('hex')}`}
function normalizeRole(role){const r=text(role).toLowerCase();return ['operatore','supervisore','admin'].includes(r)?r:'operatore'}
function roleCan(role,action){
  const matrix={
    operatore:new Set(['field.read','field.write','offline.sync']),
    supervisore:new Set(['field.read','field.write','offline.sync','quality.read','quality.write','enterprise.read']),
    admin:new Set(['field.read','field.write','offline.sync','quality.read','quality.write','enterprise.read','enterprise.admin','audit.export'])
  };
  return Boolean(matrix[normalizeRole(role)]?.has(text(action)));
}
function normalizeOrigin(v){try{const u=new URL(text(v));return `${u.protocol}//${u.host}`.toLowerCase()}catch{return ''}}
function requestOriginAllowed({origin,protocol='http',host='',allowed=[]}={}){
  const o=normalizeOrigin(origin); if(!o) return true;
  const same=`${text(protocol,'http').replace(/:$/,'')}://${text(host)}`.toLowerCase();
  if(o===same) return true;
  return (allowed||[]).map(normalizeOrigin).filter(Boolean).includes(o);
}
function redact(value){
  const secret=/(password|passwd|secret|token|authorization|cookie|pin|mongodb_uri|api[_-]?key)/i;
  if(Array.isArray(value)) return value.map(redact);
  if(value&&typeof value==='object'){
    const out={}; for(const [k,v] of Object.entries(value)) out[k]=secret.test(k)?'[REDACTED]':redact(v); return out;
  }
  if(typeof value==='string' && /mongodb\+srv:\/\//i.test(value)) return '[REDACTED_URI]';
  return value;
}
function readiness({mongoState=0,files=[],env={}}={}){
  const missing=REQUIRED_FILES.filter(f=>!(files||[]).includes(f));
  const envOk=Boolean(env.SESSION_SECRET)&&Boolean(env.ADMIN_PIN)&&Boolean(env.MONGODB_URI);
  const checks={mongoConnected:Number(mongoState)===1,requiredFiles:missing.length===0,requiredEnv:envOk};
  const ok=Object.values(checks).every(Boolean);
  return {ok,status:ok?'OPERATIONAL':'DEGRADED',checks,missing};
}
function releaseInfo(env={}){
  return {version:VERSION,commit:text(env.RENDER_GIT_COMMIT||env.GIT_COMMIT||''),service:text(env.RENDER_SERVICE_NAME||''),environment:text(env.NODE_ENV||'development'),builtAt:text(env.NMA_BUILD_AT||'')};
}
module.exports={VERSION,REQUIRED_FILES,requestId,normalizeRole,roleCan,normalizeOrigin,requestOriginAllowed,redact,readiness,releaseInfo};
