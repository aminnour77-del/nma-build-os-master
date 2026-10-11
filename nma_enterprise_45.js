'use strict';
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const core=require('./nma_enterprise_core_45');

function shaFile(file){const h=crypto.createHash('sha256');h.update(fs.readFileSync(file));return h.digest('hex')}
function fileList(){return core.REQUIRED_FILES.filter(f=>fs.existsSync(path.join(__dirname,f)))}
function safeCollectionName(v){return String(v||'').replace(/[^a-zA-Z0-9_.-]/g,'').slice(0,120)}

function install({app,mongoose,requireAuth,requireRole}){
  if(!app||!mongoose) throw new Error('NMA Enterprise 4.5: app/mongoose mancanti');
  const auth=typeof requireAuth==='function'?requireAuth:(q,s,n)=>n();
  const roles=(...r)=>typeof requireRole==='function'?requireRole(...r):(q,s,n)=>n();
  const sup=[auth,roles('supervisore','admin')];
  const admin=[auth,roles('admin')];

  // Static/PWA resources. No operational data is embedded in these files.
  app.get('/manifest.webmanifest',(req,res)=>res.type('application/manifest+json').sendFile(path.join(__dirname,'manifest.webmanifest')));
  app.get('/sw.js',(req,res)=>{res.setHeader('Service-Worker-Allowed','/');res.setHeader('Cache-Control','no-cache');res.type('application/javascript').sendFile(path.join(__dirname,'sw.js'))});
  app.get('/nma_offline_enterprise_45.js',(req,res)=>{res.setHeader('Cache-Control','no-cache');res.type('application/javascript').sendFile(path.join(__dirname,'nma_offline_enterprise_45.js'))});
  app.get('/offline.html',(req,res)=>res.sendFile(path.join(__dirname,'offline.html')));

  app.get('/api/live',(req,res)=>res.json({ok:true,status:'LIVE',version:core.VERSION,timestamp:new Date().toISOString()}));
  app.get('/api/ready',(req,res)=>{
    const r=core.readiness({mongoState:mongoose.connection.readyState,files:fileList(),env:process.env});
    res.status(r.ok?200:503).json({...r,version:core.VERSION,timestamp:new Date().toISOString()});
  });
  app.get('/api/enterprise/status',...sup,async(req,res)=>{
    const r=core.readiness({mongoState:mongoose.connection.readyState,files:fileList(),env:process.env});
    const mem=process.memoryUsage();
    res.status(r.ok?200:503).json({ok:r.ok,version:core.VERSION,readiness:r,release:core.releaseInfo(process.env),runtime:{node:process.version,uptimeSec:Math.round(process.uptime()),pid:process.pid,memory:{rss:mem.rss,heapUsed:mem.heapUsed,heapTotal:mem.heapTotal}},timestamp:new Date().toISOString()});
  });
  app.get('/api/enterprise/integrity',...admin,(req,res)=>{
    const items=fileList().map(f=>({file:f,sha256:shaFile(path.join(__dirname,f)),bytes:fs.statSync(path.join(__dirname,f)).size}));
    const aggregate=crypto.createHash('sha256').update(JSON.stringify(items)).digest('hex');
    res.json({ok:items.length===core.REQUIRED_FILES.length,version:core.VERSION,aggregate,items});
  });
  app.get('/api/enterprise/collections',...admin,async(req,res)=>{
    if(!mongoose.connection.db) return res.status(503).json({ok:false,error:'mongodb_unavailable'});
    const cols=await mongoose.connection.db.listCollections({}, {nameOnly:true}).toArray();
    const allow=cols.map(x=>safeCollectionName(x.name)).filter(Boolean).sort();
    const counts={};
    for(const name of allow){try{counts[name]=await mongoose.connection.db.collection(name).countDocuments({}, {limit:1000000})}catch{counts[name]=null}}
    res.json({ok:true,counts,timestamp:new Date().toISOString()});
  });
  app.get('/api/enterprise/export/:collection',...admin,async(req,res)=>{
    if(!mongoose.connection.db) return res.status(503).json({ok:false,error:'mongodb_unavailable'});
    const name=safeCollectionName(req.params.collection);
    const cols=await mongoose.connection.db.listCollections({name},{nameOnly:true}).toArray();
    if(!name||!cols.length) return res.status(404).json({ok:false,error:'collection_not_found'});
    const max=Math.min(5000,Math.max(1,Number(req.query.limit)||1000));
    const docs=await mongoose.connection.db.collection(name).find({}).limit(max).toArray();
    res.setHeader('Content-Disposition',`attachment; filename="nma-${name}-${Date.now()}.json"`);
    res.type('application/json').send(JSON.stringify({exportedAt:new Date().toISOString(),collection:name,count:docs.length,items:core.redact(docs)},null,2));
  });
  app.get('/enterprise-control',...admin,(req,res)=>res.sendFile(path.join(__dirname,'enterprise_control_v1.html')));
  return {version:core.VERSION};
}
module.exports={install};
