'use strict';
const fs = require('fs');
const path = require('path');
const core = require('./nma_master_shell_44_core');

function install({app, requireAuth, requireRole}) {
  if (!app) throw new Error('NMA Master Shell 4.4: app mancante');
  const auth = typeof requireAuth==='function' ? requireAuth : (_q,_s,n)=>n();
  const role = typeof requireRole==='function' ? requireRole('supervisore','admin') : (_q,_s,n)=>n();
  const guard=[auth,role];
  const snapshot=()=>{
    const files=fs.readdirSync(__dirname);
    const health=core.registryHealth(files);
    return {
      ok:health.ok,
      product:'NMA BUILD OS MASTER', version:'4.5.0', shell:'UNIFIED_MASTER_SHELL',
      modules:core.REGISTRY.filter(x=>x.embed).map(x=>({...x,available:fs.existsSync(path.join(__dirname,x.file))})),
      health,
      policy:{singleShell:true, standaloneFallback:true, externalNavigationBlocked:true, noPush:true, noDeploy:true}
    };
  };
  app.get('/api/master44/health',...guard,(_req,res)=>{
    res.setHeader('Cache-Control','no-store');
    const s=snapshot();
    res.status(s.ok?200:503).json(s);
  });
  app.get('/api/master44/modules',...guard,(_req,res)=>{
    res.setHeader('Cache-Control','no-store');
    const s=snapshot();
    res.status(s.ok?200:503).json({ok:s.ok,version:s.version,items:s.modules,missing:s.health.missing});
  });
  return {snapshot};
}
module.exports={install};
