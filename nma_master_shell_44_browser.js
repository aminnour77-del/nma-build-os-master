/* NMA-MASTER-SHELL-4.4.2-BROWSER */
(function(){
'use strict';
if(window.__NMA_MASTER_SHELL_44__) return;
window.__NMA_MASTER_SHELL_44__=true;
const registry={
 dashboard:{title:'Dashboard',href:'/master',embed:false},
 network:{title:'Reti e Asset',href:'/master-final/module/network',embed:true}, spatial:{title:'Digital Twin',href:'/spatial-twin',embed:true},
 control:{title:'Control Room',href:'/master-final/module/control',embed:true}, supervisore:{title:'Supervisore',href:'/master-final/module/supervisore',embed:true},
 audit:{title:'Audit',href:'/master-final/module/audit',embed:true}, sal:{title:'SAL / Report',href:'/master-final/module/sal',embed:true},
 workflow:{title:'Workflow Operatore',href:'/master-final/module/workflow',embed:true}, quality:{title:'Quality Gate',href:'/master-final/module/quality',embed:true},
 passport:{title:'Digital Passport',href:'/master-final/module/passaporto',embed:true}, asset:{title:'Asset Memory',href:'/master-final/module/asset',embed:true},
 command:{title:'Command Center',href:'/master-final/module/command',embed:true}, asbuilt:{title:'As-Built',href:'/master-final/module/asbuilt',embed:true},
 correzioni:{title:'Correzioni',href:'/master-final/module/correzioni',embed:true}, campo:{title:'Operatore Campo',href:'/master-final/module/campo',embed:true}, fieldx1:{title:'BUILD FIELD X1',href:'/field-x1',embed:true},
 digitalmemory:{title:'Digital Memory',href:'/digital-memory',embed:true}, master43:{title:'Master Enterprise',href:'/master43',embed:true}
};
const aliases={'/control-room':'control','/control_room':'control','/audit':'audit','/sal':'sal','/sal-v2':'sal','/direzione':'control','/ufficio':'control','/cantiere':'campo','/workflow':'workflow','/quality':'quality','/asset-memory':'asset','/asset_memory':'asset','/network-memory':'network','/network_memory':'network','/supervisore':'supervisore','/passaporto':'passport','/command-center':'command','/command_center':'command','/confronto-asbuilt':'asbuilt','/correzioni':'correzioni','/master-final/module/spatial':'spatial','/operatore-campo':'campo','/master-final/module/master43':'master43'};
function keyFor(raw){try{const u=new URL(raw,location.origin);if(u.origin!==location.origin)return null;let p=decodeURIComponent(u.pathname).replace(/\/{2,}/g,'/');if(p==='/'||p==='/master'||p==='/master/')return'dashboard';if(aliases[p])return aliases[p];if(/^\/passaporto\/[^/]+$/i.test(p))return'passport';if(/^\/confronto\/[^/]+$/i.test(p))return'asbuilt';for(const[k,v]of Object.entries(registry))if(v.href===p)return k;const m=p.match(/^\/master-final\/module\/([a-z0-9_-]+)$/i);if(m){const k=m[1].toLowerCase();const mapped=({passaporto:'passport',asset:'asset',network:'network',spatial:'spatial',control:'control',command:'command',asbuilt:'asbuilt',campo:'campo'})[k]||k;return Object.prototype.hasOwnProperty.call(registry,mapped)?mapped:null;}return null}catch(_){return null}}
function el(tag,id,cls){const x=document.createElement(tag);if(id)x.id=id;if(cls)x.className=cls;return x}
const stage=el('section','nmaMasterStage');stage.setAttribute('aria-label','Modulo NMA BUILD OS');
const bar=el('div','nmaMasterStageBar');
const home=el('button',null,'nmaShellBtn primary');home.type='button';home.textContent='DASHBOARD';
const back=el('button',null,'nmaShellBtn');back.type='button';back.textContent='← INDIETRO';
const title=el('div','nmaMasterStageTitle');title.textContent='NMA BUILD OS';
const meta=el('div','nmaMasterStageMeta');meta.textContent='MASTER SHELL 4.4.2';
const ext=el('button',null,'nmaShellBtn');ext.type='button';ext.textContent='APRI SEPARATO';
const close=el('button',null,'nmaShellBtn');close.type='button';close.textContent='×';close.setAttribute('aria-label','Chiudi modulo');
bar.append(home,back,title,meta,ext,close);
const wrap=el('div','nmaMasterFrameWrap');const frame=el('iframe','nmaMasterFrame');frame.title='Modulo NMA BUILD OS';frame.setAttribute('allow','geolocation; camera; microphone; clipboard-read; clipboard-write');frame.setAttribute('referrerpolicy','same-origin');
const loading=el('div','nmaMasterLoading');loading.textContent='CARICAMENTO MODULO…';wrap.append(frame,loading);stage.append(bar,wrap);document.body.appendChild(stage);
const toast=el('div','nmaMasterShellToast');document.body.appendChild(toast);let toastTimer;let currentKey=null;let availability=null;let loadWatchdog=null;
function say(s){toast.textContent=s;toast.classList.add('on');clearTimeout(toastTimer);toastTimer=setTimeout(()=>toast.classList.remove('on'),2200)}
function candidates(){return[...document.querySelectorAll('aside,.sidebar,[class*="sidebar"],nav')].filter(x=>{const r=x.getBoundingClientRect();return r.height>innerHeight*.45&&r.width>120&&r.width<420&&r.left<80}).sort((a,b)=>b.getBoundingClientRect().height-a.getBoundingClientRect().height)}
function headers(){return[...document.querySelectorAll('header,.topbar,.top,[class*="topbar"],[class*="header"]')].filter(x=>{const r=x.getBoundingClientRect();return r.width>innerWidth*.45&&r.height>30&&r.height<150&&r.top<30}).sort((a,b)=>b.getBoundingClientRect().width-a.getBoundingClientRect().width)}
function layout(){const s=candidates()[0]?.getBoundingClientRect();const h=headers()[0]?.getBoundingClientRect();let left=s?Math.max(0,s.right):0;let top=h?Math.max(0,h.bottom):0;if(innerWidth<=760){left=0;top=Math.max(58,top)}left=Math.min(left,Math.max(0,innerWidth-320));top=Math.min(top,160);Object.assign(stage.style,{left:left+'px',top:top+'px',right:'0',bottom:'0'})}
function setQuery(key,mode='push'){const u=new URL(location.href);u.searchParams.delete('module');if(key&&key!=='dashboard')u.searchParams.set('module',key);history[mode+'State']({nmaModule:key},'',u.pathname+u.search+u.hash)}
function closeStage(mode='push'){currentKey=null;stage.classList.remove('nma-on');document.body.classList.remove('nma-shell-module-open');frame.src='about:blank';title.textContent='NMA BUILD OS';if(mode)setQuery(null,mode);}
function openKey(key,mode='push'){const item=registry[key];if(!item)return false;if(key==='dashboard'){closeStage(mode);return true}if(!item.embed)return false;if(availability&&availability[key]===false){say('Modulo non disponibile: '+item.title);return false}currentKey=key;layout();title.textContent=item.title;meta.textContent='NMA BUILD OS MASTER · '+item.href;stage.classList.add('nma-on');document.body.classList.add('nma-shell-module-open');loading.textContent='CARICAMENTO MODULO…';loading.classList.add('on');clearTimeout(loadWatchdog);loadWatchdog=setTimeout(()=>{if(currentKey===key&&loading.classList.contains('on')){loading.textContent='MODULO NON CARICATO · VERIFICA ROUTE/FRAME POLICY';say('Caricamento modulo non completato: '+item.title)}},8000);if(frame.getAttribute('src')!==item.href)frame.src=item.href;if(mode)setQuery(key,mode);return true}
function openHref(href,mode='push'){const k=keyFor(href);return k?openKey(k,mode):false}
function installChildBridge(){try{const w=frame.contentWindow,d=w.document;const p=w.location.pathname;if(p==='/'){window.location.assign('/');return}if(p==='/master'||p==='/master/'){closeStage('replace');return}const k=keyFor(w.location.href);if(k&&k!==currentKey){currentKey=k;title.textContent=registry[k]?.title||'NMA BUILD OS';setQuery(k,'replace')}d.addEventListener('click',e=>{if(e.defaultPrevented||e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;const a=e.target.closest&&e.target.closest('a[href]');if(!a||a.hasAttribute('download')||a.target==='_blank')return;const href=a.getAttribute('href');const key=keyFor(href);if(!key)return;e.preventDefault();if(key==='dashboard')closeStage('push');else openKey(key,'push')},true)}catch(_){}}
frame.addEventListener('load',()=>{clearTimeout(loadWatchdog);let ok=false;try{const d=frame.contentDocument;ok=Boolean(d&&d.body&&d.body.innerText.trim().length>0)}catch(_){}if(ok){loading.classList.remove('on');installChildBridge()}else{loading.textContent='MODULO CARICATO SENZA CONTENUTO VISIBILE';loading.classList.add('on');say('Modulo senza contenuto visibile')}});
home.onclick=()=>closeStage('push');close.onclick=()=>closeStage('push');back.onclick=()=>history.back();ext.onclick=()=>{if(currentKey)window.open(registry[currentKey].href,'_blank','noopener')};
document.addEventListener('click',e=>{if(e.defaultPrevented||e.button!==0||e.metaKey||e.ctrlKey||e.shiftKey||e.altKey)return;const a=e.target.closest&&e.target.closest('a[href]');if(!a||a.hasAttribute('download')||a.target==='_blank')return;const key=keyFor(a.getAttribute('href'));if(!key||key==='dashboard')return;e.preventDefault();openKey(key,'push')},true);
window.addEventListener('popstate',()=>{const key=new URL(location.href).searchParams.get('module');if(key&&registry[key])openKey(key,null);else closeStage(null)});window.addEventListener('resize',layout);document.addEventListener('keydown',e=>{if(e.key==='Escape'&&currentKey)closeStage('push')});
fetch('/api/master44/modules',{credentials:'same-origin',cache:'no-store'}).then(r=>r.ok?r.json():Promise.reject(new Error('health '+r.status))).then(j=>{availability={};for(const x of j.items||[])availability[x.key]=x.available;if(!j.ok)say('Master Shell: modulo mancante')}).catch(()=>{availability=null});
const initial=new URL(location.href).searchParams.get('module');if(initial&&registry[initial])openKey(initial,null);layout();
window.NMAMasterShell44={version:'4.4.2',open:openKey,openHref,close:()=>closeStage('push'),registry:Object.freeze(registry)};
})();
