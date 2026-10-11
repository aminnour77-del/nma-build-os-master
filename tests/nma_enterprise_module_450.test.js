'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const mod=require('../nma_enterprise_45');
function setup(){
  const routes=[];
  const app={get:(route,...handlers)=>routes.push({method:'GET',route,handlers})};
  const mongoose={connection:{readyState:1,db:null}};
  const auth=(q,s,n)=>n&&n(); const role=()=>auth;
  const ret=mod.install({app,mongoose,requireAuth:auth,requireRole:role});
  return {routes,ret};
}
test('enterprise module installs',()=>assert.equal(setup().ret.version,'4.6.0'));
const expected=['/manifest.webmanifest','/sw.js','/nma_offline_enterprise_45.js','/offline.html','/api/live','/api/ready','/api/enterprise/status','/api/enterprise/integrity','/api/enterprise/collections','/api/enterprise/export/:collection','/enterprise-control'];
for(const route of expected)test(`enterprise route registered ${route}`,()=>assert.ok(setup().routes.some(x=>x.route===route)));
for(let i=0;i<30;i++)test(`route table stable ${i}`,()=>{const r=setup().routes;assert.equal(new Set(r.map(x=>x.route)).size,r.length);assert.ok(r.length>=11)});
