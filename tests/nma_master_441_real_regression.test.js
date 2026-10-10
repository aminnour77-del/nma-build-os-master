'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const path=require('path');
const ROOT=path.resolve(__dirname,'..');
const core=require('../nma_master_shell_44_core');
const policy=require('../nma_frame_policy_441');

const allowed=[
 '/', '/master','/master/','/spatial-twin','/field-x1','/digital-memory','/master43',
 '/supervisore','/audit','/workflow','/quality','/asset-memory','/network-memory','/command-center',
 '/sal','/sal-v2','/direzione','/cantiere','/ufficio','/correzioni',
 '/master-final/module/network','/master-final/module/spatial','/master-final/module/control','/master-final/module/supervisore',
 '/master-final/module/audit','/master-final/module/sal','/master-final/module/workflow','/master-final/module/quality',
 '/master-final/module/passaporto','/master-final/module/asset','/master-final/module/command','/master-final/module/asbuilt',
 '/master-final/module/correzioni','/master-final/module/campo',
 '/passaporto/ABC-123','/confronto/XYZ-456'
];
for(const [i,p] of allowed.entries()) test(`frame allow ${i+1} ${p}`,()=>{assert.equal(policy.isInternalFramePath(p),true);const h=policy.headersForPath(p);assert.equal(h.xFrameOptions,'SAMEORIGIN');assert.equal(h.csp,"frame-ancestors 'self'");});

const denied=[
 '/api/master/final/summary','/api/master44/modules','/server.js','/.env','/admin','/external','//evil.test/x','javascript:alert(1)',
 '/../../etc/passwd','/master-final/module/../../x','/passaporto/a/b','/confronto/a/b','/master-final/module/','/master-final/module/%2e%2e',
 '/foo?x=1','https://evil.test/x','\\evil','/..','', 'data:text/html,x'
];
for(const [i,p] of denied.entries()) test(`frame deny ${i+1} ${p}`,()=>{assert.equal(policy.isInternalFramePath(p),false);const h=policy.headersForPath(p);assert.equal(h.xFrameOptions,'DENY');assert.equal(h.csp,"frame-ancestors 'none'");});

for(const item of core.REGISTRY.filter(x=>x.embed)){
 test(`registry file exists ${item.key}`,()=>assert.ok(fs.existsSync(path.join(ROOT,item.file))));
 test(`registry html visible ${item.key}`,()=>{const s=fs.readFileSync(path.join(ROOT,item.file),'utf8');assert.ok(s.length>500);assert.match(s,/<body\b/i);assert.match(s,/<\/body>/i);});
 test(`registry href roundtrip ${item.key}`,()=>{assert.equal(core.keyForHref(item.href),item.key);assert.equal(core.hrefForKey(item.key),item.href);});
}

const legacy={
 '/supervisore':'supervisore','/audit':'audit','/sal':'sal','/sal-v2':'sal','/workflow':'workflow','/quality':'quality',
 '/asset-memory':'asset','/network-memory':'network','/command-center':'command','/direzione':'control','/ufficio':'control','/cantiere':'campo',
 '/correzioni':'correzioni','/passaporto/ABC':'passport','/confronto/ABC':'asbuilt'
};
for(const [p,k] of Object.entries(legacy)) test(`legacy classify ${p}`,()=>assert.equal(core.keyForHref(p),k));

const server=fs.readFileSync(path.join(ROOT,'server.js'),'utf8');
test('server imports frame policy',()=>assert.match(server,/nma_frame_policy_441/));
test('server applies policy helper',()=>assert.match(server,/headersForPath\(req\.path\)/));
test('server no old unconditional frame block',()=>assert.doesNotMatch(server,/res\.setHeader\(\s*['"]X-Frame-Options['"]\s*,\s*['"]DENY['"]\s*\)/s));
test('server master shell installed before listen',()=>assert.ok(server.indexOf("nma_master_shell_44").valueOf()<server.lastIndexOf('server.listen')));

const browser=fs.readFileSync(path.join(ROOT,'nma_master_shell_44_browser.js'),'utf8');
const master=fs.readFileSync(path.join(ROOT,'master_control_v1.html'),'utf8');
for(const [name,s] of [['browser',browser],['master',master]]){
 test(`${name} version 4.4.2`,()=>assert.match(s,/4\.4\.2/));
 test(`${name} passaporto alias fixed`,()=>assert.match(s,/passaporto.*passport/));
 test(`${name} dynamic passaporto`,()=>assert.match(s,/passaporto\\\/\[\^\/\]\+/));
 test(`${name} dynamic confronto`,()=>assert.match(s,/confronto\\\/\[\^\/\]\+/));
 test(`${name} load watchdog`,()=>assert.match(s,/MODULO NON CARICATO/));
 test(`${name} empty content detector`,()=>assert.match(s,/MODULO CARICATO SENZA CONTENUTO VISIBILE/));
 test(`${name} same origin child bridge`,()=>assert.match(s,/frame\.contentWindow/));
 test(`${name} parent login redirect`,()=>assert.match(s,/window\.location\.assign\('\/'\)/));
 test(`${name} no old precedence bug`,()=>assert.doesNotMatch(s,/\|\|k in registry\?k:null/));
}

const final=fs.readFileSync(path.join(ROOT,'nma_master_final.js'),'utf8');
const mappings={campo:'campo_operatore_v1.html',supervisore:'supervisore_v1.html',workflow:'workflow_v1.html',quality:'quality_v1.html',audit:'audit_v1.html',passaporto:'passaporto_v1.html',asset:'asset_memory_v1.html',network:'network_memory_v1.html',spatial:'spatial_twin_v1.html',control:'control_room_v2.html',command:'command_center_v1.html',sal:'sal_v2.html',asbuilt:'confronto_asbuilt_v1.html',correzioni:'correzioni_v1.html'};
for(const [k,f] of Object.entries(mappings)) test(`server module map ${k}`,()=>{assert.ok(final.includes(`${k}: '${f}'`)||final.includes(`${k}: \"${f}\"`));});

test('field route installed',()=>assert.match(fs.readFileSync(path.join(ROOT,'nma_field_engine.js'),'utf8'),/app\.get\('\/field-x1'/));
test('digital memory route installed',()=>assert.match(fs.readFileSync(path.join(ROOT,'nma_digital_memory.js'),'utf8'),/app\.get\('\/digital-memory'/));
test('master43 route installed',()=>assert.match(fs.readFileSync(path.join(ROOT,'nma_master_enterprise_43.js'),'utf8'),/app\.get\('\/master43'/));

const legacyRoutePatterns=['/supervisore','/audit','/workflow','/quality','/asset-memory','/network-memory','/command-center','/sal','/sal-v2','/direzione','/cantiere','/ufficio','/correzioni','/passaporto/:id','/confronto/:id'];
for(const p of legacyRoutePatterns)test(`legacy server route ${p}`,()=>assert.ok(server.includes(`'${p}'`)||server.includes(`\"${p}\"`)));
