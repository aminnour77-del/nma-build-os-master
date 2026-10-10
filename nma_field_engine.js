
'use strict';
const crypto = require('crypto');

const STEP_ORDER = ['preflight','safety','materials','survey','execution','quality','closeout'];
const SAFE_JOB_TYPES = ['scavo','impianto_aereo','pronto_intervento','saldatura_pe','posa_rete','manutenzione','rilievo'];
const DEVICE_PROFILE = Object.freeze({
  display: 'iPad 10th generation',
  core: 'GMKtec mini-PC',
  lidar: 'Unitree L2',
  rtk: 'u-blox ZED-F9P + multiband GNSS antenna',
  visibleCamera: 'USB 16MP autofocus',
  thermal: 'TOPDON TC002C Duo',
  wallMode: 'Bosch GMS 120-27 removable',
  identification: 'ACR122U NFC/RFID',
  storage: 'Samsung T7 Shield',
  principle: 'one SCAN -> many synchronized evidences'
});

function text(v, fallback='') { return v===undefined || v===null ? fallback : String(v).trim(); }
function num(v, fallback=0) { const n=Number(v); return Number.isFinite(n) ? n : fallback; }
function clamp(n,min,max){ return Math.max(min,Math.min(max,n)); }
function id(prefix='nma'){ return `${prefix}-${crypto.randomBytes(8).toString('hex')}`; }
function sha256(value){ return crypto.createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex'); }
function sanitizeRef(v){ const s=text(v); return s.length<=500 ? s : s.slice(0,500); }

function normalizeSensorPacket(raw={}) {
  const p = raw && typeof raw === 'object' ? raw : {};
  const rtk = p.rtk && typeof p.rtk==='object' ? p.rtk : {};
  const lat=num(rtk.lat, NaN), lon=num(rtk.lon, NaN), accuracy=num(rtk.accuracyM, NaN);
  const validGeo=Number.isFinite(lat)&&Number.isFinite(lon)&&Math.abs(lat)<=90&&Math.abs(lon)<=180;
  const packet={
    capturedAt: text(p.capturedAt) || new Date().toISOString(),
    rtk: validGeo ? {lat,lon,accuracyM:Number.isFinite(accuracy)?Math.max(0,accuracy):null,fix:text(rtk.fix,'unknown')} : null,
    lidar: p.lidar ? {ref:sanitizeRef(p.lidar.ref), pointCount:Math.max(0,Math.round(num(p.lidar.pointCount,0)))} : null,
    camera: p.camera ? {ref:sanitizeRef(p.camera.ref), width:Math.max(0,Math.round(num(p.camera.width,0))), height:Math.max(0,Math.round(num(p.camera.height,0)))} : null,
    thermal: p.thermal ? {ref:sanitizeRef(p.thermal.ref), minC:num(p.thermal.minC,NaN), maxC:num(p.thermal.maxC,NaN)} : null,
    nfc: p.nfc ? {uid:text(p.nfc.uid).slice(0,128)} : null,
    wallMode: p.wallMode ? {result:text(p.wallMode.result).slice(0,250), manual:true} : null,
    note:text(p.note).slice(0,1000)
  };
  packet.hash=sha256(packet);
  return packet;
}

function materialVariance(planned=[], actual=[]) {
  const idx = new Map();
  for(const x of planned||[]) idx.set(text(x.code), {code:text(x.code), planned:num(x.qty), actual:0, unit:text(x.unit,'pz')});
  for(const x of actual||[]){ const k=text(x.code); const v=idx.get(k)||{code:k,planned:0,actual:0,unit:text(x.unit,'pz')}; v.actual += num(x.qty); idx.set(k,v); }
  return [...idx.values()].map(x=>({...x,variance:Math.round((x.actual-x.planned)*1000)/1000,wastePct:x.planned>0?Math.round(Math.max(0,(x.actual-x.planned)/x.planned*100)*10)/10:0}));
}

function computeReadiness(job={}) {
  const reasons=[];
  const zone=text(job.safetyZone,'ordinary').toLowerCase();
  if(['atex','atex_unknown','potentially_explosive'].includes(zone) && !job.atexApproved) reasons.push('X1 non autorizzato per area ATEX/potenzialmente esplosiva');
  const steps=job.steps||{};
  for(const s of STEP_ORDER.slice(0,-1)) if(!steps[s] || steps[s].status!=='done') reasons.push(`fase_${s}_non_completa`);
  const scan=job.latestScan||null;
  if(!scan) reasons.push('scan_mancante');
  else {
    if(!scan.rtk) reasons.push('rtk_mancante');
    if(!scan.camera) reasons.push('foto_mancante');
    if(!scan.lidar) reasons.push('lidar_mancante');
  }
  const status = reasons.length ? 'STOP' : 'PASS';
  return {status,reasons,next:status==='PASS'?'chiusura_autorizzabile':'completare_controlli'};
}

function nextAction(job={}){
  const zone=text(job.safetyZone,'ordinary').toLowerCase();
  if(['atex','atex_unknown','potentially_explosive'].includes(zone) && !job.atexApproved) return {code:'SAFETY_STOP',label:'Non usare X1: attendere autorizzazione HSE/ATEX'};
  const steps=job.steps||{};
  for(const k of STEP_ORDER){ if(!steps[k] || steps[k].status!=='done') return {code:k.toUpperCase(),label:`Completa fase: ${k}`}; }
  return {code:'COMPLETE',label:'Lavoro completato'};
}

function anonymousBestPractice(record={}){
  return {jobType:text(record.jobType),durationMin:num(record.durationMin),materialWastePct:num(record.materialWastePct),qualityScore:clamp(num(record.qualityScore),0,100),method:text(record.method).slice(0,500)};
}

function install({app,mongoose,requireAuth,requireRole}){
  if(!app||!mongoose) throw new Error('NMA Field Engine: app/mongoose mancanti');
  const Mixed=mongoose.Schema.Types.Mixed;
  const JobSchema=new mongoose.Schema({jobId:{type:String,unique:true,index:true},cantiereId:String,jobType:String,status:{type:String,default:'open'},safetyZone:{type:String,default:'ordinary'},atexApproved:{type:Boolean,default:false},teamId:String,steps:{type:Mixed,default:{}},materialsPlanned:{type:[Mixed],default:[]},materialsActual:{type:[Mixed],default:[]},latestScan:{type:Mixed,default:null},createdAt:{type:Date,default:Date.now},updatedAt:{type:Date,default:Date.now}},{minimize:false});
  const ScanSchema=new mongoose.Schema({scanId:{type:String,unique:true,index:true},jobId:{type:String,index:true},packet:Mixed,integrityHash:String,createdAt:{type:Date,default:Date.now}},{minimize:false});
  const BestSchema=new mongoose.Schema({jobType:String,durationMin:Number,materialWastePct:Number,qualityScore:Number,method:String,createdAt:{type:Date,default:Date.now}});
  const Job=mongoose.models.NMAFieldJob41||mongoose.model('NMAFieldJob41',JobSchema);
  const Scan=mongoose.models.NMAFieldScan41||mongoose.model('NMAFieldScan41',ScanSchema);
  const Best=mongoose.models.NMABestPractice41||mongoose.model('NMABestPractice41',BestSchema);
  const auth=typeof requireAuth==='function'?requireAuth:(req,res,next)=>next();
  const roles=(...r)=>typeof requireRole==='function'?requireRole(...r):(req,res,next)=>next();
  const operator=[auth,roles('operatore','supervisore','admin')];
  const supervisor=[auth,roles('supervisore','admin')];

  app.get('/api/field/device-profile',...operator,(req,res)=>res.json({ok:true,profile:DEVICE_PROFILE}));
  app.post('/api/field/jobs',...operator,async(req,res)=>{ try { const b=req.body||{}; const jobId=text(b.jobId)||id('job'); const jobType=text(b.jobType,'rilievo'); if(!SAFE_JOB_TYPES.includes(jobType)) return res.status(400).json({ok:false,error:'job_type_invalid'}); const d=await Job.create({jobId,cantiereId:text(b.cantiereId),jobType,teamId:text(b.teamId),safetyZone:text(b.safetyZone,'ordinary'),atexApproved:Boolean(b.atexApproved),materialsPlanned:Array.isArray(b.materialsPlanned)?b.materialsPlanned:[],steps:{preflight:{status:'pending'},safety:{status:'pending'},materials:{status:'pending'},survey:{status:'pending'},execution:{status:'pending'},quality:{status:'pending'},closeout:{status:'pending'}}}); res.status(201).json({ok:true,job:d}); } catch(e){ res.status(400).json({ok:false,error:'job_create_failed',detail:e.message}); } });
  app.get('/api/field/jobs/:id',...operator,async(req,res)=>{ const d=await Job.findOne({jobId:req.params.id}).lean(); if(!d)return res.status(404).json({ok:false,error:'job_not_found'}); res.json({ok:true,job:d,readiness:computeReadiness(d),nextAction:nextAction(d),materials:materialVariance(d.materialsPlanned,d.materialsActual)}); });
  app.post('/api/field/jobs/:id/step/:step',...operator,async(req,res)=>{ const k=text(req.params.step); if(!STEP_ORDER.includes(k))return res.status(400).json({ok:false,error:'step_invalid'}); const d=await Job.findOne({jobId:req.params.id}); if(!d)return res.status(404).json({ok:false,error:'job_not_found'}); const steps=d.steps||{}; steps[k]={status:'done',at:new Date().toISOString(),note:text((req.body||{}).note).slice(0,500)}; d.steps=steps; d.markModified('steps'); d.updatedAt=new Date(); await d.save(); res.json({ok:true,nextAction:nextAction(d.toObject())}); });
  app.post('/api/field/jobs/:id/materials',...operator,async(req,res)=>{ const d=await Job.findOne({jobId:req.params.id}); if(!d)return res.status(404).json({ok:false,error:'job_not_found'}); d.materialsActual=Array.isArray((req.body||{}).items)?req.body.items:[]; d.updatedAt=new Date(); await d.save(); res.json({ok:true,variance:materialVariance(d.materialsPlanned,d.materialsActual)}); });
  app.post('/api/field/jobs/:id/scan',...operator,async(req,res)=>{ const d=await Job.findOne({jobId:req.params.id}); if(!d)return res.status(404).json({ok:false,error:'job_not_found'}); const zone=text(d.safetyZone,'ordinary').toLowerCase(); if(['atex','atex_unknown','potentially_explosive'].includes(zone) && !d.atexApproved) return res.status(409).json({ok:false,error:'safety_stop',message:'X1 non autorizzato per questa area'}); const packet=normalizeSensorPacket(req.body||{}); const scanId=id('scan'); await Scan.create({scanId,jobId:d.jobId,packet,integrityHash:packet.hash}); d.latestScan=packet; d.updatedAt=new Date(); await d.save(); res.status(201).json({ok:true,scanId,hash:packet.hash,readiness:computeReadiness(d.toObject())}); });
  app.get('/api/field/jobs/:id/guidance',...operator,async(req,res)=>{ const d=await Job.findOne({jobId:req.params.id}).lean(); if(!d)return res.status(404).json({ok:false,error:'job_not_found'}); const top=await Best.find({jobType:d.jobType}).sort({qualityScore:-1,durationMin:1}).limit(3).lean(); res.json({ok:true,nextAction:nextAction(d),readiness:computeReadiness(d),bestPractices:top.map(anonymousBestPractice),identityPolicy:'operator identity intentionally excluded'}); });
  app.post('/api/field/best-practices',...supervisor,async(req,res)=>{ const a=anonymousBestPractice(req.body||{}); const d=await Best.create(a); res.status(201).json({ok:true,item:anonymousBestPractice(d.toObject())}); });
  app.get('/field-x1',...operator,(req,res)=>res.sendFile(require('path').join(__dirname,'field_x1_v1.html')));
  return {Job,Scan,Best};
}

module.exports={install,STEP_ORDER,SAFE_JOB_TYPES,DEVICE_PROFILE,normalizeSensorPacket,materialVariance,computeReadiness,nextAction,anonymousBestPractice,sha256};
