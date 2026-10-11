'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const c=require('../nma_enterprise_core_45');

test('enterprise version',()=>assert.equal(c.VERSION,'4.6.0'));
for(const role of ['operatore','supervisore','admin']){
  test(`normalize role ${role}`,()=>assert.equal(c.normalizeRole(role),role));
}
for(const role of ['',null,'root','guest','ADMINISTRATOR'])test(`unknown role ${role}`,()=>assert.equal(c.normalizeRole(role),'operatore'));
const actions=['field.read','field.write','offline.sync','quality.read','quality.write','enterprise.read','enterprise.admin','audit.export'];
for(const role of ['operatore','supervisore','admin']){
  for(const action of actions){
    test(`permission ${role} ${action}`,()=>{
      const v=c.roleCan(role,action); assert.equal(typeof v,'boolean');
      if(role==='admin') assert.equal(v,true);
      if(role==='operatore' && ['quality.read','quality.write','enterprise.read','enterprise.admin','audit.export'].includes(action)) assert.equal(v,false);
    });
  }
}
for(let i=0;i<50;i++){
  const host=`host${i}.example.com`;
  test(`same origin ${i}`,()=>assert.equal(c.requestOriginAllowed({origin:`https://${host}`,protocol:'https',host}),true));
  test(`cross origin rejected ${i}`,()=>assert.equal(c.requestOriginAllowed({origin:`https://evil${i}.example.net`,protocol:'https',host}),false));
}
for(let i=0;i<20;i++){
  test(`explicit allowed origin ${i}`,()=>assert.equal(c.requestOriginAllowed({origin:`https://allowed${i}.example.com`,protocol:'https',host:'main.example.com',allowed:[`https://allowed${i}.example.com`]}),true));
}
for(const o of ['',null,'not-a-url'])test(`empty/malformed origin accepted as absent ${o}`,()=>assert.equal(c.requestOriginAllowed({origin:o,protocol:'https',host:'x'}),true));
for(let i=0;i<30;i++){
  test(`redaction ${i}`,()=>{
    const r=c.redact({password:'p',api_key:'k',token:'t',safe:i,nested:{mongodb_uri:'mongodb+srv://u:p@h/x',name:'ok'}});
    assert.equal(r.password,'[REDACTED]'); assert.equal(r.api_key,'[REDACTED]'); assert.equal(r.token,'[REDACTED]'); assert.equal(r.safe,i); assert.equal(r.nested.mongodb_uri,'[REDACTED]');
  });
}
for(let state=0;state<=3;state++){
  test(`readiness mongo state ${state}`,()=>{
    const env={SESSION_SECRET:'s',ADMIN_PIN:'p',MONGODB_URI:'m'};
    const r=c.readiness({mongoState:state,files:c.REQUIRED_FILES,env});
    assert.equal(r.ok,state===1);
  });
}
for(let miss=0;miss<20;miss++){
  test(`readiness missing file ${miss}`,()=>{
    const files=c.REQUIRED_FILES.filter((_,i)=>i!==miss%c.REQUIRED_FILES.length);
    const r=c.readiness({mongoState:1,files,env:{SESSION_SECRET:'s',ADMIN_PIN:'p',MONGODB_URI:'m'}});
    assert.equal(r.ok,false); assert.ok(r.missing.length>=1);
  });
}
for(const missing of ['SESSION_SECRET','ADMIN_PIN','MONGODB_URI'])test(`readiness missing env ${missing}`,()=>{const env={SESSION_SECRET:'s',ADMIN_PIN:'p',MONGODB_URI:'m'};delete env[missing];assert.equal(c.readiness({mongoState:1,files:c.REQUIRED_FILES,env}).ok,false)});
for(let i=0;i<25;i++)test(`request id unique shape ${i}`,()=>assert.match(c.requestId(),/^req-[a-z0-9]+-[a-f0-9]{10}$/));
test('release info does not expose secrets',()=>{const r=c.releaseInfo({RENDER_GIT_COMMIT:'abc',RENDER_SERVICE_NAME:'svc',NODE_ENV:'production',SESSION_SECRET:'SECRET'});assert.deepEqual(r,{version:'4.6.0',commit:'abc',service:'svc',environment:'production',builtAt:''})});
