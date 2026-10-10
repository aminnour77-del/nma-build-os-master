
'use strict';
const fs=require('fs'); const path=require('path'); const crypto=require('crypto');
function text(v,f=''){return v===undefined||v===null?f:String(v).trim()}
function redact(obj){const blocked=new Set(['password','token','secret','apiKey','api_key','margin','internalCost','cost']); const walk=v=>{if(Array.isArray(v))return v.map(walk);if(v&&typeof v==='object'){const o={};for(const [k,x] of Object.entries(v))if(!blocked.has(k))o[k]=walk(x);return o}return v};return walk(obj)}
function readiness({mongoConnected=false,files=[],required=[],auditOk=true}={}){const missing=required.filter(x=>!files.includes(x));const checks={mongoConnected:Boolean(mongoConnected),filesComplete:missing.length===0,auditOk:Boolean(auditOk)};const pass=Object.values(checks).every(Boolean);return {status:pass?'PASS':'STOP',checks,missing}}
function permission(role,action){const matrix={operatore:new Set(['field.read','field.write','memory.read']),supervisore:new Set(['field.read','field.write','memory.read','memory.write','business.read','quality.share']),admin:new Set(['field.read','field.write','memory.read','memory.write','business.read','quality.share','audit.read','system.read'])};return Boolean(matrix[role]&&matrix[role].has(action))}
function auditHash(event={}){return crypto.createHash('sha256').update(JSON.stringify(redact(event))).digest('hex')}

function install({app,mongoose,requireAuth,requireRole}){
 if(!app||!mongoose) throw new Error('NMA Master 4.3: app/mongoose mancanti');
 const Mixed=mongoose.Schema.Types.Mixed; const AuditSchema=new mongoose.Schema({eventId:{type:String,unique:true,index:true},type:String,actor:String,role:String,target:String,payload:Mixed,hash:String,createdAt:{type:Date,default:Date.now}},{minimize:false}); const Audit=mongoose.models.NMAMasterAudit43||mongoose.model('NMAMasterAudit43',AuditSchema);
 const auth=typeof requireAuth==='function'?requireAuth:(q,s,n)=>n(); const roles=(...r)=>typeof requireRole==='function'?requireRole(...r):(q,s,n)=>n(); const sup=[auth,roles('supervisore','admin')]; const admin=[auth,roles('admin')];
 const required=['nma_field_engine.js','field_x1_v1.html','nma_digital_memory.js','digital_memory_v1.html','master_43.html'];
 app.get('/api/master43/health',...sup,(req,res)=>{const files=required.filter(f=>fs.existsSync(path.join(__dirname,f)));const r=readiness({mongoConnected:mongoose.connection&&mongoose.connection.readyState===1,files,required,auditOk:true});res.status(r.status==='PASS'?200:503).json({ok:r.status==='PASS',product:'NMA BUILD OS MASTER',version:'4.3',readiness:r,policy:{fakeNetwork:false,paidAIRequired:false,pushAutomatic:false,deployAutomatic:false}})});
 app.post('/api/master43/audit',...sup,async(req,res)=>{const b=redact(req.body||{});const event={eventId:`audit-${crypto.randomBytes(8).toString('hex')}`,type:text(b.type,'EVENT'),actor:text(b.actor),role:text(b.role),target:text(b.target),payload:b.payload||null};event.hash=auditHash(event);const d=await Audit.create(event);res.status(201).json({ok:true,event:{eventId:d.eventId,type:d.type,target:d.target,hash:d.hash,createdAt:d.createdAt}})});
 app.get('/api/master43/audit',...admin,async(req,res)=>{const items=await Audit.find({}).sort({createdAt:-1}).limit(200).lean();res.json({ok:true,items:items.map(redact)})});
 app.get('/api/master43/permissions',...sup,(req,res)=>{const role=text(req.query.role,'operatore');const actions=['field.read','field.write','memory.read','memory.write','business.read','quality.share','audit.read','system.read'];res.json({ok:true,role,actions:Object.fromEntries(actions.map(a=>[a,permission(role,a)]))})});
 app.get('/master43',...sup,(req,res)=>res.sendFile(path.join(__dirname,'master_43.html')));
 return {Audit};
}
module.exports={install,redact,readiness,permission,auditHash};
