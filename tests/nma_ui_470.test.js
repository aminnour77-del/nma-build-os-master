'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const ROOT=path.resolve(__dirname,'..');
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT,p))).digest('hex');
const uiCss=fs.readFileSync(path.join(ROOT,'ui/nma_enterprise_ui_47.css'),'utf8');
const uiJs=fs.readFileSync(path.join(ROOT,'ui/nma_enterprise_ui_47.js'),'utf8');
const master=fs.readFileSync(path.join(ROOT,'master_control_v1.html'),'utf8');
const freeze=JSON.parse(fs.readFileSync(path.join(ROOT,'CORE_4.6.0_FREEZE_SHA256.json'),'utf8'));
const version=JSON.parse(fs.readFileSync(path.join(ROOT,'NMA_UI_4.7.0.json'),'utf8'));

const htmlFiles=fs.readdirSync(ROOT).filter(f=>f.endsWith('.html')).sort();
for(const f of htmlFiles){
  const s=fs.readFileSync(path.join(ROOT,f),'utf8');
  test(`ui47 stylesheet injected ${f}`,()=>assert.match(s,/id="nma-enterprise-ui-47-style"/));
  test(`ui47 behavior injected ${f}`,()=>assert.match(s,/id="nma-enterprise-ui-47-script"/));
}

for(const [f,expected] of Object.entries(freeze.sha256)){
  test(`core 4.6.0 frozen byte-for-byte ${f}`,()=>assert.equal(sha(f),expected));
}

const routes=[
  '/master','/master-final/module/spatial','/master-final/module/network','/master-final/module/control',
  '/master-final/module/supervisore','/master-final/module/workflow','/master-final/module/passaporto',
  '/master-final/module/asbuilt','/master-final/module/command','/master-final/module/asset',
  '/master-final/module/audit','/master-final/module/quality','/master-final/module/sal','/enterprise-control'
];
for(const r of routes)test(`master navigation route preserved ${r}`,()=>assert.ok(master.includes(`href="${r}"`)));

const cssChecks=[
  ['sharp enterprise radius',/--nma47-radius:7px/],
  ['master 248px sidebar',/grid-template-columns:248px/],
  ['navigation sections',/\.nma-nav-section/],
  ['command strip',/\.nma-command-strip/],
  ['touch tablet breakpoint',/@media\(max-width:900px\)/],
  ['mobile drawer',/nma-sidebar-open/],
  ['reduced motion accessibility',/prefers-reduced-motion/],
  ['focus-visible accessibility',/:focus-visible/],
  ['field input ergonomics',/min-height:42px/],
  ['master stage styling',/#nmaMasterStage/],
  ['master panel styling',/body\.nma-ui47 \.panel/],
  ['dark enterprise base',/--nma47-bg:#04080e/]
];
for(const [name,re] of cssChecks)test(`ui47 css ${name}`,()=>assert.match(uiCss,re));

const jsChecks=[
  ['UI version',/UI_VERSION='4\.7\.0'/],
  ['frozen core version',/CORE_VERSION='4\.6\.0'/],
  ['grouped navigation',/groupMasterNav/],
  ['quick actions',/addQuickStrip/],
  ['mobile menu',/addMobileMenu/],
  ['accessibility pass',/setA11y/],
  ['online offline state',/addEventListener\('offline'/],
  ['shell relayout after UI boot',/dispatchEvent\(new Event\('resize'\)\)/]
];
for(const [name,re] of jsChecks)test(`ui47 js ${name}`,()=>assert.match(uiJs,re));

const forbidden=[
  ['fetch API',/\bfetch\s*\(/],
  ['XMLHttpRequest',/XMLHttpRequest/],
  ['WebSocket',/\bWebSocket\b/],
  ['socket.io',/\bio\s*\(/],
  ['indexedDB write',/indexedDB/],
  ['form submit interception',/preventDefault\(\).*submit|addEventListener\(['"]submit/]
];
for(const [name,re] of forbidden)test(`ui47 presentation layer has no ${name}`,()=>assert.doesNotMatch(uiJs,re));

test('ui47 manifest identifies presentation-only release',()=>{
  assert.equal(version.uiVersion,'4.7.0');
  assert.equal(version.coreVersion,'4.6.0');
  assert.equal(version.logicChanges,false);
});
test('ui47 sources are non-trivial',()=>{assert.ok(uiCss.length>12000);assert.ok(uiJs.length>5000)});
test('ui47 master quick actions retain existing shell-compatible internal routes',()=>{
  for(const r of ['/master-final/module/campo','/master-final/module/supervisore','/master-final/module/quality','/master-final/module/passaporto'])assert.ok(uiJs.includes(r));
});
