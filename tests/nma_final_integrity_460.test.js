'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const path=require('path');
const ROOT=path.resolve(__dirname,'..');
const shell=require('../nma_master_shell_44_core');
const frame=require('../nma_frame_policy_441');

for(const item of shell.REGISTRY){
  test(`final registry file exists ${item.key}`,()=>assert.ok(fs.existsSync(path.join(ROOT,item.file))));
  test(`final registry href roundtrip ${item.key}`,()=>assert.equal(shell.keyForHref(item.href),item.key));
  test(`final registry title ${item.key}`,()=>assert.ok(shell.titleForKey(item.key).length>2));
}

for(let i=0;i<70;i++){
  test(`master query module roundtrip ${i}`,()=>{
    const mods=shell.REGISTRY.filter(x=>x.key!=='dashboard');
    const item=mods[i%mods.length];
    const q=shell.searchForModule(item.key,`?foo=${i}`);
    assert.equal(shell.moduleFromSearch(q),item.key);
    assert.match(q,/foo=/);
  });
}

for(let i=0;i<60;i++){
  test(`master safe URL rejects external/scheme ${i}`,()=>{
    const bad=[`https://evil-${i}.invalid/x`,`//evil-${i}.invalid/x`,`javascript:alert(${i})`,`data:text/html,${i}`][i%4];
    assert.equal(shell.safeUrl(bad),null);
  });
}

for(let i=0;i<60;i++){
  test(`master label strips control/html ${i}`,()=>{
    const v=shell.sanitizeLabel(`<b>\u0000 name ${i} </b>`,40);
    assert.doesNotMatch(v,/[<>\u0000-\u001f]/); assert.ok(v.length<=40);
  });
}

for(let i=0;i<70;i++){
  const p=`/master-final/module/test-${i}`;
  test(`frame internal module policy ${i}`,()=>{
    assert.equal(frame.isInternalFramePath(p),true);
    const h=frame.headersForPath(p); assert.equal(h.xFrameOptions,'SAMEORIGIN'); assert.equal(h.csp,"frame-ancestors 'self'");
  });
}

for(let i=0;i<70;i++){
  const p=[`/api/private-${i}`,`/../../etc/passwd-${i}`,`https://evil-${i}.invalid`,`javascript:alert(${i})`][i%4];
  test(`frame rejects non-view ${i}`,()=>{
    assert.equal(frame.isInternalFramePath(p),false);
    assert.equal(frame.headersForPath(p).xFrameOptions,'DENY');
  });
}

const requiredFiles=['server.js','package.json','package-lock.json','master_control_v1.html','campo_operatore_v1.html','workflow_v1.html','supervisore_v1.html','quality_v1.html','passaporto_v1.html','asset_memory_v1.html','confronto_asbuilt_v1.html','nma_field_engine.js','nma_digital_memory.js','nma_master_shell_44.js','nma_enterprise_45.js','nma_offline_enterprise_45.js','nma_offline_core_45.js','sw.js','manifest.webmanifest','offline.html','enterprise_control_v1.html'];
for(const f of requiredFiles){
  test(`final required file ${f}`,()=>{const p=path.join(ROOT,f);assert.ok(fs.existsSync(p));assert.ok(fs.statSync(p).size>20)});
}

const htmlFiles=shell.REGISTRY.map(x=>x.file).filter((v,i,a)=>a.indexOf(v)===i);
for(const f of htmlFiles){
  test(`final HTML document structure ${f}`,()=>{const s=fs.readFileSync(path.join(ROOT,f),'utf8');assert.match(s,/<html\b/i);assert.match(s,/<body\b/i);assert.match(s,/<\/body>/i)});
}

const sw=fs.readFileSync(path.join(ROOT,'sw.js'),'utf8');
const offline=fs.readFileSync(path.join(ROOT,'nma_offline_enterprise_45.js'),'utf8');
const campo=fs.readFileSync(path.join(ROOT,'campo_operatore_v1.html'),'utf8');
const server=fs.readFileSync(path.join(ROOT,'server.js'),'utf8');
const packageLock=require('../package-lock.json');
const pkg=require('../package.json');

const pwaChecks=[
  ['SW release cache',/nma-build-field-4\.6\.0/],
  ['SW cantiere network fallback',/caches\.match\('\/cantiere'\)/],
  ['SW offline fallback',/caches\.match\('\/offline\.html'\)/],
  ['SW API bypass',/u\.pathname\.startsWith\('\/api\/'\)/],
  ['IndexedDB',/indexedDB\.open/],
  ['SHA256 browser',/crypto\.subtle\.digest/],
  ['evidence queue marker',/evidenz/i],
  ['campo cache marker',/nma_build_os_cantieri_cache_v45/]
];
for(const [n,re] of pwaChecks) test(`final PWA ${n}`,()=>assert.match(n.includes('campo')?campo:n.includes('SW')?sw:offline,re));

const serverChecks=[
  /require\('\.\/nma_field_engine'\)\.install/,
  /require\('\.\/nma_digital_memory'\)\.install/,
  /require\('\.\/nma_master_enterprise_43'\)\.install/,
  /require\('\.\/nma_master_shell_44'\)\.install/,
  /require\('\.\/nma_enterprise_45'\)\.install/,
  /server\.listen\(PORT/,
  /SIGTERM/,
  /SIGINT/
];
serverChecks.forEach((re,i)=>test(`final server integration marker ${i}`,()=>assert.match(server,re)));

test('final dependency lock proxy-addr patched',()=>assert.equal(packageLock.packages['node_modules/proxy-addr'].version,'2.0.8'));
test('final direct dependency proxy-addr patched',()=>assert.equal(pkg.dependencies['proxy-addr'],'2.0.8'));
test('final package version',()=>assert.equal(pkg.version,'4.6.0'));
test('final production test script available',()=>assert.ok(pkg.scripts['test:final']));
