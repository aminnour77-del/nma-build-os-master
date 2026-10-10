'use strict';

const REGISTRY = Object.freeze([
  { key:'dashboard', title:'Dashboard', href:'/master', file:'master_control_v1.html', embed:false },
  { key:'network', title:'Reti e Asset', href:'/master-final/module/network', file:'network_memory_v1.html', embed:true },
  { key:'spatial', title:'Digital Twin', href:'/spatial-twin', file:'spatial_twin_v1.html', embed:true },
  { key:'control', title:'Control Room', href:'/master-final/module/control', file:'control_room_v2.html', embed:true },
  { key:'supervisore', title:'Supervisore', href:'/master-final/module/supervisore', file:'supervisore_v1.html', embed:true },
  { key:'audit', title:'Audit', href:'/master-final/module/audit', file:'audit_v1.html', embed:true },
  { key:'sal', title:'SAL / Report', href:'/master-final/module/sal', file:'sal_v2.html', embed:true },
  { key:'workflow', title:'Workflow Operatore', href:'/master-final/module/workflow', file:'workflow_v1.html', embed:true },
  { key:'quality', title:'Quality Gate', href:'/master-final/module/quality', file:'quality_v1.html', embed:true },
  { key:'passport', title:'Digital Passport', href:'/master-final/module/passaporto', file:'passaporto_v1.html', embed:true },
  { key:'asset', title:'Asset Memory', href:'/master-final/module/asset', file:'asset_memory_v1.html', embed:true },
  { key:'command', title:'Command Center', href:'/master-final/module/command', file:'command_center_v1.html', embed:true },
  { key:'asbuilt', title:'As-Built', href:'/master-final/module/asbuilt', file:'confronto_asbuilt_v1.html', embed:true },
  { key:'correzioni', title:'Correzioni', href:'/master-final/module/correzioni', file:'correzioni_v1.html', embed:true },
  { key:'campo', title:'Operatore Campo', href:'/master-final/module/campo', file:'campo_operatore_v1.html', embed:true },
  { key:'fieldx1', title:'BUILD FIELD X1', href:'/field-x1', file:'field_x1_v1.html', embed:true },
  { key:'digitalmemory', title:'Digital Memory', href:'/digital-memory', file:'digital_memory_v1.html', embed:true },
  { key:'master43', title:'Master Enterprise', href:'/master43', file:'master_43.html', embed:true }
]);

const BY_KEY = new Map(REGISTRY.map(x => [x.key, x]));
const ALIASES = new Map([
  ['/control-room','control'], ['/control_room','control'], ['/audit','audit'], ['/sal','sal'], ['/sal-v2','sal'], ['/direzione','control'], ['/ufficio','control'], ['/cantiere','campo'],
  ['/workflow','workflow'], ['/quality','quality'], ['/asset-memory','asset'], ['/asset_memory','asset'],
  ['/network-memory','network'], ['/network_memory','network'], ['/supervisore','supervisore'],
  ['/passaporto','passport'], ['/command-center','command'], ['/command_center','command'],
  ['/confronto-asbuilt','asbuilt'], ['/correzioni','correzioni'], ['/master-final/module/spatial','spatial'],
  ['/operatore-campo','campo'], ['/master-final/module/master43','master43']
]);

function safeUrl(raw, base='http://nma.local') {
  if (typeof raw !== 'string') return null;
  const v = raw.trim();
  if (!v || /^\s*(?:javascript|data|vbscript|file):/i.test(v) || v.startsWith('//')) return null;
  let u;
  try { u = new URL(v, base); } catch (_) { return null; }
  const b = new URL(base);
  if (!['http:','https:'].includes(u.protocol) || u.origin !== b.origin) return null;
  if (u.username || u.password) return null;
  return u;
}

function cleanPath(raw) {
  const u = safeUrl(raw);
  if (!u) return null;
  let p = u.pathname.replace(/\/{2,}/g,'/');
  try { p = decodeURIComponent(p); } catch (_) { return null; }
  if (p.includes('..') || p.includes('\\')) return null;
  return p || '/';
}

function classifyHref(raw) {
  const p = cleanPath(raw);
  if (!p) return null;
  if (p === '/' || p === '/master' || p === '/master/') return BY_KEY.get('dashboard');
  if (ALIASES.has(p)) return BY_KEY.get(ALIASES.get(p));
  if (/^\/passaporto\/[^/]+$/i.test(p)) return BY_KEY.get('passport');
  if (/^\/confronto\/[^/]+$/i.test(p)) return BY_KEY.get('asbuilt');
  for (const item of REGISTRY) {
    if (item.href === p) return item;
  }
  const m = p.match(/^\/master-final\/module\/([a-z0-9_-]+)$/i);
  if (m) {
    const k = m[1].toLowerCase();
    const alias = ({passaporto:'passport', asset:'asset', network:'network', spatial:'spatial', control:'control', command:'command', asbuilt:'asbuilt', campo:'campo'})[k] || k;
    return BY_KEY.get(alias) || null;
  }
  return null;
}

function keyForHref(raw) { const x = classifyHref(raw); return x ? x.key : null; }
function hrefForKey(key) { const x = BY_KEY.get(String(key||'').toLowerCase()); return x ? x.href : null; }
function titleForKey(key) { const x = BY_KEY.get(String(key||'').toLowerCase()); return x ? x.title : 'NMA BUILD OS'; }
function shouldEmbedHref(raw) { const x=classifyHref(raw); return Boolean(x && x.embed); }
function isDashboardHref(raw) { const x=classifyHref(raw); return Boolean(x && x.key==='dashboard'); }
function moduleFromSearch(search='') {
  const s = String(search||'').replace(/^\?/,'');
  const q = new URLSearchParams(s);
  const key = String(q.get('module')||'').toLowerCase();
  return BY_KEY.has(key) && key !== 'dashboard' ? key : null;
}
function searchForModule(key, currentSearch='') {
  const q = new URLSearchParams(String(currentSearch||'').replace(/^\?/,''));
  q.delete('module');
  if (BY_KEY.has(key) && key !== 'dashboard') q.set('module', key);
  const s=q.toString();
  return s ? `?${s}` : '';
}
function stageLayout(viewportWidth, sidebarRight, headerBottom) {
  const vw = Math.max(0, Number(viewportWidth)||0);
  let left = Math.max(0, Number(sidebarRight)||0);
  let top = Math.max(0, Number(headerBottom)||0);
  if (vw <= 760) { left = 0; top = Math.max(58, top); }
  left = Math.min(left, Math.max(0, vw-320));
  top = Math.min(top, 160);
  return {left:Math.round(left), top:Math.round(top)};
}
function sanitizeLabel(v, max=80) {
  return String(v??'').replace(/[<>\u0000-\u001f]/g,' ').replace(/\s+/g,' ').trim().slice(0,max);
}
function registryHealth(existingFiles=[]) {
  const s = new Set(existingFiles);
  const required = REGISTRY.filter(x=>x.embed).map(x=>x.file);
  const missing = required.filter(f=>!s.has(f));
  return {ok:missing.length===0, required:required.length, available:required.length-missing.length, missing};
}

module.exports={REGISTRY,safeUrl,cleanPath,classifyHref,keyForHref,hrefForKey,titleForKey,shouldEmbedHref,isDashboardHref,moduleFromSearch,searchForModule,stageLayout,sanitizeLabel,registryHealth};
