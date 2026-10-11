'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const path=require('path');
const ROOT=path.resolve(__dirname,'..');
const c=require('../nma_enterprise_core_45');

// Release identity + patched critical dependency.
test('final release version is 4.6.0',()=>assert.equal(c.VERSION,'4.6.0'));
test('proxy-addr critical CVE patch is pinned to 2.0.8',()=>{
  const p=require('../package-lock.json');
  assert.equal(p.packages['node_modules/proxy-addr'].version,'2.0.8');
  assert.equal(p.packages[''].dependencies['proxy-addr'],'2.0.8');
});

const actions=['field.read','field.write','offline.sync','quality.read','quality.write','enterprise.read','enterprise.admin','audit.export'];
const expected={
  operatore:new Set(['field.read','field.write','offline.sync']),
  supervisore:new Set(['field.read','field.write','offline.sync','quality.read','quality.write','enterprise.read']),
  admin:new Set(actions)
};
for(const role of Object.keys(expected)) for(const action of actions){
  test(`final RBAC ${role} ${action}`,()=>assert.equal(c.roleCan(role,action),expected[role].has(action)));
}

for(let i=0;i<80;i++){
  const bad=`unknown-role-${i}`;
  test(`role fuzz defaults safely ${i}`,()=>assert.equal(c.normalizeRole(bad),'operatore'));
}

for(let i=0;i<70;i++){
  const host=`field-${i}.nma.test`;
  test(`same origin accepted ${i}`,()=>assert.equal(c.requestOriginAllowed({origin:`https://${host}`,protocol:'https',host}),true));
  test(`cross origin rejected ${i}`,()=>assert.equal(c.requestOriginAllowed({origin:`https://evil-${i}.invalid`,protocol:'https',host}),false));
}

for(let i=0;i<40;i++){
  test(`explicit origin allowlist ${i}`,()=>{
    const o=`https://allowed-${i}.nma.test`;
    assert.equal(c.requestOriginAllowed({origin:o,protocol:'https',host:'main.nma.test',allowed:[o]}),true);
  });
}

const secretKeys=['password','passwd','secret','token','authorization','cookie','pin','mongodb_uri','api_key','api-key','ApiKey'];
for(let i=0;i<70;i++){
  test(`redaction fuzz ${i}`,()=>{
    const key=secretKeys[i%secretKeys.length];
    const input={safe:`value-${i}`,nested:{[key]:`secret-${i}`},arr:[{token:'abc'},'ok']};
    const out=c.redact(input);
    assert.equal(out.safe,`value-${i}`);
    assert.equal(out.nested[key],'[REDACTED]');
    assert.equal(out.arr[0].token,'[REDACTED]');
  });
}

for(let i=0;i<50;i++) test(`request id entropy/shape ${i}`,()=>assert.match(c.requestId(),/^req-[a-z0-9]+-[a-f0-9]{10}$/));

for(let i=0;i<30;i++){
  test(`readiness env matrix ${i}`,()=>{
    const env={SESSION_SECRET:'s',ADMIN_PIN:'p',MONGODB_URI:'m'};
    if(i%4===1) delete env.SESSION_SECRET;
    if(i%4===2) delete env.ADMIN_PIN;
    if(i%4===3) delete env.MONGODB_URI;
    const r=c.readiness({mongoState:1,files:c.REQUIRED_FILES,env});
    assert.equal(r.ok,i%4===0);
  });
}

const server=fs.readFileSync(path.join(ROOT,'server.js'),'utf8');
const packageJson=JSON.parse(fs.readFileSync(path.join(ROOT,'package.json'),'utf8'));
const sourceChecks=[
  ['x-powered-by disabled',/app\.disable\(['"]x-powered-by['"]\)/],
  ['nosniff header',/X-Content-Type-Options/],
  ['frame policy helper',/headersForPath\(req\.path\)/],
  ['HSTS header',/Strict-Transport-Security/],
  ['request id header',/X-Request-Id/],
  ['same-origin API guard',/ORIGIN_FORBIDDEN/],
  ['auth required code',/AUTH_REQUIRED/],
  ['role forbidden code',/ROLE_FORBIDDEN/],
  ['secure production cookie',/secure:\s*process\.env\.NODE_ENV\s*===\s*['"]production['"]/],
  ['httpOnly cookie',/httpOnly:\s*true/],
  ['sameSite lax',/sameSite:\s*['"]lax['"]/],
  ['graceful SIGTERM',/SIGTERM/],
  ['graceful SIGINT',/SIGINT/],
  ['Mongo session store',/MongoStore\.create/],
  ['json body limit',/express\.json\(\{\s*limit:\s*['"]15mb['"]/],
  ['api no-store',/Cache-Control/],
  ['malformed JSON boundary',/INVALID_JSON/],
  ['file-too-large boundary',/FILE_TOO_LARGE/],
  ['internal error boundary',/INTERNAL_ERROR/],
  ['trust proxy fixed hop',/app\.set\(['"]trust proxy['"],\s*1\)/]
];
for(const [name,re] of sourceChecks) test(`security source: ${name}`,()=>assert.match(server,re));

test('package pins proxy-addr direct security patch',()=>assert.equal(packageJson.dependencies['proxy-addr'],'2.0.8'));
test('package keeps patched multer 2.4.0',()=>assert.equal(packageJson.dependencies.multer,'^2.4.0'));
test('package keeps modern mongoose line',()=>assert.equal(packageJson.dependencies.mongoose,'^9.10.0'));
