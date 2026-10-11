/* NMA BUILD OS MASTER — UI/UX FIELD EDITION 4.7.0
   DOM presentation only. No data/API mutation. */
(function(){
'use strict';
if(window.__NMA_UI47__) return;
window.__NMA_UI47__=true;
const UI_VERSION='4.7.0';
const CORE_VERSION='4.6.0';
const store={get:k=>{try{return localStorage.getItem(k)}catch(_){return null}},set:(k,v)=>{try{localStorage.setItem(k,v)}catch(_){}}};
const ready=fn=>document.readyState==='loading'?document.addEventListener('DOMContentLoaded',fn,{once:true}):fn();
function make(tag,cls,text){const el=document.createElement(tag);if(cls)el.className=cls;if(text!=null)el.textContent=text;return el}
function labelOf(a){return (a.textContent||'').replace(/\s+/g,' ').trim()}
function setA11y(){
  document.querySelectorAll('button:not([aria-label])').forEach(b=>{const t=(b.textContent||'').replace(/\s+/g,' ').trim();if(t)b.setAttribute('aria-label',t)});
  document.querySelectorAll('input:not([autocomplete])').forEach(i=>{const type=(i.type||'').toLowerCase();if(['password','search'].includes(type))i.setAttribute('autocomplete',type==='password'?'current-password':'off')});
  document.querySelectorAll('a[href]').forEach(a=>{if(!a.title){const t=labelOf(a);if(t.length>2)a.title=t}});
}
function groupMasterNav(nav){
  if(nav.dataset.ui47Grouped==='1')return;
  const anchors=[...nav.querySelectorAll(':scope > a')];
  if(!anchors.length)return;
  nav.dataset.ui47Grouped='1';
  const groups=[
    {key:'ops',title:'Operatività',open:true,items:['Dashboard','Mappa e Cantieri','Squadre e Mezzi','Work Order','Pianificazione']},
    {key:'assets',title:'Asset & Digital Twin',open:false,items:['Reti e Asset','Digital Twin','Documenti','GeoJSON & GIS','Asset Memory']},
    {key:'quality',title:'Qualità & Controllo',open:true,items:['Collaudi / API','Audit','Quality Gate','SAL']},
    {key:'direction',title:'Direzione',open:false,items:['Analisi e Reporting','Enterprise Control']}
  ];
  const byName=new Map(anchors.map(a=>[labelOf(a),a]));
  nav.textContent='';
  groups.forEach(g=>{
    const section=make('section','nma-nav-section'); section.dataset.group=g.key;
    const persisted=store.get('nma.ui47.nav.'+g.key);
    if(persisted==='open'||(persisted==null&&g.open))section.classList.add('open');
    const title=make('button','nma-nav-title',g.title); title.type='button'; title.setAttribute('aria-expanded',section.classList.contains('open')?'true':'false');
    const links=make('div','nma-nav-links');
    g.items.forEach(name=>{const a=byName.get(name);if(a){links.appendChild(a);byName.delete(name)}});
    title.addEventListener('click',()=>{const on=section.classList.toggle('open');title.setAttribute('aria-expanded',on?'true':'false');store.set('nma.ui47.nav.'+g.key,on?'open':'closed')});
    section.append(title,links);nav.appendChild(section);
  });
  if(byName.size){const section=make('section','nma-nav-section open');const title=make('button','nma-nav-title','Altri moduli');title.type='button';title.setAttribute('aria-expanded','true');const links=make('div','nma-nav-links');for(const a of byName.values())links.appendChild(a);title.addEventListener('click',()=>{const on=section.classList.toggle('open');title.setAttribute('aria-expanded',on?'true':'false')});section.append(title,links);nav.appendChild(section)}
}
function addQuickStrip(content){
  if(!content||content.querySelector('.nma-command-strip'))return;
  const bar=make('nav','nma-command-strip');bar.setAttribute('aria-label','Azioni rapide');
  const label=make('span','nma-command-label','Azioni rapide');
  const actions=[
    ['Nuovo intervento','/master-final/module/campo','primary'],
    ['Supervisione','/master-final/module/supervisore',''],
    ['Quality Gate','/master-final/module/quality',''],
    ['Passaporto','/master-final/module/passaporto','']
  ];
  bar.appendChild(label);
  actions.forEach(([text,href,cls])=>{const a=make('a',cls,text);a.href=href;bar.appendChild(a)});
  bar.appendChild(make('span','nma-command-spacer',''));
  const state=make('span','nma-command-state',navigator.onLine?'● ONLINE':'● OFFLINE');state.id='nmaUi47NetState';bar.appendChild(state);
  content.prepend(bar);
  const update=()=>{state.textContent=navigator.onLine?'● ONLINE':'● OFFLINE';state.style.color=navigator.onLine?'#2fd49d':'#e5ac39'};
  window.addEventListener('online',update);window.addEventListener('offline',update);
}
function addMobileMenu(app,topbar,sidebar){
  if(!app||!topbar||!sidebar||document.getElementById('nmaMobileMenu'))return;
  const btn=make('button','','☰');btn.id='nmaMobileMenu';btn.type='button';btn.setAttribute('aria-label','Apri menu');
  const scrim=make('div','nma-sidebar-scrim');document.body.appendChild(scrim);
  const close=()=>{document.body.classList.remove('nma-sidebar-open');btn.setAttribute('aria-expanded','false')};
  btn.addEventListener('click',()=>{const open=document.body.classList.toggle('nma-sidebar-open');btn.setAttribute('aria-expanded',open?'true':'false')});
  scrim.addEventListener('click',close);sidebar.addEventListener('click',e=>{if(e.target.closest('a')&&matchMedia('(max-width:900px)').matches)close()});
  topbar.prepend(btn);
}
function enhanceMaster(){
  const app=document.querySelector('.app');const sidebar=document.querySelector('.sidebar');const nav=sidebar?.querySelector('.nav');const topbar=document.querySelector('.topbar');const content=document.querySelector('.content');
  if(!app||!sidebar||!nav||!topbar||!content)return false;
  document.body.classList.add('nma-ui47-master');
  groupMasterNav(nav);addQuickStrip(content);addMobileMenu(app,topbar,sidebar);
  const brand=sidebar.querySelector('.side-brand>div:last-child');if(brand&&!brand.querySelector('.nma-ui47-badge'))brand.appendChild(make('span','nma-ui47-badge','UI/UX 4.7.0 · CORE 4.6.0'));
  const foot=sidebar.querySelector('.side-foot');if(foot&&!foot.querySelector('.nma-nav-expand')){
    const b=make('button','nma-nav-expand','Apri tutte le sezioni');b.type='button';let expanded=false;
    b.addEventListener('click',()=>{expanded=!expanded;document.querySelectorAll('.nma-nav-section').forEach(s=>{s.classList.toggle('open',expanded);s.querySelector('.nma-nav-title')?.setAttribute('aria-expanded',expanded?'true':'false')});b.textContent=expanded?'Compatta navigazione':'Apri tutte le sezioni'});foot.appendChild(b)
  }
  return true;
}
function moduleMeta(){
  if(document.querySelector('.app')||document.querySelector('.nma-ui47-page-meta'))return;
  const meta=make('div','nma-ui47-page-meta',`NMA BUILD OS · UI ${UI_VERSION} · CORE ${CORE_VERSION}`);document.body.appendChild(meta);
}
function markBusyButtons(){
  document.addEventListener('click',e=>{const b=e.target.closest('button');if(!b||b.disabled||b.dataset.ui47Busy==='1')return;if(!b.matches('[onclick]'))return;b.dataset.ui47Busy='1';setTimeout(()=>delete b.dataset.ui47Busy,500)},true);
}
ready(()=>{
  document.documentElement.dataset.nmaUi=UI_VERSION;
  document.body.classList.add('nma-ui47');
  enhanceMaster();setA11y();moduleMeta();markBusyButtons();requestAnimationFrame(()=>window.dispatchEvent(new Event('resize')));
});
window.NMAEnterpriseUI47=Object.freeze({version:UI_VERSION,core:CORE_VERSION});
})();
