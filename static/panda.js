const CATS={
  systeme:{i:'⚙️',l:'Système',c:'#888780'},maison:{l:"Maison",i:"🏠",c:'#378add'},cuisine:{l:"Cuisine",i:"🍳",c:'#e8a06a'},meteo:{l:"Météo",i:"🌤️",c:'#f0b429'},agenda:{l:"Agenda",i:"📆",c:'#7aa2f7'},media:{l:"Média",i:"▶️",c:'#534ab7'},docs:{l:"Docs",i:"📁",c:'#639922'},jardin:{l:"Jardin",i:"🌱",c:'#5ac8a8'},transport:{l:"Transport",i:"🚆",c:'#378add'},infra:{l:"Infra",i:"🖥️",c:'#e0892b'},utils:{l:"Utils",i:"🧰",c:'#888780'}};
/* Catalogue d'addons — plus rien en dur : tout vient du registre serveur
   (/api/registry), chargé par loadRegistry() avant la première lecture de BYID. */
let ADDONS=[],BYID={},CFG_DOC={},CFG_SCHEMA={},DEF=[],REGISTRY_ERRORS={};
async function loadRegistry(){
  for(let essai=0;essai<2;essai++){
    try{
      const r=await fetch('/api/registry');
      if(!r.ok)throw new Error('HTTP '+r.status);
      const d=await r.json();
      ADDONS=d.tiles||[];
      BYID=Object.fromEntries(ADDONS.map(a=>[a.id,a]));
      CFG_SCHEMA=d.schema||{};
      CFG_DOC=d.doc||{};
      DEF=(d.defaults||[]).slice();
      REGISTRY_ERRORS=d.errors||{};
      return true;
    }catch(e){
      if(essai===0)await new Promise(res=>setTimeout(res,1500));
    }
  }
  if(typeof toast==='function')toast('Catalogue d\'addons injoignable — réessaie');
  return false;
}

let state={installed:[],hidden:[],order:[],railOn:false,railMode:'both',lockEnabled:true,autolock:0,theme:"dark",ntp:true,names:{},catOrder:[],vkb:true,agCals:{},radioFav:[],timers:[],transFav:[],delMode:false,timerSound:'',timerDisplay:'text',appCat:{},catCustom:{},catNames:{},fontScale:100,browserPw:false,iconStyle:'tabler',wifiInd:true,btInd:true,clockFmt:'24h',clockSec:false,dateFmt:'long',catHidden:[],storeCheck:'open',storeUrl:'',storeToken:'',storeMode:'officiel',storePubkey:'',veilleMode:'off',veilleOff:0,font:'system'};
function dnm(a){return (state.names&&state.names[a.id])||a.nm;}
/* Icônes Tabler : mapping emoji → nom d'icône, + helper de rendu.
   Fallback : un emoji non mappé est affiché tel quel. ic() renvoie du HTML
   (à insérer via innerHTML, jamais textContent). */
function omCP(e){if(OMSUB[e])return OMSUB[e];return [...e].map(c=>c.codePointAt(0).toString(16).toUpperCase()).filter(c=>c!=='FE0F').join('-');}
function ic(e,color){var k=(e||'').replace(/\uFE0F/g,'');var col=color?' style="color:'+color+'"':'';var n=ICMAPS.tabler[k];return '<i class="ti ti-'+(n||'square-rounded')+'"'+col+'></i>';}
/* tileIcon : logo SVG embarque de l'addon si present, sinon icone emoji (ic()). */
function tileIcon(a){
  if(a&&a.logo){var aid=a.addon||a.id;return '<img class="tilogo" src="/addons/'+encodeURIComponent(aid)+'/ui/'+encodeURIComponent(a.logo)+'?v='+encodeURIComponent(a.ver||'0')+'" alt="'+((a.nm||a.name||'')+'').replace(/"/g,'')+'" onerror="this.replaceWith(document.createRange().createContextualFragment(this.getAttribute(\'data-fb\')||\'\'))" data-fb="'+ic(a.ic||a.icon,a.cc||a.color).replace(/"/g,'&quot;')+'">';}
  return ic(a?(a.ic||a.icon):'',a?(a.cc||a.color):'');
}

const ICON_SKIP='.ti,.bi,.fa-solid,.fa-brands,.omico,[data-e],script,style,select,option,textarea,input';
function iconifyInline(root){root=root||document.body;if(root.nodeType===1&&root.closest&&root.closest(ICON_SKIP))return;var w=document.createTreeWalker(root,NodeFilter.SHOW_TEXT,null,false),ns=[],n;while(n=w.nextNode()){if(ICON_RE.test(n.nodeValue))ns.push(n);}ns.forEach(function(tn){var p=tn.parentNode;if(!p||!p.closest||p.closest(ICON_SKIP))return;var parts=tn.nodeValue.split(ICON_RE),frag=document.createDocumentFragment();parts.forEach(function(pt){if(pt==null||pt==='')return;if(ICON_SET.has(pt)){var sp=document.createElement('span');sp.setAttribute('data-e',pt);sp.innerHTML=ic(pt);frag.appendChild(sp);}else{frag.appendChild(document.createTextNode(pt));}});p.replaceChild(frag,tn);});}
function restyleInline(){document.querySelectorAll('span[data-e]').forEach(function(sp){sp.innerHTML=ic(sp.getAttribute('data-e'));});}
var _icoPending=false;var _icoObs=new MutationObserver(function(){if(_icoPending)return;_icoPending=true;setTimeout(function(){_icoPending=false;iconifyInline(document.body);},40);});
function startIconify(){try{_icoObs.observe(document.body,{childList:true,subtree:true});iconifyInline(document.body);}catch(e){}}
function sanitize(){
  state.iconStyle='tabler';
  state.installed=(state.installed||[]).filter(id=>BYID[id]);
  // un addon du store présent sur disque DOIT figurer dans les installés :
  // répare une éventuelle désynchronisation (ex. retrait local sans vraie désinstall).
  Object.keys(BYID).forEach(id=>{if(BYID[id].source==='store'&&!state.installed.includes(id))state.installed.push(id);});
  state.hidden=(state.hidden||[]).filter(id=>BYID[id]);
  state.order=(state.order||[]).filter(id=>state.installed.includes(id));
  state.installed.forEach(id=>{if(!state.order.includes(id))state.order.push(id);});
}
let pushT;
function save(){
  clearTimeout(pushT);
  pushT=setTimeout(()=>{fetch('/api/config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({connBar:state.connBar,installed:state.installed,hidden:state.hidden,order:state.order,railOn:state.railOn,railMode:state.railMode,theme:state.theme,ntp:state.ntp,autolock:state.autolock,lockEnabled:state.lockEnabled,names:state.names,catOrder:state.catOrder,appCat:state.appCat,catCustom:state.catCustom,catNames:state.catNames,catColors:state.catColors,catIcons:state.catIcons,vkb:state.vkb,agCals:state.agCals,radioFav:state.radioFav,timers:state.timers,transFav:state.transFav,delMode:state.delMode,timerDisplay:state.timerDisplay,fontScale:state.fontScale,volBar:state.volBar,btAutoReconnect:state.btAutoReconnect,btKeepAlive:state.btKeepAlive,lang:state.lang,browserPw:state.browserPw,iconStyle:state.iconStyle,wifiInd:state.wifiInd,btInd:state.btInd,clockFmt:state.clockFmt,clockSec:state.clockSec,dateFmt:state.dateFmt,catHidden:state.catHidden,storeCheck:state.storeCheck,storeUrl:state.storeUrl,storeToken:state.storeToken,storeMode:state.storeMode,storePubkey:state.storePubkey,veilleMode:state.veilleMode,veilleOff:state.veilleOff,font:state.font})}).catch(()=>{});},250);
}
async function pullConfig(){await loadRegistry();try{const r=await fetch('/api/config');if(r.ok){Object.assign(state,await r.json());sanitize();}}catch(e){}}
/* migrateNew supprimé (0.17.2) : réinstallait ses 10 addons en dur à chaque
   chargement, rendant leur désinstallation impossible. Les défauts vivent
   désormais dans registry/<id>/manifest.json (default_installed). */

const KIOSK_NAME='Panda';
function applyKioskName(){document.title=KIOSK_NAME+' — kiosk';}
const UI_FONTS={
  system:{label:'Système',stack:'system-ui,-apple-system,"Segoe UI",Roboto,sans-serif'},
  inter:{label:'Inter',stack:'"PandaInter",system-ui,sans-serif'},
  atkinson:{label:'Atkinson (lisibilité max)',stack:'"PandaAtkinson",system-ui,sans-serif'},
  lexend:{label:'Lexend',stack:'"PandaLexend",system-ui,sans-serif'},
  rubik:{label:'Rubik',stack:'"PandaRubik",system-ui,sans-serif'}
};
function applyFont(){const f=UI_FONTS[state.font]||UI_FONTS.system;document.documentElement.style.setProperty('--sans',f.stack);}
function applyFontScale(){const s=(state.fontScale||100)/100;
  document.documentElement.style.setProperty('--fs',s);
  // On zoome uniquement les zones de CONTENU (accueil + overlays), pas le
  // châssis (barre du haut à hauteur fixe), pour agrandir le texte sans
  // déformer la mise en page ni faire déborder le kiosk.
  ['home','addonView','cfgView'].forEach(id=>{
    const e=document.getElementById(id);if(e)e.style.zoom=s;
  });
  const k=document.querySelector('.kiosk');if(k)k.style.zoom='';}
/* Atténuation logicielle de la luminosité : voile noir au-dessus de tout
   (l'écran HDMI de Panda n'a aucun rétroéclairage pilotable — vérifié :
   pas de backlight noyau, DDC/CI ignoré par la dalle, gamma vc4 absent). */
function applyBrightness(pct){
  pct=Math.max(5,Math.min(100,parseInt(pct)||100));
  let ov=document.getElementById('dimOv');
  if(!ov){ov=document.createElement('div');ov.id='dimOv';
    ov.style.cssText='position:fixed;inset:0;background:#000;pointer-events:none;z-index:2147483647;opacity:0;transition:opacity .2s';
    document.body.appendChild(ov);}
  ov.style.opacity=Math.min(0.93,(100-pct)/100);
}
function applyState(){document.documentElement.setAttribute('data-theme',state.theme||'dark');applyFont();applyFontScale();applyKioskName();updGearBadge();applyBrightness(state.brightness);renderHome();if(typeof startAgendaNotif==='function')startAgendaNotif();}
function catRank(c){
  const co=state.catOrder||[];
  const i=co.indexOf(c);
  if(i>=0)return i;
  const all=Object.keys(CATS).concat(Object.keys(state.catCustom||{}));
  return co.length+all.indexOf(c);
}
function sortedCats(cats){return cats.slice().sort((a,b)=>catRank(a)-catRank(b));}
function allCats(){
  const o={};
  Object.keys(CATS).forEach(c=>o[c]={i:(state.catIcons&&state.catIcons[c])||CATS[c].i,l:(state.catNames&&state.catNames[c])||CATS[c].l,c:(state.catColors&&state.catColors[c])||CATS[c].c,builtin:true});
  Object.entries(state.catCustom||{}).forEach(([id,v])=>o[id]={i:(v&&v.i)||'📁',l:(v&&v.l)||id,c:(v&&v.c)||'#888780',builtin:false});
  o['_none']={i:'📦',l:'Sans catégorie',c:'#888780',builtin:true,pseudo:true};
  return o;
}
function catOf(id){
  const c=(state.appCat||{})[id];
  if(c==='_none')return '_none';
  if(c&&(CATS[c]||(state.catCustom||{})[c]))return c;
  return BYID[id]?BYID[id].cat:'utils';
}
function homeIds(){const o=state.order.filter(id=>state.installed.includes(id)&&!state.hidden.includes(id));const extra=state.installed.filter(id=>!state.order.includes(id)&&!state.hidden.includes(id)&&BYID[id]);return o.concat(extra);}

/* ---------- HOME ---------- */
const home=document.getElementById('home');
let gridEl=null,railCat=null;
function renderHome(){
  
  const ids=homeIds().filter(id=>!(state.catHidden||[]).includes(catOf(id)));
  if(state.railOn){
    const cats=sortedCats([...new Set(ids.map(id=>catOf(id)))]);
    if(!railCat||!cats.includes(railCat))railCat=cats[0];
    home.innerHTML='<nav class="railv m-'+(state.railMode||'both')+'" id="railv"></nav><div class="homecol"><div class="grid narrow" id="grid"></div></div>';
    const rv=document.getElementById('railv');
    cats.forEach(c=>{const el=document.createElement('div');el.className='cat'+(c===railCat?' on':'');const A=allCats();const ci=A[c]||{i:'📁'};el.innerHTML='<span class="cico">'+ic(ci.i,c===railCat?null:ci.c)+'</span><span class="ctxt">'+(A[c]||{l:c}).l+'</span>';if((state.railMode||'both')==='icons')el.title=(A[c]||{l:c}).l;el.addEventListener('click',()=>{railCat=c;renderHome();});rv.appendChild(el);});
    gridEl=document.getElementById('grid');
    fillGrid(ids.filter(id=>catOf(id)===railCat),false);
  }else{
    home.innerHTML='<div class="homecol"><div class="grid" id="grid"></div></div>';
    gridEl=document.getElementById('grid');
    fillGrid(ids,true);
  }
}
function fillGrid(ids,withAdd){
  gridEl.innerHTML='';
  ids.forEach(id=>{
    const a=BYID[id];
    const el=document.createElement('div');
    el.className='tile';el.dataset.id=id;el.style.setProperty('--cc',a.cc);el.tabIndex=0;
    el.innerHTML='<div class="ic">'+tileIcon(a)+'</div><div class="nm">'+dnm(a)+'</div><div class="src'+(a.fleet?' fleet':'')+'">'+a.src+'</div>';
    el.addEventListener('click',()=>openAddon(id));
    el.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openAddon(id);}});
    gridEl.appendChild(el);
  });
  if(withAdd&&!ids.length){const add=document.createElement('div');add.className='tile add';add.innerHTML='<div class="plus">＋</div><div class="lbl">Ajouter</div>';add.addEventListener('click',()=>openSettings('apps'));gridEl.appendChild(add);}
}
// Réorganisation de l'accueil désactivée : ordre fixe, aucune tuile déplaçable.

/* ---------- ADDON VIEW ---------- */
/* Chargeur de modules ui.js (addons de type « code »).
   Contrat SDK 1.2 : le module exporte mount(el, ctx) et, en option, unmount(). */
const ADDON_MOD={};let curAddonMod=null;
function addonCtx(a){
  const id=a.addon||a.id;
  return {
    id, tile:a, toast,
    api:{
      get:async p=>{const r=await fetch(p);if(!r.ok)throw new Error('HTTP '+r.status);return r.json();},
      post:async(p,b)=>{const r=await fetch(p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b||{})});if(!r.ok)throw new Error('HTTP '+r.status);return r.json();}
    },
    config:async()=>{try{const r=await fetch('/api/modules/'+id);return r.ok?await r.json():{};}catch(e){return{};}}
  };
}
/* Moteur de rendu déclaratif : header / badges / rows / cards / kv.
   Gabarits ${item.x}, ${count.x} et ${data.x} (scalaire extrait) ; filtres
   |rel (date passée relative), |until (échéance future), |head, |tail. */
function _dTpl(t,item,data){
  return String(t||'').replace(/\$\{(count|item|data)\.([a-zA-Z0-9_.]+)(\|rel|\|head|\|until|\|tail)?\}/g,(mm,kind,path,filt)=>{
    let v;
    if(kind==='count'){const arr=data[path];v=Array.isArray(arr)?arr.length:(arr==null?0:1);}
    else if(kind==='data'){v=path.split('.').reduce((c,p)=>c==null?c:c[p],data);}
    else{v=path.split('.').reduce((c,p)=>c==null?c:c[p],item);}
    if(v==null)return '';
    if(filt==='|rel'){const d=(Date.now()-new Date(v))/86400000;
      return d<1?"aujourd'hui":(d<2?'hier':Math.floor(d)+' j');}
    if(filt==='|until'){const d=Math.ceil((new Date(v)-Date.now())/86400000);
      return d<0?'en retard':(d===0?"aujourd'hui":'dans '+d+' j');}
    if(filt==='|head')return String(v).split('/')[0]||'—';
    if(filt==='|tail'){const s=String(v).split('/');return s[s.length-1]||'—';}
    return String(v);
  });
}
async function loadDeclView(a){
  const el=document.getElementById('adBody');if(!el)return;
  const id=a.addon||a.id;
  let d=null;
  try{const r=await fetch('/api/decl/'+id);d=await r.json();}
  catch(e){d={ok:false,reason:'serveur injoignable'};}
  let h='<div class="grafhead">'+
    (d&&d.open_url?'<button class="lgbtn" id="dcOpen" style="margin:0;padding:9px 18px;font-size:14px">Ouvrir \u2197</button>':'')+
    '<button class="wch" id="dcRefresh">\u21bb Rafraîchir</button></div>';
  if(!d||!d.ok){
    h+='<div class="stub"><div class="big">'+tileIcon(a)+'</div><div class="t1">'+dnm(a)+'</div><div class="t2">'+((d&&d.reason)||'')+'</div></div>';
  }else{
    const data=d.data||{};
    for(const v of (d.view||[])){
      let items=v.from?(Array.isArray(data[v.from])?data[v.from]:[]):[];
      if(v.where){const W=v.where;items=items.filter(it=>{
        const val=String((W.field||'').split('.').reduce((c,p)=>c==null?c:c[p],it)??'');
        if(W.eq!=null)return val===String(W.eq);
        if(W.ne!=null)return val!==String(W.ne);
        return true;});}
      const lim=v.limit?items.slice(0,v.limit):items;
      if(v.type==='header')h+='<div class="wsec" style="padding-left:0">'+_dTpl(v.text,null,data)+'</div>';
      else if(v.type==='badges')
        h+='<div class="gybadges">'+(lim.length?lim.map(it=>'<span class="gybadge">'+_dTpl((v.map||{}).text,it,data)+'</span>').join(''):(v.empty||''))+'</div>';
      else if(v.type==='rows'){
        if(v.title)h+='<div class="wsec" style="padding-left:0">'+_dTpl(v.title,null,data)+'</div>';
        h+=lim.length?lim.map(it=>{const M=v.map||{};
          return '<div class="wkrow">'+(M.badge?'<span class="wkbr">'+_dTpl(M.badge,it,data)+'</span>':'')+
            '<span><span class="wkt">'+_dTpl(M.title,it,data)+'</span>'+(M.sub?'<br><span class="wkp">'+_dTpl(M.sub,it,data)+'</span>':'')+'</span>'+
            (M.right?'<span class="wkd">'+_dTpl(M.right,it,data)+'</span>':'')+'</div>';}).join('')
          :'<div class="stub"><div class="t2">'+(v.empty||'Rien à afficher')+'</div></div>';
      }
      else if(v.type==='kv')
        h+='<div class="gybadges">'+Object.entries(data[v.from]||{}).map(([k,val])=>'<span class="gybadge">'+k+' · '+val+'</span>').join('')+'</div>';
      else if(v.type==='cards')
        h+='<div class="argrid">'+lim.map(it=>'<div class="arcard"><span style="min-width:0"><span class="arn">'+_dTpl((v.map||{}).title,it,data)+'</span>'+((v.map||{}).sub?'<br><span class="ari">'+_dTpl(v.map.sub,it,data)+'</span>':'')+'</span></div>').join('')+'</div>';
    }
    h+='<div class="wsrc">'+dnm(a)+' · rendu déclaratif</div>';
  }
  el.innerHTML=h;
  const ob=document.getElementById('dcOpen');
  if(ob)ob.addEventListener('click',()=>openService(d.open_url,dnm(a)));
  const rb=document.getElementById('dcRefresh');
  if(rb)rb.addEventListener('click',()=>loadDeclView(a));
}
async function loadAddonView(a){
  const el=document.getElementById('adBody');if(!el)return;
  const id=a.addon||a.id;
  try{
    const m=ADDON_MOD[id]||(ADDON_MOD[id]=await import('/addons/'+id+'/'+a.ui));
    curAddonMod=m;
    await m.mount(el,addonCtx(a));
  }catch(e){
    el.innerHTML='<div class="stub"><div class="big">🧩</div><div class="t1">Addon indisponible</div><div class="t2">'+String(e&&e.message||e)+'</div></div>';
  }
}

const addonView=document.getElementById('addonView');
document.getElementById('backBtn').addEventListener('click',()=>{if(curAddonMod&&curAddonMod.unmount){try{curAddonMod.unmount();}catch(e){}}curAddonMod=null;addonView.classList.remove('show');});
function openAddon(id){
  const a=BYID[id];if(!a)return;
  // Le navigateur ouvre DIRECTEMENT une 2e instance Chromium (avec sa propre
  // barre d'URL) : pas de page intermédiaire. Fermer Chromium ramène à l'accueil.
  if(a.id==='navigateur'){openBrowserDirect(a);return;}
  document.getElementById('ovTitle').innerHTML=tileIcon(a)+' '+dnm(a);
  document.getElementById('ovSrc').textContent=(a.id==='meteo')?'':a.src;
  document.getElementById('ovBody').innerHTML=viewFor(a);
  if(a.ui){loadAddonView(a);}
  if(a.ui){loadAddonUI(a);}
  if(a.decl){loadDeclView(a);}
  if(a.id==='grafana')loadGrafanaView(a);
  if(a.id==='proxmox')loadProxmoxView(a);
  if(a.id==='wifi')loadWifiView(a);
  if(a.id==='bluetooth')loadBtView(a);
  if(a.id==='maj')loadUpdatesView(a);
  if(a.id==='instagram'&&!a.ui)loadInstaView(a);   // doublon hérité : seulement si l'addon n'est pas résolu en type:code
  if(a.id==='minuteur')loadTimerView(a);
  if((a.type==='iframe'||a.type==='browser')&&a.id!=='kuma'&&a.id!=='grafana'&&a.id!=='proxmox'&&a.id!=='pihole'&&a.id!=='backups'&&a.id!=='wyl'&&a.id!=='forgejo'&&a.id!=='wikijs'&&a.id!=='arcane'&&a.id!=='navigateur')loadLaunchView(a);
  addonView.classList.add('show');
}
/* Moteurs de recherche disponibles pour le navigateur */
const SEARCH_ENGINES={
  google:{name:'Google',url:'https://www.google.com/search?q='},
  ddg:{name:'DuckDuckGo',url:'https://duckduckgo.com/?q='},
  qwant:{name:'Qwant',url:'https://www.qwant.com/?q='},
  bing:{name:'Bing',url:'https://www.bing.com/search?q='},
  brave:{name:'Brave',url:'https://search.brave.com/search?q='}
};
let _brDummy=0;
async function openBrowserDirect(a){
  let cfg={};try{const r=await fetch('/api/modules/'+a.id);if(r.ok)cfg=await r.json();}catch(e){}
  const eng=SEARCH_ENGINES[cfg.engine]||SEARCH_ENGINES.google;
  const engHome=eng.url.replace(/[?&]q=$/,'').replace(/\/$/,'')||eng.url;
  const url=((cfg.url||'').trim())||engHome;
  try{const r=await fetch('/api/system/browser/open',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url})});
    const j=await r.json();
    if(!j.ok&&typeof toast==='function')toast('Impossible d\'ouvrir le navigateur : '+(j.reason||'erreur'));
  }catch(e){if(typeof toast==='function')toast('Serveur injoignable');}
}
async function loadLaunchView(a){
  const el=document.getElementById('launchBody');if(!el)return;
  let cfg={};try{const r=await fetch('/api/modules/'+a.id);if(r.ok)cfg=await r.json();}catch(e){}
  const sch=(CFG_SCHEMA[a.id]||[]).find(f=>f.key==='url');
  const url=((cfg.url||'').trim())||(sch&&sch.placeholder)||'';
  let h='<div class="lgicon">'+tileIcon(a)+'</div><div class="lgname">'+dnm(a)+'</div>';
  h+='<div class="lgsrc">🖥️ sur <b>'+(a.src.charAt(0).toUpperCase()+a.src.slice(1))+'</b></div>';
  h+='<div class="lgurl">'+(url||'URL non configurée')+'</div>';
  h+='<button class="lgbtn" id="lgOpen"'+(url?'':' disabled')+'>Ouvrir en plein écran \u2197</button>';
  h+='<div class="lghint">'+(url?'Le service s\'ouvre en plein écran dans une fenêtre dédiée. Fermez-la pour revenir au kiosk.':'Renseigne l\'URL du service dans \u2699 (Paramètres → Applications → '+dnm(a)+').')+'</div>';
  el.innerHTML=h;
  const b=document.getElementById('lgOpen');
  if(b&&url)b.addEventListener('click',()=>openService(url,dnm(a)));
}
/* Ouverture d'un service : en mode kiosk (plein écran) on l'affiche dans un
   iframe intégré avec bouton retour — impossible autrement de revenir, le
   Chromium kiosk n'a ni barre ni gestes. Hors kiosk, fenêtre classique. */
function openService(url,name){
  // Ouvre le service dans une 2e instance Chromium (vraie fenêtre par-dessus
  // Panda) : plus d'iframe (qui bloquait beaucoup de sites). Un bouton
  // « ✕ Fermer » injecté dans cette fenêtre ramène à Panda.
  fetch('/api/system/browser/open',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({url})}).then(r=>r.json()).then(j=>{
      if(!j.ok&&typeof toast==='function')toast('Impossible d\'ouvrir : '+(j.reason||'erreur'));
    }).catch(()=>{if(typeof toast==='function')toast('Serveur injoignable');});
}
async function loadGrafanaView(a){
  const el=document.getElementById('grafBody');if(!el)return;
  let cfg={};try{const r=await fetch('/api/modules/grafana');if(r.ok)cfg=await r.json();}catch(e){}
  const url=((cfg.url||'').trim())||'http://forgejo.example.com:3000';
  const panels=(cfg.panels||'').trim();
  let h='<div class="grafhead"><button class="lgbtn" id="grafOpen" style="margin:0;padding:9px 18px;font-size:14px">Ouvrir Grafana \u2197</button><button class="wch" id="grafRefresh">\u21bb Rafraîchir</button></div>';
  if(!((cfg.apikey||cfg.has_apikey)&&cfg.dashboard&&panels)){
    h+='<div class="stub"><div class="big">📊</div><div class="t1">Grafana — rendu natif (PNG)</div><div class="t2">Configure dans \u2699 : URL, clé API, <b>UID du dashboard</b> et <b>IDs de panels</b> (ex. <code>2,4,6</code>). Le plugin <b>grafana-image-renderer</b> doit être installé sur Grafana.</div></div>';
  }else{
    const ids=panels.split(',').map(x=>x.trim()).filter(Boolean),cb=Date.now();
    h+='<div class="grafgrid">'+ids.map(id=>'<div class="grafpanel"><img src="/addons/grafana/api/panel?panel='+encodeURIComponent(id)+'&t='+cb+'" alt="Panel '+id+'" onerror="this.parentNode.innerHTML=&quot;<div class=graferr>Panel '+id+' indisponible — vérifie le plugin image-renderer, la clé API et l\u2019UID.</div>&quot;"></div>').join('')+'</div>';
  }
  el.innerHTML=h;
  const ob=document.getElementById('grafOpen');if(ob)ob.addEventListener('click',()=>openService(url,dnm(a)));
  const rb=document.getElementById('grafRefresh');if(rb)rb.addEventListener('click',()=>loadGrafanaView(a));
}
async function loadProxmoxView(a){
  const el=document.getElementById('pveBody');if(!el)return;
  let cfg={};try{const r=await fetch('/api/modules/proxmox');if(r.ok)cfg=await r.json();}catch(e){}
  const url=((cfg.url||'').trim())||'https://proxmox.example.com:8006';
  let d=null;try{const r=await fetch('/addons/proxmox/api/proxmox');d=await r.json();}catch(e){d={ok:false,reason:'serveur injoignable'};}
  let h='<div class="grafhead"><button class="lgbtn" id="pveOpen" style="margin:0;padding:9px 18px;font-size:14px">Ouvrir Proxmox \u2197</button><button class="wch" id="pveRefresh">\u21bb Rafraîchir</button></div>';
  if(!d||!d.ok){
    h+='<div class="stub"><div class="big">🖥️</div><div class="t1">Proxmox — état natif</div><div class="t2">'+((d&&d.reason)||'')+'<br>Configure dans \u2699 : URL + <b>token API</b> au format <code>user@realm!id=uuid</code>.</div></div>';
  }else{
    const fmt=b=>b>=1073741824?(b/1073741824).toFixed(1)+' Go':Math.round(b/1048576)+' Mo';
    const upf=x=>{if(!x)return '';const j=Math.floor(x/86400),hh=Math.floor(x%86400/3600);return j>0?j+' j '+hh+' h':hh+' h';};
    d.nodes.forEach(n=>{
      const mp=n.maxmem?Math.round(n.mem/n.maxmem*100):0;
      const cc=n.cpu>=90?'bad':(n.cpu>=70?'warn':''),mc=mp>=90?'bad':(mp>=75?'warn':'');
      h+='<div class="pvenode"><div><div class="pvename">🖥️ '+n.name+'</div><div class="pveup">'+(n.status==='online'?'en ligne':'hors ligne')+' · up '+upf(n.uptime)+' · '+n.maxcpu+' cœurs</div></div>'+
         '<div class="pvebars">'+
           '<div class="pvebar"><div class="lbl"><span>CPU</span><span>'+n.cpu+' %</span></div><div class="trk"><div class="fil '+cc+'" style="width:'+Math.min(100,n.cpu)+'%"></div></div></div>'+
           '<div class="pvebar"><div class="lbl"><span>RAM</span><span>'+mp+' % · '+fmt(n.mem)+'</span></div><div class="trk"><div class="fil '+mc+'" style="width:'+mp+'%"></div></div></div>'+
         '</div></div>';});
    const run=d.guests.filter(g=>g.status==='running').length;
    h+='<div class="wsec" style="padding-left:0">VM & conteneurs <span style="text-transform:none;letter-spacing:0;color:var(--dim);font-weight:400">· '+run+'/'+d.guests.length+' en marche</span></div>';
    h+='<div class="pvegrid">'+d.guests.map(g=>{
      const on=g.status==='running';
      const mp=(on&&g.maxmem)?Math.round(g.mem/g.maxmem*100):0;
      return '<div class="pverow'+(on?'':' off')+'"><span class="pvedot" style="background:'+(on?'var(--green)':'var(--faint)')+'"></span>'+
        '<span class="pveid">'+g.vmid+'</span><span class="pvetype">'+g.type+'</span><span class="pvegn">'+(g.name||'')+'</span>'+
        '<span class="pvest">'+(on?('<span>CPU '+g.cpu+'%</span><span>RAM '+mp+'%</span>'):'<span>arrêté</span>')+'</span></div>';}).join('')+'</div>';
  }
  el.innerHTML=h;
  const ob=document.getElementById('pveOpen');if(ob)ob.addEventListener('click',()=>openService(url,dnm(a)));
  const rb=document.getElementById('pveRefresh');if(rb)rb.addEventListener('click',()=>loadProxmoxView(a));
}
/* ---------- MINUTEUR ---------- */
let tmTimer=null,tmEnd=0,tmName='',tmDone=false,tmBeep=null,tmSound='',tmPaused=false,tmRemain=0;
function tmFmt(sec){const m=Math.floor(Math.abs(sec)/60),s2=Math.abs(sec)%60;
  return (sec<0?'-':'')+String(m).padStart(2,'0')+':'+String(s2).padStart(2,'0');}
let tmSoundEl=null,tmPreview=null,tmPreviewName='',tmColor='',tmBg='';
function tmSoundUrl(n){return '/api/timer/sound/'+encodeURIComponent(n);}
function tmPreviewPlay(name,onEnd){
  tmPreviewStop();
  if(!name){tmBeepSynth();if(onEnd)setTimeout(onEnd,700);return;}
  tmPreviewName=name;
  tmPreview=new Audio(tmSoundUrl(name));
  const fin=()=>{tmPreview=null;tmPreviewName='';if(onEnd)onEnd();};
  tmPreview.addEventListener('ended',fin);
  tmPreview.play().catch(fin);
}
function tmPreviewStop(){
  if(tmPreview){tmPreview.pause();tmPreview.currentTime=0;}
  tmPreview=null;tmPreviewName='';
}
function tmPreviewToggle(name,onChange){
  if(tmPreviewName===name){tmPreviewStop();if(onChange)onChange(false);return;}
  tmPreviewPlay(name,()=>{if(onChange)onChange(false);});
  if(onChange)onChange(true);
}
function tmBeepPlay(){
  const snd=tmSound||'';
  if(snd){
    try{
      if(!tmSoundEl||tmSoundEl.dataset.n!==snd){tmSoundEl=new Audio(tmSoundUrl(snd));tmSoundEl.dataset.n=snd;}
      tmSoundEl.currentTime=0;tmSoundEl.play().catch(()=>tmBeepSynth());
      return;
    }catch(e){}
  }
  tmBeepSynth();
}
function tmBeepSynth(){
  try{
    const ctx=new (window.AudioContext||window.webkitAudioContext)();
    const o=ctx.createOscillator(),g=ctx.createGain();
    o.connect(g);g.connect(ctx.destination);o.frequency.value=880;o.type='sine';
    g.gain.setValueAtTime(.001,ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(.3,ctx.currentTime+.02);
    g.gain.exponentialRampToValueAtTime(.001,ctx.currentTime+.6);
    o.start();o.stop(ctx.currentTime+.65);
  }catch(e){}
}
function tmUpdateBar(){
  const bar=document.getElementById('tmBar');if(!bar)return;
  if(!tmTimer){bar.style.display='none';return;}
  const left=tmLeft();
  bar.style.display='inline-flex';
  bar.className=tmDone?'ring':'';
  if(tmColor&&!tmDone){bar.style.color=tmColor;bar.style.borderColor=tmColor;}
  else{bar.style.color='';bar.style.borderColor='';}
  bar.style.background=(tmBg&&!tmDone)?tmBg:'';
  bar.innerHTML=(tmDone?'⏰ ':(tmPaused?'⏸ ':'⏱️ '))+tmFmt(left)+'<span class="tmn">'+(tmName||'')+'</span>';
  bar.onclick=()=>openAddon('minuteur');
}
function tmStart(name,secs,a,preset){
  tmName=name;tmEnd=Date.now()+secs*1000;tmDone=false;tmPaused=false;tmRemain=0;
  tmSound=(preset&&preset.sound)||'';
  tmColor=(preset&&preset.color)||'';
  tmBg=(preset&&preset.bg)||'';
  if(tmTimer)clearInterval(tmTimer);
  tmTimer=setInterval(()=>{
    if(tmPaused){tmUpdateBar();return;}
    const left=Math.round((tmEnd-Date.now())/1000);
    if(left<=0&&!tmDone){tmDone=true;tmBeepPlay();tmBeep=setInterval(tmBeepPlay,2000);}
    tmUpdateBar();
    const el=document.getElementById('tmBody');
    if(el)renderTimer(a);
  },1000);
  tmUpdateBar();renderTimer(a);
}
function tmLeft(){return tmPaused?tmRemain:Math.round((tmEnd-Date.now())/1000);}
function tmSilence(){
  if(tmBeep){clearInterval(tmBeep);tmBeep=null;}
  if(tmSoundEl){tmSoundEl.pause();tmSoundEl.currentTime=0;}
}
function tmToggle(a){
  if(!tmTimer)return;
  if(tmDone){tmStop();if(a)renderTimer(a);return;}   // sonne : le cadre arrête
  if(tmPaused){tmEnd=Date.now()+tmRemain*1000;tmPaused=false;}
  else{tmRemain=Math.max(0,Math.round((tmEnd-Date.now())/1000));tmPaused=true;}
  tmUpdateBar();if(a)renderTimer(a);
}
function tmAdd(min,a){
  if(!tmTimer)return;
  tmSilence();
  tmDone=false;
  const base=tmPaused?tmRemain:Math.max(0,Math.round((tmEnd-Date.now())/1000));
  if(tmPaused)tmRemain=base+min*60;
  else tmEnd=Date.now()+(base+min*60)*1000;
  tmUpdateBar();if(a)renderTimer(a);
  toast('+'+min+' min');
}
function tmStop(){
  if(tmTimer)clearInterval(tmTimer);tmTimer=null;
  tmSilence();
  tmDone=false;tmPaused=false;tmRemain=0;tmName='';
  tmUpdateBar();
}
async function loadTimerView(a){renderTimer(a);}
function renderTimer(a){
  const el=document.getElementById('tmBody');if(!el)return;
  const presets=state.timers||[];
  let h='';
  if(tmTimer){
    const left=tmLeft();
    const stl=(tmBg&&!tmDone)?(' style="background:'+tmBg+';border-color:'+(tmColor||'var(--accent)')+'"'):'';
    h+='<div class="tmrun'+(tmDone?' done':'')+(tmPaused?' paused':'')+'" id="tmFrame"'+stl+'>'+
       '<span class="tmx" id="tmCancel" title="Annuler">✕</span>'+
       '<div class="tmname">'+(tmName||'Minuteur')+'</div>'+
       '<div class="tmbig"'+((tmColor&&!tmDone)?(' style="color:'+tmColor+'"'):'')+'>'+
         (tmDone?'⏰ '+tmFmt(left):(tmPaused?'⏸ '+tmFmt(left):tmFmt(left)))+'</div>'+
       '<div class="tmhint">'+(tmDone?'Touche le cadre pour arrêter la sonnerie'
                                     :(tmPaused?'Touche le cadre pour reprendre':'Touche le cadre pour mettre en pause'))+'</div>'+
       (tmDone?'<div class="tmacts">'+[5,10,15].map(m=>'<span class="tmadd" data-add="'+m+'">+'+m+' min</span>').join('')+'</div>':'')+
       '</div>';
  }
  h+='<div class="koadd"><input id="tmN" placeholder="Nom (ex. Gâteau)" autocomplete="off">'+
     '<input id="tmM" type="number" inputmode="numeric" placeholder="minutes" style="max-width:130px">'+
     '<button id="tmAdd">Enregistrer</button></div><div class="kotoast" id="tmErr"></div>';
  h+='<div class="wsec" style="padding-left:0">Préréglages</div>';
  if(!presets.length)h+='<div class="stub"><div class="t2">Aucun préréglage — ajoute-en un ci-dessus</div></div>';
  else{
    const mode=state.timerDisplay||'text';
    h+='<div class="tmgrid">'+presets.map((p,i)=>{
      const ico=p.i||'⏱️';
      let inner='';
      if(mode==='icons')inner='<div class="tmci">'+ico+'</div>';
      else if(mode==='images')inner=p.img?('<img class="tmcimg" src="/api/timer/image/'+encodeURIComponent(p.img)+'" alt="">'):('<div class="tmci">'+ico+'</div>');
      else if(mode==='both')inner=p.img?('<div class="tmcimg-wrap"><img class="tmcimg" src="/api/timer/image/'+encodeURIComponent(p.img)+'" alt=""><span class="tmcimg-ic">'+(p.i||'')+'</span></div>'):('<div class="tmci">'+ico+'</div>');
      else inner='<div class="tmcn"'+(p.color?(' style="color:'+p.color+'"'):'')+'>'+p.n+'</div>';
      return '<div class="tmcard" data-i="'+i+'" title="'+p.n.replace(/"/g,'&quot;')+'"'+
        (p.bg?(' style="background:'+p.bg+'"'):'')+'>'+inner+
        '<div class="tmct">'+tmFmt(p.s)+'</div>'+
        (mode==='text'&&p.sound?'<div class="tmct" style="font-size:9.5px">🔔 '+p.sound.replace(/\.[^.]+$/,'')+'</div>':'')+
        '</div>';}).join('')+'</div>';
  }
  h+='<div class="wsrc">Minuteur local · la sonnerie utilise la sortie audio du kiosk</div>';
  el.innerHTML=h;
  const fr=document.getElementById('tmFrame');
  if(fr)fr.addEventListener('click',ev=>{
    if(ev.target.dataset.add!=null||ev.target.id==='tmCancel')return;
    tmToggle(a);});
  const cx=document.getElementById('tmCancel');
  if(cx)cx.addEventListener('click',ev=>{ev.stopPropagation();tmStop();renderTimer(a);});
  document.querySelectorAll('[data-add]').forEach(b=>b.addEventListener('click',ev=>{
    ev.stopPropagation();tmAdd(parseInt(b.dataset.add),a);}));
  el.querySelectorAll('.tmcard').forEach(c=>c.addEventListener('click',ev=>{
    if(ev.target.dataset.del!=null)return;
    const p=presets[parseInt(c.dataset.i)];if(p)tmStart(p.n,p.s,a,p);
  }));
  el.querySelectorAll('[data-del]').forEach(d=>d.addEventListener('click',ev=>{
    ev.stopPropagation();
    state.timers.splice(parseInt(d.dataset.del),1);save();renderTimer(a);
  }));
  const add=document.getElementById('tmAdd');
  if(add)add.addEventListener('click',()=>{
    const n=(document.getElementById('tmN').value||'').trim();
    const m=parseFloat(document.getElementById('tmM').value||'0');
    const err=document.getElementById('tmErr');
    if(!n||!(m>0)){err.textContent='Donne un nom et une durée en minutes';return;}
    state.timers=state.timers||[];state.timers.push({n:n,s:Math.round(m*60)});save();vkClose();renderTimer(a);
  });
}
/* ---------- CALCULATRICE ---------- */
/* Calculatrice extraite : premier addon « code » — registry/calculatrice/ui.js */
function bigBars(sig){let h='<span class="ncsig">';for(let i=1;i<=4;i++)h+='<i class="'+(sig>=i*20?'on':'')+'" style="height:'+(10+i*8)+'px"></i>';return h+'</span>';}
function syBars(sig){
  let h='<span class="sysig">';
  for(let i=1;i<=4;i++)h+='<i class="'+(sig>=i*20?'on':'')+'" style="height:'+(i*4)+'px"></i>';
  return h+'</span>';
}
function syStub(el,ic,t,msg,extra){
  el.innerHTML='<div class="stub"><div class="big">'+ic+'</div><div class="t1">'+t+'</div>'+
    '<div class="t2">'+msg+(extra||'')+'</div></div>';
}
/* ---------- WIFI ---------- */
async function loadWifiView(a){
  const el=document.getElementById('wfBody');if(!el)return;
  el.innerHTML='<div class="stub"><div class="t2">Lecture des réseaux…</div></div>';
  let d=null;try{const r=await fetch('/api/system/wifi');d=await r.json();}catch(e){d={ok:false,reason:'serveur injoignable'};}
  if(!d.ok){
    syStub(el,'📶','WiFi',d.reason||'',
      '<br>Cette vue nécessite <code>nmcli</code> (paquet <code>network-manager</code>) sur la machine du kiosk.');
    return;
  }
  let sig=0;if(d.networks){const act=d.networks.find(n=>n.active);if(act)sig=act.signal;}
  const conn=(d.connection&&d.connection!=='--');
  let h='<div class="netcard'+(conn?' on':'')+'">'+
    '<div class="ncbadge">📶</div>'+
    '<div class="nctxt"><div class="ncname">'+(conn?d.connection:'Non connecté')+'</div>'+
      '<div class="ncsub">'+(conn?('Connecté · signal '+sig+' %'):('Module WiFi '+(d.radio?'activé':'désactivé')+' · '+d.device))+'</div></div>'+
    (conn?bigBars(sig):'')+'</div>';
  // Barre d'actions : activer/désactiver le module + se déconnecter
  h+='<div class="grafhead"><button class="wch'+(d.radio?' on':'')+'" id="wfRadio">'+
     (d.radio?'📶 Module activé':'📴 Module désactivé')+'</button>'+
     (d.connection&&d.connection!=='--'?'<button class="wch" id="wfDisc">⏏ Se déconnecter</button>':'')+
     '<button class="wch" id="wfRefresh">↻ Rafraîchir</button></div>';
  h+='<div class="kotoast" id="wfErr"></div>';
  if(d.connection&&d.connection!=='--')
    h+='<div class="setrow"><div class="lft"><div class="t">Reconnexion automatique</div><div class="d">Le kiosk se reconnecte seul à ce réseau au démarrage</div></div><div class="sw'+(d.autoconnect?' on':'')+'" id="wfAuto"></div></div>';
  if(d.radio){
    h+=d.networks.map(n=>'<div class="syrow'+(n.active?' on':'')+'">'+syBars(n.signal)+
      '<span><span class="syn">'+n.ssid+'</span><span class="sysub">'+n.signal+' %'+(n.secure?' · 🔒 sécurisé':' · ouvert')+'</span></span>'+
      '<span class="syact">'+(n.active?'<span class="sybtn warn" id="wfDiscRow">Déconnecter</span>':
        '<span class="sybtn" data-ssid="'+n.ssid+'" data-sec="'+(n.secure?1:0)+'">Se connecter</span>')+'</span></div>').join('');
  }else{
    h+='<div class="stub"><div class="t2">Module WiFi désactivé — active-le pour voir les réseaux.</div></div>';
  }
  h+='<div class="wsrc">NetworkManager · les changements affectent la machine du kiosk</div>';
  el.innerHTML=h;
  const err=document.getElementById('wfErr');
  const rr=document.getElementById('wfRefresh');if(rr)rr.addEventListener('click',()=>loadWifiView(a));
  const wfa=document.getElementById('wfAuto');
  if(wfa)wfa.addEventListener('click',async()=>{
    const on=!wfa.classList.contains('on');wfa.classList.toggle('on',on);err.textContent='';
    try{const r=await fetch('/api/system/wifi/autoconnect',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({on:on})});
      const j=await r.json();
      if(!j.ok){wfa.classList.toggle('on',!on);err.textContent=j.reason||'échec';}
      else toast('Reconnexion auto '+(on?'activée':'désactivée'));
    }catch(e){wfa.classList.toggle('on',!on);err.textContent='Serveur injoignable';}});
  const rad=document.getElementById('wfRadio');
  if(rad)rad.addEventListener('click',async()=>{
    rad.textContent='…';err.textContent='';
    try{const r=await fetch('/api/system/wifi/radio',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({on:!d.radio})});const j=await r.json();
      if(j.ok){setTimeout(()=>{loadWifiView(a);if(typeof updateConnIcons==='function')updateConnIcons();},1200);}
      else{err.textContent=j.reason||'échec';loadWifiView(a);}
    }catch(e){err.textContent='Serveur injoignable';}
  });
  const doDisc=async(btn)=>{
    if(!confirm('Déconnecter le WiFi ? Le kiosk peut perdre le réseau.'))return;
    if(btn)btn.textContent='…';err.textContent='';
    try{const r=await fetch('/api/system/wifi/disconnect',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
      const j=await r.json();if(!j.ok)err.textContent=j.reason||'échec';loadWifiView(a);
      if(typeof updateConnIcons==='function')updateConnIcons();
    }catch(e){err.textContent='Serveur injoignable';}
  };
  const dsc=document.getElementById('wfDisc');if(dsc)dsc.addEventListener('click',()=>doDisc(dsc));
  const dscR=document.getElementById('wfDiscRow');if(dscR)dscR.addEventListener('click',()=>doDisc(dscR));
  el.querySelectorAll('[data-ssid]').forEach(b=>b.addEventListener('click',()=>{
    const ssid=b.dataset.ssid;
    if(b.dataset.sec==='1'){
      wifiPwPrompt(ssid,pw=>doWifiConnect(a,ssid,pw,b));
    }else{
      doWifiConnect(a,ssid,'',b);
    }
  }));
}
/* Connexion effective au réseau */
async function doWifiConnect(a,ssid,pw,b){
  const err=document.getElementById('wfErr');
  if(b)b.textContent='…';if(err)err.textContent='';
  try{
    const r=await fetch('/api/system/wifi/connect',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({ssid,password:pw})});
    const j=await r.json();
    if(j.ok){loadWifiView(a);if(typeof updateConnIcons==='function')updateConnIcons();}
    else{if(err)err.textContent=j.reason||'Connexion impossible';if(b)b.textContent='Se connecter';}
  }catch(e){if(err)err.textContent='Serveur injoignable';if(b)b.textContent='Se connecter';}
}
/* Modale de saisie du mot de passe WiFi : champ HTML → le clavier virtuel
   tactile s'y attache (contrairement à prompt() natif, sans clavier). */
function wifiPwPrompt(ssid,onOk){
  let m=document.getElementById('wifiPwModal');
  if(m)m.remove();
  m=document.createElement('div');m.id='wifiPwModal';m.className='pwmodal';
  m.innerHTML='<div class="pwbox"><div class="pwtitle">Réseau « '+ssid+' »</div>'+
    '<div class="pwsub">Saisis le mot de passe</div>'+
    '<input type="password" id="wifiPwField" class="pwfield" autocomplete="off" placeholder="Mot de passe">'+
    '<label class="pwshow"><input type="checkbox" id="wifiPwShow"> Afficher</label>'+
    '<div class="pwbtns"><button class="btnpill" id="wifiPwCancel">Annuler</button>'+
    '<button class="btnpill install" id="wifiPwOk">Se connecter</button></div></div>';
  document.body.appendChild(m);
  const fld=document.getElementById('wifiPwField');
  setTimeout(()=>{fld.focus();if(typeof vkOpen==='function')vkOpen(fld);},50);
  document.getElementById('wifiPwShow').addEventListener('change',e=>{
    fld.type=e.target.checked?'text':'password';});
  const close=()=>{if(typeof vkClose==='function')vkClose();m.remove();};
  document.getElementById('wifiPwCancel').addEventListener('click',close);
  document.getElementById('wifiPwOk').addEventListener('click',()=>{
    const pw=fld.value||'';if(!pw)return;close();onOk(pw);});
  fld.addEventListener('keydown',e=>{if(e.key==='Enter'){const pw=fld.value||'';if(pw){close();onOk(pw);}}});
}
/* ---------- BLUETOOTH ---------- */
async function loadBtView(a){
  const el=document.getElementById('btBody');if(!el)return;
  el.innerHTML='<div class="stub"><div class="t2">Lecture des appareils…</div></div>';
  let d=null;try{const r=await fetch('/api/system/bluetooth');d=await r.json();}catch(e){d={ok:false,reason:'serveur injoignable'};}
  if(!d.ok){
    syStub(el,'🔵','Bluetooth',d.reason||'',
      '<br>Cette vue nécessite <code>bluetoothctl</code> (paquet <code>bluez</code>) sur la machine du kiosk.');
    return;
  }
  const btc=d.devices&&d.devices.find(x=>x.connected);
  let h='<div class="netcard'+(btc?' on':'')+'">'+
    '<div class="ncbadge">'+(btc?'🔵':'⚫')+'</div>'+
    '<div class="nctxt"><div class="ncname">'+(btc?btc.name:'Aucun appareil connecté')+'</div>'+
      '<div class="ncsub">'+(btc?'Connecté · reçoit le son du kiosk':('Module Bluetooth '+(d.powered?'activé':'désactivé')))+'</div></div>'+
    '</div>';
  h+='<div class="grafhead"><button class="wch'+(d.powered?' on':'')+'" id="btPower">'+
        (d.powered?'🔵 Module activé':'⚫ Module désactivé')+'</button>'+
        '<button class="wch" id="btScan"'+(d.powered?'':' disabled')+'>🔍 Rechercher (8 s)</button>'+
        '<button class="wch" id="btRefresh">↻ Rafraîchir</button></div><div class="kotoast" id="btErr"></div>';
  if(d.powered){
    h+='<div class="setrow"><div class="lft"><div class="t">Reconnexion automatique</div><div class="d">Reconnecte l\'enceinte appairée au démarrage du kiosk</div></div><div class="sw'+(state.btAutoReconnect!==false?' on':'')+'" id="btReconSw"></div></div>';
    h+='<div class="setrow"><div class="lft"><div class="t">Maintenir l\'enceinte active</div><div class="d">Émet un son inaudible en continu pour éviter la mise en veille (consomme plus)</div></div><div class="sw'+(state.btKeepAlive===true?' on':'')+'" id="btKeepSw"></div></div>';
  }
  if(!d.powered)h+='<div class="stub"><div class="t2">Module Bluetooth désactivé — active-le pour rechercher et connecter des appareils.</div></div>';
  else if(!d.devices.length)h+='<div class="stub"><div class="t2">Aucun appareil appairé — lance une recherche, enceinte en mode appairage</div></div>';
  else h+=d.devices.map(x=>'<div class="syrow'+(x.connected?' on':'')+'">'+
    '<span style="font-size:19px">'+(x.connected?'🔵':'⚪')+'</span>'+
    '<span><span class="syn">'+x.name+'</span><span class="sysub">'+x.mac+
      (x.paired?'':' · non appairé')+'</span></span>'+
    '<span class="syact">'+
      (x.connected?'<span class="sybtn warn" data-bt="disconnect" data-mac="'+x.mac+'">Déconnecter</span>':
       (x.paired?'<span class="sybtn" data-bt="connect" data-mac="'+x.mac+'">Connecter</span>':
                 '<span class="sybtn" data-bt="pair" data-mac="'+x.mac+'">Appairer</span>'))+
      '<span class="sybtn bad" data-bt="remove" data-mac="'+x.mac+'">Oublier</span>'+
    '</span></div>').join('');
  h+='<div class="wsrc">BlueZ · le son du kiosk (radio, minuteur) sortira sur l\'appareil connecté</div>';
  el.innerHTML=h;
  const err=document.getElementById('btErr');
  const act=async(action,mac,btn)=>{
    if(action==='remove'&&!confirm('Oublier cet appareil ?'))return;
    if(btn)btn.textContent='…';err.textContent='';
    try{
      const r=await fetch('/api/system/bluetooth/action',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({action,mac})});
      const j=await r.json();
      if(!j.ok)err.textContent=j.reason||'action refusée';
      loadBtView(a);
    }catch(e){err.textContent='Serveur injoignable';}
  };
  const btp=document.getElementById('btPower');
  if(btp)btp.addEventListener('click',async()=>{
    btp.textContent='…';err.textContent='';
    try{const r=await fetch('/api/system/bluetooth/action',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({action:d.powered?'power-off':'power-on'})});const j=await r.json();
      if(!j.ok)err.textContent=j.reason||'échec';setTimeout(()=>loadBtView(a),1000);
    }catch(e){err.textContent='Serveur injoignable';}
  });
  const bs=document.getElementById('btScan');
  if(bs&&!bs.disabled)bs.addEventListener('click',async(e)=>{
    e.target.textContent='🔍 Recherche…';await act('scan','AA:AA:AA:AA:AA:AA');});
  document.getElementById('btRefresh').addEventListener('click',()=>loadBtView(a));
  const rsw=document.getElementById('btReconSw');
  if(rsw)rsw.addEventListener('click',async()=>{
    state.btAutoReconnect=(state.btAutoReconnect===false);rsw.classList.toggle('on',state.btAutoReconnect!==false);save();
    try{await fetch('/api/system/bluetooth/autoreconnect',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({on:state.btAutoReconnect!==false})});}catch(e){}
    toast(state.btAutoReconnect!==false?'Reconnexion auto activée':'Reconnexion auto désactivée');});
  const ksw=document.getElementById('btKeepSw');
  if(ksw)ksw.addEventListener('click',async()=>{
    state.btKeepAlive=(state.btKeepAlive!==true);ksw.classList.toggle('on',state.btKeepAlive===true);save();
    try{await fetch('/api/system/audio/keepalive',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({on:state.btKeepAlive})});}catch(e){}
    toast(state.btKeepAlive?'Maintien actif — l\'enceinte restera connectée':'Maintien désactivé');});
  el.querySelectorAll('[data-bt]').forEach(b=>b.addEventListener('click',()=>act(b.dataset.bt,b.dataset.mac,b)));
}
/* ---------- MISES À JOUR ---------- */
async function loadUpdatesView(a){
  const el=document.getElementById('mjBody');if(!el)return;
  el.innerHTML='<div class="stub"><div class="t2">Recherche des mises à jour…</div></div>';
  let d=null;try{const r=await fetch('/api/system/updates');d=await r.json();}catch(e){d={ok:false,reason:'serveur injoignable'};}
  if(!d.ok){
    syStub(el,'⬆️','Mises à jour',d.reason||'','<br>Vérifie la règle sudoers <code>/etc/sudoers.d/kiosk</code>.');
    return;
  }
  let h='<div class="gybadges">'+
    (d.count?'<span class="gybadge warn">⬆️ '+d.count+' mise(s) à jour</span>':'<span class="gybadge">✅ système à jour</span>')+
    (d.security?'<span class="gybadge bad">🔴 '+d.security+' de sécurité</span>':'')+'</div>';
  h+='<div class="kotoast" id="mjErr"></div>';
  if(d.count){
    h+='<div style="margin-bottom:10px"><button class="btnpill install" id="mjApply">Tout mettre à jour</button></div>';
    h+=d.packages.map(p=>'<div class="sypkg'+(p.security?' sec':'')+'">'+
      '<span class="sypn">'+(p.security?'🔴 ':'')+p.name+'</span>'+
      '<span class="sypv">'+p.old+'</span><span class="sypv">→ '+p.new+'</span></div>').join('');
  }else h+='<div class="stub"><div class="big">✅</div><div class="t2">Aucun paquet à mettre à jour</div></div>';
  h+='<div id="mjOut"></div><div class="wsrc">apt · la mise à jour peut prendre plusieurs minutes</div>';
  el.innerHTML=h;
  const err=document.getElementById('mjErr');
  const ab=document.getElementById('mjApply');
  if(ab)ab.addEventListener('click',async()=>{
    if(!confirm('Installer '+d.count+' mise(s) à jour ? Le kiosk peut redémarrer des services.'))return;
    ab.disabled=true;ab.textContent='Mise à jour en cours…';err.textContent='';
    try{
      const r=await fetch('/api/system/updates/apply',{method:'POST'});
      const j=await r.json();
      if(j.ok){document.getElementById('mjOut').innerHTML='<div class="syout">'+(j.output||'').replace(/</g,'&lt;')+'</div>';
        setTimeout(()=>loadUpdatesView(a),2000);}
      else{err.textContent=j.reason||'échec';ab.disabled=false;ab.textContent='Tout mettre à jour';}
    }catch(e){err.textContent='Serveur injoignable (la mise à jour continue peut-être)';ab.disabled=false;}
  });
}
let igData=null,igPost=0,igSlide=0,igProfile=null,igAdmin=false,igFilter='all';
let igTrash=null,igTrashSel=new Set();
/* --- Phase 3 : addons à interface embarquée (manifest ui.entry) --------
   Contrat : ui.js définit  PandaAddons.<id> = { render(el, sdk, tile),
   unmount()? }.  Le loader injecte le script UNE fois par session avec
   ?v=<version du manifest> — toute mise à jour de l'addon change l'URL et
   invalide donc le cache Chromium sans reboot. */
window.PandaAddons=window.PandaAddons||{};
function _auiSdk(aid){
  return {
    id:aid,
    api:(p,opt)=>fetch('/addons/'+encodeURIComponent(aid)+'/api'+(String(p||'').charAt(0)==='/'?p:'/'+p),opt),
    toast:m=>toast(m),
    openService:(u,n)=>openService(u,n||aid),
    ic:(e,c)=>ic(e,c),
    esc:s=>String(s==null?'':s).replace(/[&<>"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m])),
    rel:v=>{if(!v)return '\u2014';const d=(Date.now()-new Date(v))/86400000;
      if(!isFinite(d))return '\u2014';if(d<0)return "aujourd'hui";
      if(d<1){const hh=Math.floor(d*24);return hh<1?"\u00e0 l'instant":hh+' h';}
      return d<2?'hier':Math.floor(d)+' j';},
    session:async()=>{try{const r=await fetch('/api/session');return await r.json();}catch(e){return{};}},
    delMode:()=>!!(typeof state!=='undefined'&&state.delMode),
    config:async()=>{try{const r=await fetch('/api/modules/'+encodeURIComponent(aid));return r.ok?await r.json():{};}catch(e){return{};}},
    store:{
      load:async()=>{try{const r=await fetch('/api/addons/'+encodeURIComponent(aid)+'/state');return r.ok?await r.json():{};}catch(e){return{};}},
      save:async(obj)=>{try{const r=await fetch('/api/addons/'+encodeURIComponent(aid)+'/state',{method:'POST',
        headers:{'Content-Type':'application/json'},body:JSON.stringify(obj||{})});return r.ok;}catch(e){return false;}}
    },
    vk:{close:()=>{try{vkClose();}catch(e){}}},
    open:()=>openAddon(aid),
    notify:(n)=>{const bar=document.getElementById('agBar');if(!bar)return;
      if(!n){bar.style.display='none';bar.onclick=null;return;}
      bar.className=n.urgent?'soon':'';bar.style.display='inline-flex';
      bar.title=n.title||'';
      bar.innerHTML='🔔 <span class="agbt"></span>';
      bar.querySelector('.agbt').textContent=n.text||'';
      bar.onclick=n.onclick||null;}
  };
}
/* Hooks de fond (contrat Phase 3) : au déverrouillage et à chaque applyState,
   les addons installés déclarant ui.background voient leur background(sdk)
   appelé. Le hook doit être idempotent (il gère lui-même ses timers). */
function _auiBackground(){
  (ADDONS||[]).forEach(t=>{
    if(!t.ui||!t.bg)return;
    if(!(state.installed||[]).includes(t.addon||t.id))return;
    _auiLoad(t.addon||t.id,t.ui,t.ver).then(m=>{
      if(m&&m.background)try{m.background(_auiSdk(t.addon||t.id));}catch(e){console.debug('[aui] background',t.id,e);}
    });
  });
}
/* Charge le ui.js d'un addon (une fois par session) et resout son module.
   Reutilise par la vue (loadAddonUI) et par le \u2699 (hook configPanel). */
const _auiPending={};
const _auiVer={};
function _auiLoad(aid,entry,ver){
  const mod=()=>(window.PandaAddons||{})[aid];
  // Reutilise le module en memoire UNIQUEMENT si la version chargee correspond.
  // Sinon (mise a jour de l'addon), on evacue l'ancien module et on recharge le ui.js.
  if(mod()&&_auiVer[aid]===(ver||'0'))return Promise.resolve(mod());
  if(mod()&&_auiVer[aid]!==(ver||'0')){try{delete window.PandaAddons[aid];}catch(e){}}
  if(_auiPending[aid])return _auiPending[aid];
  _auiPending[aid]=new Promise(res=>{
    const s=document.createElement('script');
    s.src='/addons/'+encodeURIComponent(aid)+'/ui/'+encodeURIComponent(entry)+'?v='+encodeURIComponent(ver||'0');
    s.onload=()=>{delete _auiPending[aid];_auiVer[aid]=(ver||'0');res(mod()||null);};
    s.onerror=()=>{delete _auiPending[aid];res(null);};
    document.head.appendChild(s);
  });
  return _auiPending[aid];
}
async function loadAddonUI(a){
  const el=document.getElementById('auiBody');if(!el)return;
  const aid=a.addon||a.id;
  const m=await _auiLoad(aid,a.ui,a.ver);
  if(!document.getElementById('auiBody'))return;
  if(!m||!m.render){el.innerHTML='<div class="stub"><div class="big">\ud83e\udde9</div><div class="t2">Interface de l\'addon introuvable ou contrat non respect\u00e9 (<code>'+a.ui+'</code>).</div></div>';return;}
  try{if(m.unmount)try{m.unmount();}catch(e){}
    m.render(el,_auiSdk(aid),a);}
  catch(e){el.innerHTML='<div class="stub"><div class="big">\ud83e\udde9</div><div class="t2">Vue de l\'addon en erreur :<br><code>'+
    String(e).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))+'</code></div></div>';}
}
/* --- Forgejo : cartes/liste, recherche, historique des commits (v0.99.47) --- */
function igUrl(p,f){return '/addons/instagram/api/media/'+encodeURIComponent(p)+'/'+encodeURIComponent(f);}
function igMedia(post){return post.videos.concat(post.images);}
async function loadInstaView(a){
  const el=document.getElementById('igBody');if(!el)return;
  el.innerHTML='<div class="stub"><div class="t2">Lecture du dossier…</div></div>';
  let d=null;
  try{const r=await fetch('/addons/instagram/api/summary'+(igProfile?('?profile='+encodeURIComponent(igProfile)):''));d=await r.json();}
  catch(e){d={ok:false,reason:'serveur injoignable'};}
  if(!d.ok){
    const wait=d.empty===true;
    el.innerHTML='<div class="stub"><div class="big">'+(wait?'📥':'📸')+'</div><div class="t1">'+(wait?'En attente de synchronisation':'Instagram')+'</div>'+
      '<div class="t2">'+(d.reason||'')+'<br>Cet addon lit un dossier alimenté par <code>instaloader</code> — il ne se connecte jamais à Instagram.</div></div>';
    return;
  }
  igData=d;igProfile=d.profile;
  try{const r=await fetch('/api/session');igAdmin=!!(await r.json()).admin;}catch(e){igAdmin=false;}
  let h='';
  if(d.profiles.length>1)h+='<div class="tpfav">'+d.profiles.map(p=>'<span class="tpchip'+(p===d.profile?' on':'')+'" data-prof="'+p+'">'+
    (p==='saved'?'⭐ enregistrés':'👤 '+p)+'</span>').join('')+'</div>';
  // bandeau de surveillance de la synchro
  const sy=d.sync||{};
  if(sy.available){
    const cls=sy.running?'run':(sy.result&&sy.result!=='success'?'ko':'');
    const ic=sy.running?'⏳':(sy.result==='success'?'✅':'⚠️');
    h+='<div class="igsync '+cls+'">'+ic+' '+
       (sy.running?'Synchronisation en cours…'
                  :('Dernière synchro : <b>'+(sy.finished?sy.finished.replace(/^\w+ /,'').slice(0,16):'jamais')+'</b>'+
                    (sy.result&&sy.result!=='success'?' — <b>échec ('+sy.result+')</b>':'')))+
       '<span class="sep"></span><span class="dim">Prochaine : <b>'+(sy.timer_active?(sy.next||'—'):'timer inactif')+'</b></span>'+
       '<span class="sep"></span><span class="dim"><b>'+d.total+'</b> posts · <b>'+d.videos+'</b> vidéos · <b>'+
       (d.size_gb>=1?d.size_gb+' Go':Math.round(d.size_gb*1024)+' Mo')+'</b></span>'+
       (d.last_file?'<span class="sep"></span><span class="dim">dernier média : <b>'+d.last_file+'</b></span>':'')+
       (isAdmin?'<button class="wch igsyncbtn" id="igSyncBtn"'+(sy.running?' disabled':'')+'>'+(sy.running?'⏳ en cours…':'⟳ Synchroniser')+'</button>':'')+
       '</div>';
  }else{
    h+='<div class="igsync"><span class="dim">📁 <b>'+d.total+'</b> posts · <b>'+
       (d.size_gb>=1?d.size_gb+' Go':Math.round(d.size_gb*1024)+' Mo')+'</b> — synchro automatique non détectée sur cette machine</span></div>';
  }
  const nVid=d.posts.filter(p=>p.video).length, nPho=d.posts.length-nVid;
  h+='<div class="tptabs"><span class="wch'+(igFilter==='all'?' on':'')+'" data-igf="all">Tout ('+d.posts.length+')</span>'+
     '<span class="wch'+(igFilter==='photo'?' on':'')+'" data-igf="photo">🖼️ Photos ('+nPho+')</span>'+
     '<span class="wch'+(igFilter==='video'?' on':'')+'" data-igf="video">🎬 Vidéos ('+nVid+')</span></div>';
  // la visionneuse ne navigue que dans les posts affichés
  d.posts=(igData.posts||[]).filter(p=>igFilter==='all'||(igFilter==='video'?p.video:!p.video));
  if(!d.posts.length)h+='<div class="stub"><div class="big">'+(igFilter==='video'?'🎬':'🖼️')+'</div>'+
    '<div class="t2">'+(igFilter==='all'?'Aucun média dans ce dossier':'Aucun média de ce type')+'</div></div>';
  else{
    if(state.delMode)h+='<div class="igadmin">🗑️ Mode suppression actif : touche la corbeille d\'une vignette pour l\'envoyer à la corbeille (restaurable dans ⚙ → Corbeille).</div>';
    h+='<div class="iggrid">'+d.posts.map((p,i)=>{
    const cover=p.images.length?p.images[0]:null;
    return '<div class="igtile" data-i="'+i+'" data-id="'+p.id+'">'+
      (cover?'<img loading="lazy" src="'+igUrl(d.profile,cover)+'">':'<div style="width:100%;height:100%;background:#0d1116"></div>')+
      (p.video?'<div class="igplay">▶</div>':'')+
      (p.count>1?'<div class="igbadge">🖼 '+p.count+'</div>':'')+
      (state.delMode?'<span class="igtrashicon" data-igdel="'+p.id+'" data-date="'+p.date+'" data-n="'+p.count+'">🗑</span>':'')+
      '</div>';}).join('')+'</div>';
  }
  h+='<div class="wsrc">Lecture hors ligne d\'un dossier local · aucune connexion à Instagram</div>';
  el.innerHTML=h;
  el.querySelectorAll('[data-prof]').forEach(c=>c.addEventListener('click',()=>{igProfile=c.dataset.prof;igFilter='all';loadInstaView(a);}));
  el.querySelectorAll('[data-igf]').forEach(t=>t.addEventListener('click',()=>{igFilter=t.dataset.igf;loadInstaView(a);}));
  el.querySelectorAll('.igtile').forEach(t=>t.addEventListener('click',ev=>{
    if(ev.target.dataset.igdel!=null)return;
    igOpen(parseInt(t.dataset.i));}));
  el.querySelectorAll('[data-igdel]').forEach(b=>b.addEventListener('click',async ev=>{
    ev.stopPropagation();
    const n=parseInt(b.dataset.n)||1;
    if(!confirm('Supprimer la publication du '+b.dataset.date+' ('+n+' média'+(n>1?'s':'')+') ?\nElle part à la corbeille, restaurable dans ⚙ → Corbeille.'))return;
    const ok=await igTrashPost({profile:igData.profile,posts:[b.dataset.igdel]},a);
    if(ok)loadInstaView(a);
  }));
  const sb=document.getElementById('igSyncBtn');
  if(sb)sb.addEventListener('click',async()=>{
    sb.disabled=true;sb.textContent='⏳ démarrage…';
    try{
      const r=await fetch('/addons/instagram/api/sync',{method:'POST'});
      const j=await r.json();
      if(!j.ok){toast('Synchro : '+(j.reason||'échec'));sb.disabled=false;sb.textContent='⟳ Synchroniser';return;}
      toast('Synchronisation lancée');
      let n=0;const poll=setInterval(async()=>{
        if(++n>50){clearInterval(poll);return;}
        let d=null;try{const rr=await fetch('/addons/instagram/api/summary');d=await rr.json();}catch(e){}
        if(!(d&&d.sync&&d.sync.running)){clearInterval(poll);loadInstaView(a);}
      },6000);
      loadInstaView(a);
    }catch(e){toast('Synchro injoignable');sb.disabled=false;sb.textContent='⟳ Synchroniser';}
  });
}
async function igTrashPost(payload,a){
  try{
    const r=await fetch('/addons/instagram/api/trash',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify(payload)});
    const j=await r.json();
    if(j.ok){toast(j.count+' fichier(s) mis à la corbeille');return true;}
    toast('Impossible — '+(j.reason||''));
  }catch(e){toast('Serveur injoignable');}
  return false;
}
function igFmt(s2){if(!isFinite(s2))return '0:00';const m=Math.floor(s2/60);return m+':'+String(Math.floor(s2%60)).padStart(2,'0');}
function igOpen(i){
  igPost=i;igSlide=0;
  const v=document.createElement('div');v.className='igview';v.id='igView';
  document.body.appendChild(v);
  igRender();
  document.addEventListener('keydown',igKeys);
}
function igClose(){
  const v=document.getElementById('igView');if(v)v.remove();
  document.removeEventListener('keydown',igKeys);
}
function igKeys(e){
  if(e.key==='Escape')igClose();
  else if(e.key==='ArrowRight')igStep(1);
  else if(e.key==='ArrowLeft')igStep(-1);
  else if(e.key===' '){e.preventDefault();igToggle();}
}
function igStep(d){
  const p=igData.posts[igPost],med=igMedia(p);
  if(igSlide+d>=0&&igSlide+d<med.length){igSlide+=d;igRender();return;}
  const n=igPost+d;
  if(n>=0&&n<igData.posts.length){igPost=n;igSlide=(d>0?0:igMedia(igData.posts[n]).length-1);igRender();}
}
function igToggle(){
  const vid=document.querySelector('#igView video');
  if(vid)vid.paused?vid.play():vid.pause();
}
function igRender(){
  const v=document.getElementById('igView');if(!v||!igData)return;
  const p=igData.posts[igPost],med=igMedia(p),file=med[igSlide];
  const isVid=/\.(mp4|mov|webm)$/i.test(file);
  const prof=igData.profile;
  let h='<div class="igtop"><span class="t">'+p.date+'</span>'+
    '<span class="t">'+(igPost+1)+' / '+igData.posts.length+'</span>'+
    '<span class="igclose" id="igX">✕</span></div>';
  h+='<div class="igstage">'+
    (isVid
      ? '<video id="igVid" src="'+igUrl(prof,file)+'" playsinline autoplay></video>'
      : '<img src="'+igUrl(prof,file)+'">')+
    '<div class="ignav prev" id="igPrev">‹</div><div class="ignav next" id="igNext">›</div></div>';
  if(med.length>1)h+='<div class="igdots">'+med.map((_,k)=>'<i class="'+(k===igSlide?'on':'')+'"></i>').join('')+'</div>';
  if(p.caption)h+='<div class="igcap">'+p.caption.replace(/</g,'&lt;')+'</div>';
  if(isVid){
    h+='<div class="igctrl"><span class="igbtn" id="igBack">⏪ 10</span>'+
       '<span class="igbtn big" id="igPlay">⏸</span>'+
       '<span class="igbtn" id="igFwd">10 ⏩</span>'+
       '<span class="igtime" id="igT">0:00 / 0:00</span>'+
       '<input class="igseek" id="igSeek" type="range" min="0" max="1000" value="0">'+
       '<span class="igbtn" id="igFull">⛶</span>'+
       '<span class="igbtn del" id="igDelM" title="Supprimer ce média">🗑</span></div>';
  }else{
    h+='<div class="igctrl"><span class="igbtn" id="igBackP">‹</span>'+
       '<span class="igtime">'+(igSlide+1)+' / '+med.length+'</span>'+
       '<span class="igbtn" id="igNextP">›</span>'+
       '<span class="igbtn del" id="igDelM" title="Supprimer ce média">🗑</span></div>';
  }
  v.innerHTML=h;
  v.querySelector('#igX').addEventListener('click',igClose);
  v.querySelector('#igPrev').addEventListener('click',()=>igStep(-1));
  v.querySelector('#igNext').addEventListener('click',()=>igStep(1));
  const bp=v.querySelector('#igBackP'),np=v.querySelector('#igNextP');
  if(bp)bp.addEventListener('click',()=>igStep(-1));
  if(np)np.addEventListener('click',()=>igStep(1));
  const dm=v.querySelector('#igDelM');
  if(dm)dm.addEventListener('click',async()=>{
    if(!confirm('Supprimer ce média ?\n'+file+'\nIl part à la corbeille.'))return;
    const okDel=await igTrashPost({profile:igData.profile,medias:[file]},null);
    if(!okDel)return;
    igClose();
    loadInstaView({id:'instagram',ic:'📸',nm:'Instagram'});
  });
  if(isVid){
    const vid=v.querySelector('#igVid'),play=v.querySelector('#igPlay'),
          seek=v.querySelector('#igSeek'),tl=v.querySelector('#igT');
    v.querySelector('#igBack').addEventListener('click',()=>{vid.currentTime=Math.max(0,vid.currentTime-10);});
    v.querySelector('#igFwd').addEventListener('click',()=>{vid.currentTime=Math.min(vid.duration||0,vid.currentTime+10);});
    play.addEventListener('click',()=>{vid.paused?vid.play():vid.pause();});
    vid.addEventListener('play',()=>play.textContent='⏸');
    vid.addEventListener('pause',()=>play.textContent='▶');
    vid.addEventListener('timeupdate',()=>{
      if(vid.duration){seek.value=Math.round(vid.currentTime/vid.duration*1000);
        tl.textContent=igFmt(vid.currentTime)+' / '+igFmt(vid.duration);}
    });
    seek.addEventListener('input',()=>{if(vid.duration)vid.currentTime=seek.value/1000*vid.duration;});
    v.querySelector('#igFull').addEventListener('click',()=>{
      if(vid.requestFullscreen)vid.requestFullscreen().catch(()=>{});});
    v.querySelector('.igstage').addEventListener('click',e=>{if(e.target===vid)igToggle();});
  }
}
/* --- Météo (Open-Meteo) : bandeau + vue addon --- */
function ymdLocal(d){return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}
function dDate(x){return new Date(x).toLocaleDateString('fr-FR',{day:'numeric',month:'short'});}
function viewFor(a){
  if(a.ui)return '<div id="auiBody" style="padding:14px 22px;flex:1 0 auto;display:flex;flex-direction:column;min-height:0;box-sizing:border-box"><div class="stub"><div class="t2">Chargement de la vue…</div></div></div>';
  if(a.ui||a.decl)return '<div id="adBody" style="padding:14px 22px"></div>';
  if(a.id==='wifi')return '<div id="wfBody" style="padding:14px 22px"></div>';
  if(a.id==='bluetooth')return '<div id="btBody" style="padding:14px 22px"></div>';
  if(a.id==='maj')return '<div id="mjBody" style="padding:14px 22px"></div>';
  if(a.id==='instagram'&&!a.ui)return '<div id="igBody" style="padding:14px 22px"></div>';
  if(a.id==='minuteur')return '<div id="tmBody" style="padding:14px 22px"></div>';
  if(a.id==='proxmox')return '<div id="pveBody" style="padding:14px 22px"><div class="stub"><div class="t2">Chargement de Proxmox…</div></div></div>';
  if(a.id==='grafana')return '<div id="grafBody" style="padding:14px 22px"><div class="stub"><div class="t2">Chargement de Grafana…</div></div></div>';
  if(a.type==='igvideo')return '<div class="stub"><div class="big">📸</div><div class="t1">Instagram — lecteur</div><div class="t2">Vidéos enregistrées filtrées par <b>collection / label</b>, bascule Vidéos/Photos, pellicule de miniatures. Source : <code>instaloader :saved</code>.</div></div>';
  if(a.id==='navigateur')return '<div id="brBody" class="browser"><div class="lghint" style="padding:40px">Chargement du navigateur…</div></div>';
  if(a.type==='iframe'||a.type==='browser')return '<div id="launchBody" class="launch"><div class="lghint">Chargement…</div></div>';
  return '<div class="stub"><div class="big">'+tileIcon(a)+'</div><div class="t1">'+a.nm+'</div><div class="t2">Vue native (rendu Flask via <code>'+a.src+'</code>).</div></div>';
}

/* ---------- SETTINGS DASHBOARD ---------- */
const settings=document.getElementById('settings'),setnav=document.getElementById('setnav'),setcontent=document.getElementById('setcontent');
const ALL_SECTIONS=[
  ["sys","📈","Système","#378add"],
  ["apps","🧩","Applications","#534ab7"],
  ["reglages","🗂️","Réglages","#888780"],
  ["apparence","🎨","Apparence","#c98af0"],
  ["son","🔊","Son","#e8a06a"],
  ["categorie","🏷️","Catégories","#5ac8a8"],
  ["sec","🔒","Sécurité","#e8635a"],
  ["--","",""],
  ["minuteur","⏱️","Minuteur","#f0b429"],
  ["wifi","📶","WiFi","#378add"],
  ["bluetooth","🔵","Bluetooth","#378add"],
  ["corbeille","🗑️","Corbeille","#888780"],
  ["version","ℹ️","Version","#7aa2f7"]];
const SEC_REQUIRES={minuteur:['minuteur'],corbeille:['instagram','recettes']};
function sections(){
  const inst=state.installed||[];
  const keep=ALL_SECTIONS.filter(([id])=>{
    if(id==='--')return true;
    const req=SEC_REQUIRES[id];
    if(!req)return true;
    return req.some(x=>inst.includes(x));
  });
  // pas de séparateur en fin de liste ni doublé
  return keep.filter((x,i)=>!(x[0]==='--'&&(i===keep.length-1||(keep[i+1]&&keep[i+1][0]==='--'))));
}
let curSec="sys",appFilter="home",appQuery="";
let appTab="myapps",appCatFilter="all",appView="list",appSortKey="default";
const APP_CATS=["Maison","Quotidien","Services","Médias","Outils"];
let STORE_CAT={};   // id -> catégorie, alimenté depuis l'index (pour les installés du store)
let isAdmin=false,adminDefault=false,adminNoPw=false;
async function refreshSession(){
  try{const r=await fetch('/api/session');const j=await r.json();isAdmin=!!j.admin;adminDefault=!!j.default_admin;adminNoPw=!!j.admin_nopw;}catch(e){}
}
function openSettings(sec){
  curSec=sec||"sys";
  settings.classList.add('show');
  refreshSession().then(()=>{ if(isAdmin)renderSettings(); else renderAdminGate(sec||"sys"); });
}
function renderAdminGate(target){
  setnav.innerHTML='';
  setcontent.innerHTML='<div class="admgate"><div class="big">🔐</div><h3>Paramètres protégés</h3>'+
    '<p>Saisis le <b>mot de passe administrateur</b>. Il est distinct du code PIN qui déverrouille le kiosk.</p>'+
    '<input class="admin-input" type="password" id="admPw" placeholder="Mot de passe admin" autocomplete="off">'+
    '<div class="admerr" id="admErr"></div>'+
    '<button class="btnpill install" id="admGo">Déverrouiller</button></div>';
  const inp=document.getElementById('admPw'),err=document.getElementById('admErr');
  const go=async()=>{
    err.textContent='';
    try{
      const r=await fetch('/api/admin/verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:inp.value})});
      const j=await r.json();
      if(j.ok){isAdmin=true;await refreshSession();curSec=target;renderSettings();}
      else if(j.wait)err.textContent='Trop d\'essais — réessaie dans '+j.wait+' s';
      else err.textContent='Mot de passe incorrect'+(j.remaining!=null?' ('+j.remaining+' essai(s) restant(s))':'');
    }catch(e){err.textContent='Serveur injoignable';}
    inp.value='';
  };
  document.getElementById('admGo').addEventListener('click',go);
  inp.addEventListener('keydown',e=>{if(e.key==='Enter')go();});
  setTimeout(()=>inp.focus(),50);
}
document.getElementById('gear').addEventListener('click',()=>openSettings('sys'));
document.addEventListener('click',e=>{var t=e.target.closest&&e.target.closest('#wifiIndSw,#btIndSw');if(!t)return;var key=t.id==='wifiIndSw'?'wifiInd':'btInd';state[key]=!(state[key]!==false);t.classList.toggle('on',state[key]!==false);save();updateConnIcons();toast('Indicateur '+(t.id==='wifiIndSw'?'WiFi':'Bluetooth')+(state[key]!==false?' affiché':' masqué'));});
// Bouton « Coller » (presse-papier) — délégation globale, contexte sécurisé 127.0.0.1
document.addEventListener('click',async e=>{
  const b=e.target.closest('.pastebtn');if(!b)return;
  const inp=b.parentElement.querySelector('.inp');if(!inp)return;
  try{
    const txt=(await navigator.clipboard.readText()||'').trim();
    if(!txt){toast('Presse-papier vide');return;}
    inp.value=txt;inp.dispatchEvent(new Event('input',{bubbles:true}));
    b.textContent='✓';setTimeout(()=>{b.textContent='📋';},900);
  }catch(err){toast('Coller indisponible — autorise le presse-papier (Chromium)');}
});
/* Clavier virtuel automatique : apparaît quand un champ texte de Panda reçoit
   le focus, disparaît sinon. wvkbd tourne caché ; on l'affiche/masque par
   signaux via le backend. (Les champs DANS Chromium sont gérés séparément
   par --enable-wayland-ime au lancement du navigateur.) */
(function(){
  let _kbdT=null;
  const _isText=(el)=>{
    if(!el)return false;
    if(el.tagName==='TEXTAREA')return true;
    if(el.tagName!=='INPUT')return false;
    const t=(el.type||'text').toLowerCase();
    return ['text','password','search','url','email','tel','number'].includes(t);
  };
  const _kbd=(action)=>{fetch('/api/system/keyboard/'+action,{method:'POST'}).catch(()=>{});};
  // On envoie systématiquement (pas de cache d'état) : l'utilisateur peut
  // fermer le clavier avec la touche ✕ sans que Panda le sache. Envoyer 'show'
  // à chaque focus garantit la réouverture. Les signaux sont idempotents.
  const _show=()=>{_kbd('show');};
  const _hide=()=>{_kbd('hide');};
  // focusin/out remontent (delegation) : marche pour tous les champs, même créés dynamiquement
  document.addEventListener('focusin',e=>{clearTimeout(_kbdT);if(_isText(e.target))_show();});
  document.addEventListener('focusout',e=>{
    // léger délai : si le focus passe à un autre champ, on ne masque pas
    clearTimeout(_kbdT);_kbdT=setTimeout(()=>{if(!_isText(document.activeElement))_hide();},250);
  });
})();
async function closeSettings(){
  stopSysTimer();
  settings.classList.remove('show');
  isAdmin=false;
  try{await fetch('/api/admin/lock',{method:'POST'});}catch(e){}
}
document.getElementById('closeSet').addEventListener('click',()=>closeSettings());

/* --- panneau de config par module (Phase 6) --- */
const cfgView=document.getElementById('cfgView');
document.getElementById('cfgBack').addEventListener('click',()=>cfgView.classList.remove('show'));
async function openCfg(a){
  document.getElementById('cfgTitle').innerHTML=tileIcon(a)+' Réglages — '+dnm(a);
  const body=document.getElementById('cfgBody');
  const fields=CFG_SCHEMA[a.id]||[];
  let vals={};
  if(fields.length){try{const r=await fetch('/api/modules/'+a.id);if(r.ok)vals=await r.json();}catch(e){}}
  const cur=(state.names&&state.names[a.id])?state.names[a.id].replace(/"/g,'&quot;'):'';
  let h='<div class="cfgform">';
  h+='<label class="cfgf"><span>Nom affiché</span><input class="inp" id="cfgName" type="text" placeholder="'+a.nm+'" value="'+cur+'"></label>';
  if(!fields.length&&['courses','stock','recettes','repas'].includes(a.id)){
    h+='<div class="cmeta" style="padding:4px 2px;line-height:1.5">🥘 La connexion KitchenOwl est centralisée dans <b>⚙ Hub cuisine</b> — cet addon l\'utilise automatiquement.</div>';
  }
  fields.forEach(f=>{
    const v=vals[f.key]!=null?String(vals[f.key]).replace(/"/g,'&quot;'):'';
    if(f.type==='select'){
      h+='<label class="cfgf"><span>'+f.label+'</span><select class="inp" data-k="'+f.key+'">'+
        (f.options||[]).map(o=>'<option value="'+o[0]+'"'+(v===o[0]?' selected':'')+'>'+o[1]+'</option>').join('')+'</select></label>';
    }else if(f.type==='toggle'){
      const on=(vals[f.key]!=null)?(vals[f.key]!==false&&vals[f.key]!=='false'):(f.default!==false);
      h+='<label class="cfgf cfgtog"><span>'+f.label+'</span>'+
        '<input type="checkbox" class="cfgcheck" data-k="'+f.key+'" data-toggle="1"'+(on?' checked':'')+'></label>';
    }else{
      h+='<label class="cfgf"><span>'+f.label+'</span>'+
        '<div class="cfgpaste"><input class="inp" data-k="'+f.key+'" type="'+(f.type||'text')+'" placeholder="'+(f.placeholder||'')+'" value="'+v+'">'+
        '<button type="button" class="pastebtn" title="Coller depuis le presse-papier">📋</button></div></label>';
    }
  });
const meteoGeoPicker=()=>{
    if(a.id!=='meteo'&&a.id!=='lune')return;
    const box=document.getElementById('geoPick');if(!box)return;
    box.innerHTML='<button class="btnpill" id="geoBtn" type="button">📍 Trouver les coordonnées depuis la ville</button>'+
      '<div id="geoRes" style="margin-top:8px;font-size:12px"></div>';
    const res=document.getElementById('geoRes');
    const setv=(k,val)=>{const el=document.querySelector('#cfgBody [data-k="'+k+'"]');
      if(el&&val!=null&&val!==''){el.value=val;el.dispatchEvent(new Event('input',{bubbles:true}));}};
    document.getElementById('geoBtn').addEventListener('click',async()=>{
      const vinp=document.querySelector('#cfgBody [data-k="ville"]');
      const q=vinp?vinp.value.trim():'';
      if(q.length<2){res.innerHTML='<span style="color:var(--dim)">Renseigne d\'abord une ville ci-dessus.</span>';return;}
      res.innerHTML='<span style="color:var(--dim)">Recherche…</span>';
      try{
        const r=await fetch('/addons/'+a.id+'/api/geocode?q='+encodeURIComponent(q));
        const j=await r.json();
        if(!j.ok||!j.results.length){res.innerHTML='<span style="color:var(--bad)">'+(j.reason||'aucune ville trouvée')+'</span>';return;}
        res.innerHTML='<div style="color:var(--dim);margin-bottom:6px">Choisis la bonne correspondance :</div>'+
          j.results.map((c,i)=>{
            const sub=[c.admin2,c.admin1,c.country].filter(Boolean).join(', ');
            return '<div class="georow" data-i="'+i+'" style="padding:8px 10px;border:1px solid var(--line);'+
              'border-radius:8px;margin-bottom:6px;cursor:pointer"><b>'+c.name+'</b>'+
              (sub?' <span style="color:var(--dim)">— '+sub+'</span>':'')+
              (c.dept?' <span style="color:var(--faint)">(dépt '+c.dept+')</span>':'')+'</div>';
          }).join('');
        res.querySelectorAll('.georow').forEach(row=>row.addEventListener('click',()=>{
          const c=j.results[+row.dataset.i];
          setv('lat',c.lat);setv('lon',c.lon);
          if(c.name)setv('ville',c.name);
          if(c.dept)setv('dept',c.dept);
          res.innerHTML='<span style="color:var(--green)">✓ '+c.name+' — '+Number(c.lat).toFixed(4)+', '+
            Number(c.lon).toFixed(4)+(c.dept?' · dépt '+c.dept:'')+
            '. Pense à <b>enregistrer</b>.</span>';
        }));
      }catch(e){res.innerHTML='<span style="color:var(--bad)">serveur injoignable</span>';}
    });
  };
  const instaSyncPanel=()=>{
    if(a.id!=='instagram')return;
    const box=document.getElementById('igCtl');if(!box)return;
    let pollT=null;
    const stop=()=>{if(pollT){clearInterval(pollT);pollT=null;}};
    const load=async()=>{
      const cur=document.getElementById('igCtl');
      if(!cur||cur!==box){stop();return;}                       // panneau fermé / re-rendu
      if(pollT&&box.contains(document.activeElement))return;    // ne pas écraser une saisie
      let st=null;
      try{const r=await fetch('/addons/instagram/api/sync/status');st=await r.json();}catch(e){st=null;}
      if(!st||!st.available){
        stop();
        box.innerHTML='<div class="cmeta" style="padding:4px 2px;line-height:1.5">📸 Synchronisation pilotée indisponible — <code>insta-ctl</code> n\'est pas installé sur cette machine.'+
          (st&&st.reason?'<br>'+String(st.reason).replace(/</g,'&lt;'):'')+'</div>';
        return;
      }
      const running=(st.active==='activating'||st.active==='active');
      const cal=st.calendar||'';
      let mode='off',hm='03:20',m;
      if(st.timer&&cal){
        if(cal==='00/6:00:00')mode='6h';
        else if(cal==='00/12:00:00')mode='12h';
        else if((m=cal.match(/^\*-\*-\* (\d{2}):(\d{2}):00$/))){mode='daily';hm=m[1]+':'+m[2];}
      }
      box.innerHTML='<div class="cfgf"><span>Synchronisation Instagram</span>'+
        '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:4px">'+
        '<button type="button" class="btnpill install" id="igRunBtn"'+(running?' disabled':'')+'>'+
        (running?'⏳ Synchronisation en cours…':'⟳ Synchroniser maintenant')+'</button>'+
        '<span style="font-size:12px;color:var(--dim)">'+
        (running?'en cours…':('dernière : <b>'+(st.last_exit||'jamais')+'</b>'+
          (st.result==='success'?' ✓':(st.result?' — <b style="color:var(--bad)">échec ('+st.result+')</b>':''))))+
        (st.timer?' · prochaine : <b>'+(st.next||'—')+'</b>':' · planification désactivée')+
        '</span></div></div>'+
        '<div class="cfgf" style="margin-top:8px"><span>Planification automatique</span>'+
        '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:4px">'+
        '<select class="inp" id="igSchedSel" style="max-width:220px">'+
        '<option value="off"'+(mode==='off'?' selected':'')+'>Désactivée</option>'+
        '<option value="daily"'+(mode==='daily'?' selected':'')+'>Quotidienne à…</option>'+
        '<option value="6h"'+(mode==='6h'?' selected':'')+'>Toutes les 6 h</option>'+
        '<option value="12h"'+(mode==='12h'?' selected':'')+'>Toutes les 12 h</option></select>'+
        '<input class="inp" id="igSchedTime" type="time" value="'+hm+'" style="max-width:120px;display:'+(mode==='daily'?'block':'none')+'">'+
        '<button type="button" class="btnpill" id="igSchedApply">Appliquer</button>'+
        '<span id="igSchedRes" style="font-size:12px"></span></div></div>';
      const runBtn=document.getElementById('igRunBtn');
      runBtn.addEventListener('click',async()=>{
        runBtn.disabled=true;runBtn.textContent='⏳ démarrage…';
        try{
          const r=await fetch('/addons/instagram/api/sync',{method:'POST'});
          const j=await r.json();
          if(!j.ok){toast('Synchro : '+(j.reason||'échec'));load();return;}
          toast('Synchronisation lancée');
          setTimeout(load,1200);
        }catch(e){toast('Serveur injoignable');load();}
      });
      const sel=document.getElementById('igSchedSel'),ti=document.getElementById('igSchedTime');
      sel.addEventListener('change',()=>{ti.style.display=sel.value==='daily'?'block':'none';});
      document.getElementById('igSchedApply').addEventListener('click',async()=>{
        const res=document.getElementById('igSchedRes');
        let expr='off';
        if(sel.value==='6h')expr='00/6:00:00';
        else if(sel.value==='12h')expr='00/12:00:00';
        else if(sel.value==='daily'){
          const v=(ti.value||'').trim();
          if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(v)){res.textContent='✗ heure invalide';res.style.color='var(--bad)';return;}
          expr='*-*-* '+v+':00';
        }
        res.textContent='application…';res.style.color='var(--dim)';
        try{
          const r=await fetch('/addons/instagram/api/schedule',{method:'POST',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({expr:expr})});
          const j=await r.json();
          if(j.ok){res.textContent='✓ planification appliquée';res.style.color='var(--green)';setTimeout(load,800);}
          else{res.textContent='✗ '+(j.reason||'refusé');res.style.color='var(--bad)';}
        }catch(e){res.textContent='✗ serveur injoignable';res.style.color='var(--bad)';}
      });
      if(running){if(!pollT)pollT=setInterval(load,6000);}
      else stop();
    };
    load();
  };
  const doc=CFG_DOC[a.id];
  if(doc&&fields.some(f=>/key|token/i.test(f.key)))
    h+='<div class="cmeta" style="margin:-2px 0 8px">🔑 Obtenir une clé : <a href="#" onclick="openService(\''+doc[1].replace(/'/g,"\\'")+'\',\'\');return false;" style="color:var(--accent)">'+doc[0]+' ↗</a></div>';
  if(!fields.length)h+='<div class="cmeta" style="margin:-4px 0 10px">Aucun réglage technique — seul le nom est modifiable.</div>';
  if(a.id==='meteo'||a.id==='lune')h+='<div id="geoPick" style="margin:2px 0 10px"></div>';
  if(a.id==='instagram'&&!a.ui)h+='<div id="igCtl" style="margin:2px 0 10px"></div>';
  if(a.ui)h+='<div id="auiCfg" style="margin:2px 0 10px"></div>';
  if((state.installed||[]).includes(a.id)){
    const shownHome=!(state.hidden||[]).includes(a.id);
    h+='<div class="setrow" style="margin-top:6px"><div class="lft"><div class="t">🏠 Afficher sur l\'accueil</div>'+
       '<div class="d">Affiche ou masque la tuile de cet addon sur l\'écran d\'accueil</div></div>'+
       '<div class="sw'+(shownHome?' on':'')+'" id="swHomeCfg"></div></div>';
  }
  const DEL_ADDONS=['instagram','recettes'];
  if(DEL_ADDONS.includes(a.id)&&(state.installed||[]).includes(a.id))
    h+='<div class="setrow" style="margin-top:6px"><div class="lft"><div class="t">🗑️ Mode suppression</div>'+
       '<div class="d">Affiche les corbeilles sur les recettes et les médias Instagram</div></div>'+
       '<div class="sw'+(state.delMode?' on':'')+'" id="swDelCfg"></div></div>';
  h+='<div style="display:flex;gap:10px;margin-top:6px"><button class="btnpill install" id="cfgSave">Enregistrer</button>'+(fields.length?'<button class="btnpill" id="cfgTest">Tester</button>':'')+((a.source==='store'&&(state.installed||[]).includes(a.id))?'<button class="btnpill stdanger" id="cfgUninstall">Désinstaller</button>':'')+'</div><div id="cfgResult" style="margin-top:12px;font-family:var(--mono);font-size:12.5px"></div></div>';
  body.innerHTML=h;
  const swh=document.getElementById('swHomeCfg');
  if(swh)swh.addEventListener('click',()=>{
    const hidden=(state.hidden||[]).includes(a.id);
    if(hidden)state.hidden=(state.hidden||[]).filter(x=>x!==a.id);
    else state.hidden=(state.hidden||[]).concat(a.id);
    swh.classList.toggle('on',hidden);save();renderHome();
    toast(hidden?dnm(a)+' affiché sur l\'accueil':dnm(a)+' masqué de l\'accueil');});
  const swc=document.getElementById('swDelCfg');
  if(swc)swc.addEventListener('click',()=>{
    state.delMode=!state.delMode;swc.classList.toggle('on',state.delMode);save();
    toast(state.delMode?'Mode suppression activé':'Mode suppression désactivé');});
  document.getElementById('cfgSave').addEventListener('click',async()=>{
    await saveCfg(a);
    startAgendaNotif();   // les hooks background rafraîchissent leurs surfaces avec la nouvelle config
  });
  const tb=document.getElementById('cfgTest');
  if(tb)tb.addEventListener('click',async()=>{await testCfg(a);
    if(a.ui)_auiLoad(a.addon||a.id,a.ui,a.ver).then(m=>{const bx=document.getElementById('auiCfg');
      if(bx&&m&&m.configPanel)try{m.configPanel(bx,_auiSdk(a.addon||a.id));}catch(e){}});});
  const ub=document.getElementById('cfgUninstall');
  if(ub)ub.addEventListener('click',()=>{cfgView.classList.remove('show');storeUninstall({id:a.id,name:dnm(a)});});
  meteoGeoPicker();
  instaSyncPanel();
  if(a.ui)_auiLoad(a.addon||a.id,a.ui,a.ver).then(m=>{
    const box=document.getElementById('auiCfg');
    if(!box)return;                                   // panneau fermé entre-temps
    if(m&&m.configPanel){try{m.configPanel(box,_auiSdk(a.addon||a.id));}catch(e){box.innerHTML='<div class="cmeta">Volet de l\'addon en erreur.</div>';}}
  });
  cfgView.classList.add('show');
}
function _cfgValues(){const data={};document.querySelectorAll('#cfgBody [data-k]').forEach(i=>{data[i.dataset.k]=i.dataset.toggle?i.checked:i.value;});return data;}
async function testCfg(a){
  const res=document.getElementById('cfgResult');
  res.textContent='Test en cours…';res.style.color='var(--dim)';
  try{
    const r=await fetch('/api/modules/'+a.id+'/test',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(_cfgValues())});
    const d=await r.json();
    res.textContent=(d.ok?'✓ ':'✗ ')+(d.msg||'');res.style.color=d.ok?'var(--green)':'var(--bad)';
  }catch(e){res.textContent='✗ Pas de réponse du kiosk (test trop long ?) — réessaie';res.style.color='var(--bad)';}
}
async function saveCfg(a){
  const nm=document.getElementById('cfgName');
  if(nm){const v=nm.value.trim();state.names=state.names||{};if(v)state.names[a.id]=v;else delete state.names[a.id];save();}
  const fields=CFG_SCHEMA[a.id]||[];
  try{
    if(fields.length){await fetch('/api/modules/'+a.id,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(_cfgValues())});}
    renderHome();updateFleet();toast('Réglages enregistrés');cfgView.classList.remove('show');
  }catch(e){toast('Serveur injoignable');}
}
function renderSettings(){
  setnav.innerHTML='';
  const SECS=sections();
  if(!SECS.some(([id])=>id===curSec))curSec='apps';
  SECS.forEach(([id,sic,l,scol])=>{
    if(id==='--'){const sp=document.createElement('div');sp.className='navsep';setnav.appendChild(sp);return;}
    const el=document.createElement('div');el.className='item'+(id===curSec?' on':'');el.innerHTML='<span class="ico">'+ic(sic,id===curSec?null:scol)+'</span>'+l+(id==='apps'?'<span class="navbadge" id="navAppsBadge" style="display:none"></span>':'');el.addEventListener('click',()=>{stopSysTimer();curSec=id;renderSettings();});setnav.appendChild(el);});
  updateStoreBadges();
  if(curSec==='sys')secSys();
  else if(curSec==='apps')secApps();
  else if(curSec==='reglages')secReglages();
  else if(curSec==='apparence')secApparence();
  else if(curSec==='categorie')secCategorie();
  else if(curSec==='version')secVersion();
  else if(curSec==='minuteur')secTimer();
  else if(curSec==='corbeille')secTrash();
  else if(curSec==='wifi')secWifi();
  else if(curSec==='bluetooth')secBluetooth();
  else if(curSec==='son')secSon();
  else secSec();
}
let tzSounds=[];
async function secTimer(){
  try{const r=await fetch('/api/timer/sounds');const j=await r.json();tzSounds=j.ok?j.sounds:[];}catch(e){tzSounds=[];}
  renderTimerSection();
}
function renderTimerSection(){
  const p=state.timers||[];
  let h='<h4>Minuteur</h4><div class="desc">Préréglages, sonnerie et couleurs du compte à rebours.</div>';
  h+='<div class="setrow"><div class="lft"><div class="t">Affichage des préréglages</div><div class="d">Contenu des cartes dans la vue Minuteur (la durée reste toujours visible)</div></div><select class="inp" id="tzDisp" style="max-width:210px">'+
    '<option value="text"'+((state.timerDisplay||'text')==='text'?' selected':'')+'>Textes seulement</option>'+
    '<option value="icons"'+(state.timerDisplay==='icons'?' selected':'')+'>Icônes seulement</option>'+
    '<option value="images"'+(state.timerDisplay==='images'?' selected':'')+'>Images seulement</option>'+
    '<option value="both"'+(state.timerDisplay==='both'?' selected':'')+'>Icônes + images</option>'+
    '</select></div>';
  h+='<div class="wsec" style="padding-left:0">Préréglages</div>';
  h+=p.length?p.map((x,i)=>'<div class="igtf" style="cursor:default"><span>'+(x.i||'⏱️')+'</span>'+
      '<span class="nm" style="flex:1'+(x.color?(';color:'+x.color):'')+'">'+x.n+'</span>'+
      (x.img?'<img src="/api/timer/image/'+encodeURIComponent(x.img)+'" style="width:26px;height:26px;object-fit:cover;border-radius:6px;border:1px solid var(--border-soft)" alt="">':'')+
      (x.bg?'<span style="width:16px;height:16px;border-radius:5px;background:'+x.bg+';border:1px solid var(--border-soft)"></span>':'')+
      '<span class="sz" style="margin-left:auto;padding-right:6px">'+tmFmt(x.s)+'</span>'+
      '<span class="sz" style="min-width:96px;flex:none;color:var(--faint)">'+(x.sound?('🔔 '+x.sound.replace(/\.[^.]+$/,'')):'🔔 bip')+'</span>'+
      '<span class="igbtn2" data-tedit="'+i+'">✏️</span>'+
      '<span class="igbtn2" data-tdel="'+i+'">🗑</span></div>').join('')
    :'<div style="font-size:12px;color:var(--dim);padding:6px 0">Aucun préréglage</div>';
  h+='<button class="btnpill install" id="tzNew" style="margin-top:10px">+ Nouveau préréglage</button>';

  h+='<div class="wsec" style="padding-left:0;margin-top:18px">Sonneries</div>';
  h+=tzSounds.length?tzSounds.map(sd=>'<div class="igtf" style="cursor:default"><span>🔔</span>'+
      '<span class="nm" style="flex:1">'+sd.name+'</span><span class="sz">'+sd.size_kb+' Ko</span>'+
      '<span class="igbtn2'+(tmPreviewName===sd.name?' on':'')+'" data-play="'+sd.name+'">'+
        (tmPreviewName===sd.name?'⏹ Arrêter':'▶ Écouter')+'</span>'+
      '<span class="igbtn2 danger" data-sdel="'+sd.name+'">🗑</span></div>').join('')
    :'<div style="font-size:12px;color:var(--dim);padding:6px 0">Aucune sonnerie — le bip par défaut sera utilisé</div>';
  h+='<div class="koadd" style="margin-top:8px"><input type="file" id="tzFile" accept="audio/*" class="inp" style="flex:1">'+
     '<button id="tzUp">Envoyer</button></div><div class="kotoast" id="tzErr"></div>';
  setcontent.innerHTML=h;

  setcontent.querySelectorAll('[data-tdel]').forEach(b=>b.addEventListener('click',()=>{
    const i=parseInt(b.dataset.tdel);
    if(!confirm('Supprimer le préréglage « '+state.timers[i].n+' » ?'))return;
    const im=state.timers[i].img;
    if(im&&!state.timers.some((t,k)=>k!==i&&t.img===im))fetch('/api/timer/images/'+encodeURIComponent(im),{method:'DELETE'}).catch(()=>{});
    state.timers.splice(i,1);save();renderTimerSection();}));
  setcontent.querySelectorAll('[data-tedit]').forEach(b=>b.addEventListener('click',()=>
    tzEditor(parseInt(b.dataset.tedit))));
  document.getElementById('tzNew').addEventListener('click',()=>tzEditor(-1));
  const tzd=document.getElementById('tzDisp');
  if(tzd)tzd.addEventListener('change',()=>{state.timerDisplay=tzd.value;save();toast('Affichage du minuteur mis à jour');});
  setcontent.querySelectorAll('[data-play]').forEach(b=>b.addEventListener('click',()=>{
    tmPreviewToggle(b.dataset.play,()=>renderTimerSection());
    renderTimerSection();}));
  setcontent.querySelectorAll('[data-sdel]').forEach(b=>b.addEventListener('click',async()=>{
    if(!confirm('Supprimer la sonnerie « '+b.dataset.sdel+' » ?'))return;
    tmPreviewStop();
    try{await fetch('/api/timer/sounds/'+encodeURIComponent(b.dataset.sdel),{method:'DELETE'});
      (state.timers||[]).forEach(t=>{if(t.sound===b.dataset.sdel)t.sound='';});save();
      toast('Sonnerie supprimée');}catch(e){}
    secTimer();}));
  document.getElementById('tzUp').addEventListener('click',async()=>{
    const f=document.getElementById('tzFile').files[0];
    const err=document.getElementById('tzErr');
    if(!f){err.textContent='Choisis un fichier audio';return;}
    const fd=new FormData();fd.append('file',f);
    try{
      const r=await fetch('/api/timer/sounds',{method:'POST',body:fd});
      const j=await r.json();
      if(j.ok){toast('« '+j.name+' » ajoutée ('+j.size_kb+' Ko)');secTimer();}
      else err.textContent=j.reason||'Envoi impossible';
    }catch(e){err.textContent='Serveur injoignable';}
  });
}
function tzEditor(idx){
  const est=idx>=0?Object.assign({},state.timers[idx]):{n:'',s:300,sound:'',color:'',bg:'',i:'',img:''};
  const sh=document.createElement('div');sh.className='evsheet';
  sh.innerHTML='<div class="evbox" style="width:500px"><div class="evtitle">⏱️ '+(idx>=0?'Modifier':'Nouveau')+' préréglage</div>'+
    '<div class="koadd"><input id="tzEN" placeholder="Nom (ex. Riz)" value="'+(est.n||'').replace(/"/g,'&quot;')+'">'+
    '<input id="tzEM" type="number" inputmode="decimal" placeholder="minutes" value="'+(est.s/60)+'" style="max-width:120px"></div>'+
    '<div class="cfgf" style="margin-top:10px"><span>Icône</span>'+
      '<input class="inp" id="tzEI" maxlength="4" placeholder="emoji (ex. 🥚)" value="'+(est.i||'').replace(/"/g,'&quot;')+'" style="max-width:130px">'+
      '<span id="tzEIPal" style="display:inline-flex;gap:6px;flex-wrap:wrap;margin-left:8px">'+
      ['🥚','🍝','🍚','🍵','🫖','☕','🍰','🍕','🥦','🍗','🥔','🍞'].map(e=>'<span class="igbtn2" data-tzei="'+e+'" style="font-size:17px;padding:3px 7px">'+e+'</span>').join('')+'</span></div>'+
    '<div class="cfgf" style="margin-top:10px"><span>Image</span>'+
      '<span id="tzEImgCur">'+(est.img?('<img src="/api/timer/image/'+encodeURIComponent(est.img)+'" style="width:40px;height:40px;object-fit:cover;border-radius:8px;border:1px solid var(--border-soft);vertical-align:middle" alt="">'):'<span style="color:var(--faint);font-size:12px">aucune</span>')+'</span>'+
      '<input type="file" id="tzEImg" accept="image/*" class="inp" style="flex:1;min-width:0">'+
      '<span class="igbtn2" id="tzEImgX">Retirer</span></div>'+
    '<div class="cfgf" style="margin-top:10px"><span>Sonnerie</span>'+
      '<select class="inp" id="tzES"><option value="">Bip par défaut</option>'+
      tzSounds.map(x=>'<option value="'+x.name+'"'+(est.sound===x.name?' selected':'')+'>'+x.name+'</option>').join('')+
      '</select></div>'+
    '<div class="calrow" style="margin-top:10px"><span class="calname">Couleur du texte</span>'+
      '<input type="color" class="calcolor" id="tzEC" value="'+(est.color||'#2dd4bf')+'">'+
      '<span class="igbtn2" id="tzECx">Aucune</span></div>'+
    '<div class="calrow"><span class="calname">Couleur de fond</span>'+
      '<input type="color" class="calcolor" id="tzEB" value="'+(est.bg||'#0d1116')+'">'+
      '<span class="igbtn2" id="tzEBx">Aucune</span></div>'+
    '<div class="igbar" style="margin-top:10px"><span class="igbtn2" id="tzEPlay">▶ Écouter</span></div>'+
    '<div class="kotoast" id="tzEErr"></div>'+
    '<button class="tprecb" id="tzESave">Enregistrer</button>'+
    '<button class="catclose" id="tzECancel">Annuler</button></div>';
  document.body.appendChild(sh);
  let color=est.color||'',bg=est.bg||'';
  const close=()=>{tmPreviewStop();sh.remove();};
  const cancel=()=>{
    if(eImg&&eImg!==(est.img||'')&&!(state.timers||[]).some(t=>t.img===eImg))
      fetch('/api/timer/images/'+encodeURIComponent(eImg),{method:'DELETE'}).catch(()=>{});
    close();};
  sh.querySelector('#tzECancel').addEventListener('click',cancel);
  sh.addEventListener('click',e=>{if(e.target===sh)cancel();});
  let eIcon=est.i||'',eImg=est.img||'';
  const eiIn=sh.querySelector('#tzEI');
  eiIn.addEventListener('input',()=>eIcon=eiIn.value.trim());
  sh.querySelectorAll('[data-tzei]').forEach(b=>b.addEventListener('click',()=>{eIcon=b.dataset.tzei;eiIn.value=eIcon;}));
  const eimgCur=sh.querySelector('#tzEImgCur');
  const eimgShow=()=>{eimgCur.innerHTML=eImg?('<img src="/api/timer/image/'+encodeURIComponent(eImg)+'" style="width:40px;height:40px;object-fit:cover;border-radius:8px;border:1px solid var(--border-soft);vertical-align:middle" alt="">'):'<span style="color:var(--faint);font-size:12px">aucune</span>';};
  sh.querySelector('#tzEImg').addEventListener('change',async ev=>{
    const f=ev.target.files[0];if(!f)return;
    const fd=new FormData();fd.append('file',f);
    const errEl=sh.querySelector('#tzEErr');errEl.textContent='Envoi de l\'image…';
    try{
      const r=await fetch('/api/timer/images',{method:'POST',body:fd});
      const j=await r.json();
      if(j.ok){
        if(eImg&&eImg!==j.name&&!(state.timers||[]).some(t=>t.img===eImg))fetch('/api/timer/images/'+encodeURIComponent(eImg),{method:'DELETE'}).catch(()=>{});
        eImg=j.name;eimgShow();errEl.textContent='';
      }else errEl.textContent=j.reason||'Envoi impossible';
    }catch(e){errEl.textContent='Serveur injoignable';}
  });
  sh.querySelector('#tzEImgX').addEventListener('click',()=>{
    if(eImg&&!(state.timers||[]).some(t=>t.img===eImg))fetch('/api/timer/images/'+encodeURIComponent(eImg),{method:'DELETE'}).catch(()=>{});
    eImg='';eimgShow();toast('Image retirée');});
  sh.querySelector('#tzEC').addEventListener('input',e=>color=e.target.value);
  sh.querySelector('#tzEB').addEventListener('input',e=>bg=e.target.value);
  sh.querySelector('#tzECx').addEventListener('click',()=>{color='';toast('Couleur de texte par défaut');});
  sh.querySelector('#tzEBx').addEventListener('click',()=>{bg='';toast('Fond par défaut');});
  const pb=sh.querySelector('#tzEPlay');
  const maj=()=>{const n=sh.querySelector('#tzES').value;
    pb.textContent=(n&&tmPreviewName===n)?'⏹ Arrêter':'▶ Écouter';
    pb.classList.toggle('on',!!n&&tmPreviewName===n);};
  pb.addEventListener('click',()=>{
    const n=sh.querySelector('#tzES').value;
    if(!n){tmBeepSynth();return;}
    tmPreviewToggle(n,()=>maj());maj();});
  sh.querySelector('#tzES').addEventListener('change',()=>{tmPreviewStop();maj();});
  sh.querySelector('#tzESave').addEventListener('click',()=>{
    const n=(sh.querySelector('#tzEN').value||'').trim();
    const v=parseFloat(sh.querySelector('#tzEM').value||'0');
    if(!n||!(v>0)){sh.querySelector('#tzEErr').textContent='Donne un nom et une durée en minutes';return;}
    const obj={n:n,s:Math.round(v*60),sound:sh.querySelector('#tzES').value||'',color:color,bg:bg,i:eIcon,img:eImg};
    state.timers=state.timers||[];
    if(idx>=0)state.timers[idx]=obj;else state.timers.push(obj);
    save();close();renderTimerSection();
  });
}
async function secTrash(){
  const inst=state.installed||[];
  const hasR=inst.includes('recettes'), hasI=inst.includes('instagram');
  setcontent.innerHTML='<h4>Corbeille</h4>'+
    (hasR?'<div class="desc" style="margin-bottom:14px"><b>Recettes supprimées</b></div><div id="rzBody"></div><div style="height:18px"></div>':'')+
    (hasI?'<div class="desc"><b>Médias Instagram supprimés</b></div>':'')+
    '<div class="desc">Médias supprimés depuis l\'addon. Restaure-les, ou efface-les définitivement pour récupérer la place — '+
    'un marqueur vide reste dans le dossier, instaloader ne les retéléchargera pas.</div><div id="tzBody"></div>';
  igTrashSel.clear();
  try{const r=await fetch('/addons/instagram/api/trash?detail=1');const j=await r.json();igTrash=j.ok?j:null;}
  catch(e){igTrash=null;}
  if(hasI)renderTrashSection();
  if(hasR)renderRecipeTrash();
}
async function renderRecipeTrash(){
  const el=document.getElementById('rzBody');if(!el)return;
  let d=null;try{const r=await fetch('/addons/recettes/api/recipe/trash');d=await r.json();}catch(e){}
  if(!d||!d.ok||!d.items.length){el.innerHTML='<div style="font-size:12px;color:var(--dim);padding:6px 0">Aucune recette supprimée</div>';return;}
  el.innerHTML=d.items.map(x=>'<div class="igtf" style="cursor:default"><span>🍽️</span>'+
    '<span class="nm">'+x.name+'</span><span class="sz">'+x.when+'</span>'+
    '<span class="igbtn2" data-rz="'+x.file+'" style="margin-left:10px">↩ Restaurer</span>'+
    '<span class="igbtn2 danger" data-rzdel="'+x.file+'">Supprimer</span></div>').join('');
  el.querySelectorAll('[data-rz]').forEach(b=>b.addEventListener('click',async()=>{
    try{const r=await fetch('/addons/recettes/api/recipe/trash/restore',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({file:b.dataset.rz})});
      const j=await r.json();
      toast(j.ok?('« '+j.name+' » restaurée'):('Impossible — '+(j.reason||'')));
    }catch(e){toast('Serveur injoignable');}
    renderRecipeTrash();}));
  el.querySelectorAll('[data-rzdel]').forEach(b=>b.addEventListener('click',async()=>{
    if(!confirm('Supprimer définitivement cette recette archivée ?'))return;
    try{await fetch('/addons/recettes/api/recipe/trash/purge',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({files:[b.dataset.rzdel]})});toast('Supprimée définitivement');}catch(e){}
    renderRecipeTrash();}));
}
function renderTrashSection(){
  const el=document.getElementById('tzBody');if(!el)return;
  const t=igTrash;
  if(!t){el.innerHTML='<div class="stub"><div class="t2">Addon Instagram non configuré (⚙ Instagram → dossier).</div></div>';return;}
  const all=[];
  t.profiles.forEach(p=>(p.files||[]).forEach(f=>all.push(Object.assign({profile:p.profile},f))));
  if(!all.length){el.innerHTML='<div class="stub"><div class="big">🗑️</div><div class="t2">Corbeille vide</div></div>';return;}
  const selMb=all.filter(f=>igTrashSel.has(f.profile+'/'+f.name)).reduce((s2,f)=>s2+f.size_mb,0);
  let h='<div class="igbar"><span class="igbtn2" id="tzAll">Tout sélectionner</span>'+
    '<span class="igbtn2" id="tzVid">🎬 Sélectionner les vidéos</span>'+
    '<span style="margin-left:auto;font-size:12px;color:var(--dim)">'+all.length+' fichier(s) · <b>'+t.size_mb+' Mo</b></span></div>';
  h+='<div style="max-height:300px;overflow:auto;margin-bottom:10px">'+all.map(f=>{
    const key=f.profile+'/'+f.name;const on=igTrashSel.has(key);
    return '<div class="igtf'+(on?' picked':'')+'" data-k="'+key+'">'+
      '<span class="box">'+(on?'✓':'')+'</span><span>'+(f.video?'🎬':'🖼️')+'</span>'+
      '<span class="nm">'+f.name+'</span>'+
      '<span class="sz">'+(f.size_mb>=1?f.size_mb+' Mo':Math.round(f.size_mb*1024)+' Ko')+'</span></div>';}).join('')+'</div>';
  h+='<div class="setrow"><div class="lft"><div class="t">'+igTrashSel.size+' sélectionné(s)</div>'+
     '<div class="d">'+selMb.toFixed(1)+' Mo seront libérés</div></div>'+
     '<button class="btnpill" id="tzRestore">↩ Restaurer</button>'+
     '<button class="btnpill" id="tzPurge" style="background:var(--bad);color:#fff;border:none;margin-left:8px">Supprimer définitivement</button></div>';
  el.innerHTML=h;
  el.querySelectorAll('[data-k]').forEach(x=>x.addEventListener('click',()=>{
    const k=x.dataset.k;
    if(igTrashSel.has(k))igTrashSel.delete(k);else igTrashSel.add(k);
    renderTrashSection();}));
  document.getElementById('tzAll').addEventListener('click',()=>{
    if(igTrashSel.size===all.length)igTrashSel.clear();
    else all.forEach(f=>igTrashSel.add(f.profile+'/'+f.name));
    renderTrashSection();});
  document.getElementById('tzVid').addEventListener('click',()=>{
    all.filter(f=>f.video).forEach(f=>igTrashSel.add(f.profile+'/'+f.name));
    renderTrashSection();});
  document.getElementById('tzRestore').addEventListener('click',async()=>{
    if(!confirm('Restaurer tous les médias de la corbeille ?'))return;
    for(const p of t.profiles){
      try{await fetch('/addons/instagram/api/trash/restore',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({profile:p.profile})});}catch(e){}
    }
    toast('Médias restaurés');secTrash();
  });
  document.getElementById('tzPurge').addEventListener('click',async()=>{
    const n=igTrashSel.size;
    if(!n){toast('Sélectionne au moins un fichier');return;}
    if(!confirm('Supprimer définitivement '+n+' fichier(s) ?\nLa place est libérée et ils ne reviendront pas.'))return;
    const byProf={};
    Array.from(igTrashSel).forEach(k=>{const i=k.indexOf('/');
      (byProf[k.slice(0,i)]=byProf[k.slice(0,i)]||[]).push(k.slice(i+1));});
    let freed=0,rem=0;
    for(const p of Object.keys(byProf)){
      try{const r=await fetch('/addons/instagram/api/trash/purge',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({profile:p,files:byProf[p]})});
        const j=await r.json();if(j.ok){freed+=j.freed_mb;rem+=j.removed;}}catch(e){}
    }
    toast(rem+' fichier(s) supprimé(s) · '+freed.toFixed(1)+' Mo libérés');
    secTrash();
  });
}
function secSon(){
  setcontent.innerHTML='<h4>Son</h4><div class="desc">Volume, amplification et sortie audio. Le son du kiosk (radio, minuteur) sort sur l\'appareil sélectionné.</div><div id="sonBody"><div class="stub"><div class="t2">Lecture de l\'état audio…</div></div></div>';
  loadSonView();
}
async function loadSonView(){
  const el=document.getElementById('sonBody');if(!el)return;
  let d=null;try{const r=await fetch('/api/system/audio');d=await r.json();}catch(e){d={ok:false};}
  if(!d||!d.ok){el.innerHTML='<div class="stub"><div class="t2">Contrôle audio indisponible sur cette machine.</div></div>';return;}
  const amp=(d.volume||0)>100;
  let h='';
  // Volume
  h+='<div class="setrow"><div class="lft"><div class="t">Volume</div><div class="d">Niveau de la sortie active</div></div>'+
     '<input type="range" min="0" max="'+(amp?150:100)+'" step="5" id="sonVol" value="'+(d.volume!=null?d.volume:50)+'" style="width:180px"></div>';
  // Amplification
  h+='<div class="setrow"><div class="lft"><div class="t">Amplification du son</div><div class="d">Autorise le volume au-delà de 100 % (jusqu\'à 150 %). Peut saturer selon l\'enceinte.</div></div><div class="sw'+(amp?' on':'')+'" id="sonAmp"></div></div>';
  // Sortie audio
  h+='<div class="setrow" style="align-items:flex-start"><div class="lft"><div class="t">Sortie audio</div><div class="d">Choisir le périphérique de lecture</div></div><div style="flex:1;max-width:260px">';
  if(d.sinks&&d.sinks.length){
    h+=d.sinks.map(s=>'<div class="syrow'+(s.default?' on':'')+'" style="cursor:pointer" data-sink="'+s.id+'">'+
      '<span style="font-size:17px">'+(s.default?'🔊':'🔈')+'</span>'+
      '<span><span class="syn">'+s.name+'</span>'+(s.default?'<span class="sysub">sortie active</span>':'')+'</span>'+
      '<span class="syact">'+(s.default?'<span class="sysub">✓</span>':'<span class="sybtn" data-sink-btn="'+s.id+'">Choisir</span>')+'</span></div>').join('');
  }else h+='<div class="sysub">Aucune sortie détectée</div>';
  h+='</div></div>';
  // Icône volume dans la barre
  h+='<div class="setrow"><div class="lft"><div class="t">Tester le son</div><div class="d">Joue un bip de test sur la sortie active — vérifie que l\'enceinte fonctionne</div></div><button class="btnpill" id="sonTest">▶ Tester</button></div>';
  h+='<div class="setrow"><div class="lft"><div class="t">Icône volume dans la barre</div><div class="d">Affiche un contrôle de volume rapide en haut, près du WiFi et du Bluetooth</div></div><div class="sw'+(state.volBar!==false?' on':'')+'" id="sonVolBar"></div></div>';
  h+='<div class="kotoast" id="sonErr"></div>';
  el.innerHTML=h;
  const err=document.getElementById('sonErr');
  const st=document.getElementById('sonTest');
  if(st)st.addEventListener('click',async()=>{
    st.textContent='♪ …';err.textContent='';
    try{
      // On joue le son DANS le navigateur (comme la Radio), pas via une
      // commande serveur : Chromium sort déjà sur la bonne sortie PipeWire.
      const ctx=new (window.AudioContext||window.webkitAudioContext)();
      const osc=ctx.createOscillator(),g=ctx.createGain();
      osc.type='sine';osc.frequency.value=440;
      g.gain.value=0.25;osc.connect(g);g.connect(ctx.destination);
      osc.start();
      // 2 s de son continu : laisse l'enceinte BT sortir de veille
      setTimeout(()=>{osc.stop();ctx.close();},2000);
      err.textContent='Bip de test en cours… Si tu n\'entends rien, vérifie le volume physique de l\'enceinte.';
    }catch(e){err.textContent='Lecture impossible : '+e.message;}
    setTimeout(()=>{st.textContent='▶ Tester';},2200);
  });
  const vbar=document.getElementById('sonVolBar');
  if(vbar)vbar.addEventListener('click',()=>{state.volBar=(state.volBar===false);vbar.classList.toggle('on',state.volBar!==false);save();
    updateVolBtn();toast(state.volBar!==false?'Icône volume affichée':'Icône volume masquée');});
  // Volume
  const vol=document.getElementById('sonVol');
  if(vol)vol.addEventListener('change',async()=>{
    try{const r=await fetch('/api/system/volume',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({value:parseInt(vol.value)})});
      const j=await r.json();if(!j.ok)err.textContent=j.reason||'échec';}catch(e){err.textContent='Serveur injoignable';}
  });
  // Amplification : autorise le volume > 100 %
  const amps=document.getElementById('sonAmp');
  if(amps)amps.addEventListener('click',async()=>{
    const on=!amps.classList.contains('on');
    amps.classList.toggle('on',on);
    if(vol)vol.max=on?150:100;
    if(!on&&vol&&parseInt(vol.value)>100){
      vol.value=100;
      try{await fetch('/api/system/volume',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({value:100})});}catch(e){}
    }
    toast(on?'Amplification activée (jusqu\'à 150 %)':'Amplification désactivée (max 100 %)');
  });
  // Sortie
  el.querySelectorAll('[data-sink-btn]').forEach(b=>b.addEventListener('click',async()=>{
    b.textContent='…';
    try{const r=await fetch('/api/system/audio/default',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:b.dataset.sinkBtn})});
      const j=await r.json();if(j.ok)loadSonView();else{err.textContent=j.reason||'échec';b.textContent='Choisir';}
    }catch(e){err.textContent='Serveur injoignable';b.textContent='Choisir';}
  }));
}
function secWifi(){
  setcontent.innerHTML='<h4>WiFi</h4><div class="desc">Réseaux détectés par NetworkManager sur la machine du kiosk.</div>'+'<div class="setrow"><div class="lft"><div class="t">Indicateur dans la barre</div><div class="d">Affiche l\'icône WiFi en haut à droite</div></div><div class="sw'+(state.wifiInd!==false?' on':'')+'" id="wifiIndSw"></div></div>'+
    '<div id="wfBody"></div>';
  loadWifiView({id:'wifi'});
}
function secBluetooth(){
  setcontent.innerHTML='<h4>Bluetooth</h4><div class="desc">Appareils appairés — l\'enceinte connectée reçoit le son du kiosk (radio, minuteur).</div>'+'<div class="setrow"><div class="lft"><div class="t">Indicateur dans la barre</div><div class="d">Affiche l\'icône Bluetooth en haut à droite</div></div><div class="sw'+(state.btInd!==false?' on':'')+'" id="btIndSw"></div></div>'+
    '<div id="btBody"></div>';
  loadBtView({id:'bluetooth'});
}
function secSys(){
  setcontent.innerHTML='<h4>Système</h4><div class="desc">Métriques réelles de la machine hôte (psutil) — rafraîchi toutes les 3 s.</div>'+
    '<div class="syscards">'+
    '<div class="card"><div class="lab">CPU</div><div class="val" id="cpuV">…</div><div class="bar"><i id="cpuB" style="width:0%"></i></div></div>'+
    '<div class="card"><div class="lab">RAM</div><div class="val" id="ramV">…</div><div class="bar"><i id="ramB" style="width:0%"></i></div></div>'+
    '<div class="card"><div class="lab">Disque</div><div class="val" id="diskV">…</div><div class="bar"><i id="diskB" style="width:0%"></i></div></div>'+
    '<div class="card"><div class="lab">Température</div><div class="val" id="tV">…</div><div class="bar"><i id="tB" style="width:0%"></i></div></div>'+
    '<div class="card wide"><div class="lab">Réseau</div><div class="kv"><span class="k">Hostname</span><span class="v" id="hostV">…</span></div><div class="kv"><span class="k">IP</span><span class="v" id="ipV">…</span></div></div>'+
    '<div class="card"><div class="lab">Uptime</div><div class="val" id="upV" style="font-size:18px">…</div></div>'+
    '<div class="card"><div class="lab">Version du kiosk</div><div class="val" id="verV" style="font-size:18px">…</div></div>'+
    '</div>';
  refreshSystem();
  startSysTimer();
}
let sysTimer=null;
function startSysTimer(){
  stopSysTimer();
  sysTimer=setInterval(()=>{
    if(!document.getElementById('cpuV')){stopSysTimer();return;}
    refreshSystem();
  },3000);
}
function stopSysTimer(){if(sysTimer){clearInterval(sysTimer);sysTimer=null;}}
async function refreshSystem(){
  try{
    const r=await fetch('/api/system');if(!r.ok)return;const d=await r.json();
    const set=(id,h)=>{const e=document.getElementById(id);if(e)e.innerHTML=h;};
    const setw=(id,pct,cls)=>{const e=document.getElementById(id);if(e){e.style.width=Math.max(0,Math.min(100,pct))+'%';e.className=cls||'';}};
    set('cpuV',d.cpu+'<small> %</small>');setw('cpuB',d.cpu,d.cpu>80?'b':(d.cpu>60?'w':''));
    set('ramV',(''+d.ram.used_gb).replace('.',',')+'<small> / '+d.ram.total_gb+' Go</small>');setw('ramB',d.ram.pct,d.ram.pct>85?'b':(d.ram.pct>70?'w':''));
    set('diskV',d.disk.used_gb+'<small> / '+d.disk.total_gb+' Go</small>');setw('diskB',d.disk.pct,d.disk.pct>85?'b':(d.disk.pct>70?'w':''));
    set('tV',(d.temp==null?'—':(''+d.temp).replace('.',','))+'<small> °C</small>');setw('tB',d.temp==null?0:d.temp,d.temp>70?'b':(d.temp>55?'w':''));
    set('hostV',d.hostname);set('ipV',d.ip);set('upV',d.uptime);set('verV',d.version||'—');
  }catch(e){}
}
function secVersion(){
  setcontent.innerHTML='<h4>Version</h4>'+
    '<div class="setrow"><div class="lft"><div class="t">Kiosk « '+KIOSK_NAME+' »</div>'+
    '<div class="d">Version <span id="verV">…</span> · SDK addons kiosk_api <span id="verApi">…</span></div></div></div>'+
    '<div class="setrow"><div class="lft"><div class="t">Mise à jour de Panda</div>'+
    '<div class="d" id="selfupdMsg">Vérification…</div></div>'+
    '<div style="display:flex;gap:9px;align-items:center">'+
    '<button class="btnpill install" id="selfupdBtn" style="display:none">⬆ Mettre à jour</button>'+
    '<button class="btnpill" id="selfupdCheck">⟳ Vérifier</button></div></div>'+
    '<div class="wsec" style="padding-left:0;margin-top:16px">Crédits</div>'+
    '<div class="credits">'+
    '<p><b>Panda</b> — kiosk domestique pour écran tactile, conçu par The Worm\'s.</p>'+
    '<p>Écrit en <b>Python / Flask</b> côté serveur, <b>JavaScript</b> sans framework côté écran. '+
    'Aucune donnée ne quitte le réseau local, hormis les appels aux services que tu configures.</p>'+
    '<p><b>Addons d\'origine (socle)</b> : <span id="verSocle">…</span>.</p>'+
    '<p><b>Données publiques du socle</b> : Open-Meteo (météo), Météo-France (vigilance), '+
    'radio-browser.info (radios), IMCCE / Observatoire de Paris (éphémérides).</p>'+
    '<p><b>Calculs locaux</b> : phases de lune, lever et coucher du soleil.</p>'+
    '<p style="color:var(--faint);margin-top:10px">Les applications installées depuis le store Abeille '+
    'portent leurs propres crédits, visibles sur leur fiche du Store.</p>'+
    '<p style="color:var(--faint);margin-top:10px">Un projet <b>The Worm\'s</b>.</p>'+
    '</div>';
  fetch('/healthz').then(r=>r.json()).then(j=>{
    const v=document.getElementById('verV');if(v)v.textContent=j.version||'?';
    const k=document.getElementById('verApi');if(k)k.textContent=j.kiosk_api||'1.3';}).catch(()=>{});
  fetch('/api/registry').then(r=>r.json()).then(j=>{
    const el=document.getElementById('verSocle');if(!el)return;
    const socle=(j.tiles||[]).filter(t=>t.source!=='store'&&t.type!=='internal').map(t=>t.nm||t.id);
    el.textContent=socle.length?Array.from(new Set(socle)).sort((a,b)=>a.localeCompare(b,'fr')).join(', '):'—';}).catch(()=>{});
  const _updMsg=document.getElementById('selfupdMsg'),_updBtn=document.getElementById('selfupdBtn'),_updChk=document.getElementById('selfupdCheck');
  let _updCur='',_updLat='';   // versions courante/cible, pour l'overlay au lancement
  async function selfupdCheck(){
    if(_updMsg){_updMsg.textContent='Vérification…';_updMsg.style.color='';}
    if(_updBtn)_updBtn.style.display='none';
    try{
      const r=await fetch('/api/system/selfupdate');const d=await r.json();
      if(!_updMsg)return;
      if(!d.ok){_updMsg.textContent='⚠ '+(d.reason||'vérification impossible');_updMsg.style.color='var(--warn)';return;}
      if(d.update){
        _updCur=d.current||'';_updLat=d.latest||'';
        _updMsg.innerHTML='<span class="adbadge maj" style="margin-left:0">⬆ MISE À JOUR</span> v'+d.current+' → <b>v'+d.latest+'</b>'+(d.updater_ready?'':' · <span style="color:var(--warn)">outil panda-update absent sur la machine</span>');
        if(_updBtn&&d.updater_ready)_updBtn.style.display='';
      }else{
        _updMsg.textContent='✓ Panda est à jour (v'+d.current+')';_updMsg.style.color='var(--green)';
      }
    }catch(e){if(_updMsg){_updMsg.textContent='⚠ vérification impossible';_updMsg.style.color='var(--warn)';}}
  }
  if(_updChk)_updChk.addEventListener('click',selfupdCheck);
  if(_updBtn)_updBtn.addEventListener('click',async()=>{
    if(!confirm('Mettre à jour Panda maintenant ? Le kiosk va redémarrer.'))return;
    _updBtn.disabled=true;_updBtn.textContent='Mise à jour…';
    try{
      const r=await fetch('/api/system/selfupdate',{method:'POST'});const d=await r.json();
      if(d.ok){
        // Overlay plein écran (indépendant de cette section) : il prend le
        // relais du suivi /healthz et distingue succès / rollback / pas-de-retour.
        startUpdateOverlay(_updCur, _updLat);
      }else{if(_updMsg){_updMsg.textContent='✗ '+(d.reason||'échec');_updMsg.style.color='var(--bad)';}_updBtn.disabled=false;_updBtn.textContent='⬆ Mettre à jour';}
    }catch(e){if(_updMsg){_updMsg.textContent='✗ échec du lancement';_updMsg.style.color='var(--bad)';}_updBtn.disabled=false;_updBtn.textContent='⬆ Mettre à jour';}
  });
  selfupdCheck();
}
function secApps(){
  const tabs=[["myapps","Mes applications",state.installed.length],["store","Store",""]];
  const cats=[["all","Toutes"]].concat(APP_CATS.map(c=>[c,c]));
  let h='<h4>Applications</h4>'+
    '<div class="apptabs">'+tabs.map(([k,l,c])=>'<button class="apptab'+(appTab===k?' on':'')+'" data-t="'+k+'">'+l+(k==='store'?'<span class="chipbadge" id="storeChipBadge" style="display:none"></span>':(c!==''?'<span class="cnt">'+c+'</span>':''))+'</button>').join('')+'</div>'+
    '<div class="appbar"><input id="appSearch" class="inp" placeholder="Rechercher…" value="'+appQuery.replace(/"/g,'&quot;')+'">'+
      '<select id="appSort" class="inp appsort"></select>'+
      '<div class="vtoggle" id="appVtoggle"><button data-m="list"'+(appView==='list'?' class="on"':'')+'>\u2630</button><button data-m="cards"'+(appView==='cards'?' class="on"':'')+'>\u25A6</button></div>'+
    '</div>'+
    '<div class="chips" id="appCats">'+cats.map(([k,l])=>'<div class="chip'+(appCatFilter===k?' on':'')+'" data-c="'+k+'">'+l+'</div>').join('')+'</div>'+
    '<div class="storehead" id="storehead" style="display:none"></div>'+
    '<div id="applist"></div>';
  setcontent.innerHTML=h;
  buildAppSort();
  document.getElementById('appSearch').addEventListener('input',e=>{appQuery=e.target.value;renderAppList();});
  document.getElementById('appSort').addEventListener('change',e=>{appSortKey=e.target.value;renderAppList();});
  setcontent.querySelectorAll('.apptab').forEach(t=>t.addEventListener('click',()=>{if(appTab!==t.dataset.t){appTab=t.dataset.t;appSortKey='default';secApps();}}));
  setcontent.querySelectorAll('#appCats .chip').forEach(c=>c.addEventListener('click',()=>{appCatFilter=c.dataset.c;setcontent.querySelectorAll('#appCats .chip').forEach(x=>x.classList.toggle('on',x.dataset.c===appCatFilter));renderAppList();}));
  setcontent.querySelectorAll('#appVtoggle button').forEach(b=>b.addEventListener('click',()=>{appView=b.dataset.m;setcontent.querySelectorAll('#appVtoggle button').forEach(x=>x.classList.toggle('on',x===b));renderAppList();}));
  const sh0=document.getElementById('storehead');if(sh0)sh0.style.display=appTab==='store'?'flex':'none';
  updateStoreBadges();
  prefetchStoreCats();     // alimente STORE_CAT pour catégoriser les installés du store
  renderAppList();
}
function buildAppSort(){
  const sel=document.getElementById('appSort');if(!sel)return;
  const opts=appTab==='store'
    ?[["default","Tri : à la une"],["name","Tri : nom"],["cat","Tri : catégorie"]]
    :[["default","Tri : ordre d'accueil"],["name","Tri : nom"],["cat","Tri : catégorie"]];
  sel.innerHTML=opts.map(([k,l])=>'<option value="'+k+'"'+(appSortKey===k?' selected':'')+'>'+l+'</option>').join('');
}
function prefetchStoreCats(){
  if(Object.keys(STORE_CAT).length)return;
  fetch('/api/store/index',{cache:'no-store'}).then(r=>r.json()).then(d=>{
    if(d&&d.addons){d.addons.forEach(a=>{if(a.category)STORE_CAT[a.id]=a.category;});if(appTab==='myapps')renderAppList();}
  }).catch(()=>{});
}
function catOfApp(a){return a.category||STORE_CAT[a.id]||'';}
function appActs(a,shown,host){
  const sw=document.createElement('div');sw.className='sw'+(shown?' on':'');sw.title="Afficher sur l'accueil";
  sw.addEventListener('click',e=>{e.stopPropagation();if(state.hidden.includes(a.id))state.hidden=state.hidden.filter(x=>x!==a.id);else state.hidden.push(a.id);save();renderHome();renderAppList();});
  host.appendChild(sw);
}
function renderAppList(){
  const box=document.getElementById('applist');if(!box)return;
  if(appTab==='store'){box.className=appView==='cards'?'appgrid':'applist';renderStoreList(box);return;}
  box.className=appView==='cards'?'appgrid':'applist';
  renderMyApps(box);
}
function renderMyApps(box){
  const q=appQuery.trim().toLowerCase();
  let list=ADDONS.filter(a=>state.installed.includes(a.id))
    .filter(a=>appCatFilter==='all'||catOfApp(a)===appCatFilter)
    .filter(a=>!q||((a.nm+' '+(a.src||'')).toLowerCase().includes(q)));
  list.sort((x,y)=>{
    if(appSortKey==='name')return dnm(x).localeCompare(dnm(y),'fr');
    if(appSortKey==='cat')return (catOfApp(x)||'\uffff').localeCompare(catOfApp(y)||'\uffff','fr')||dnm(x).localeCompare(dnm(y),'fr');
    const ox=state.order.indexOf(x.id),oy=state.order.indexOf(y.id);
    return (ox<0?1e9:ox)-(oy<0?1e9:oy);
  });
  box.innerHTML='';
  if(!list.length){box.innerHTML='<div class="cmeta" style="padding:24px;text-align:center;color:var(--faint)">Aucune application ne correspond.</div>';return;}
  list.forEach(a=>{
    const shown=!state.hidden.includes(a.id);
    const meta=(catOfApp(a)||'—')+(a.src?(' · '+a.src):'');
    let el,acts;
    if(appView==='cards'){
      el=document.createElement('div');el.className='appcard';
      el.innerHTML='<div class="apptop"><div class="cic">'+tileIcon(a)+'</div><div class="ctt">'+dnm(a)+(a.update?' <span class="updbadge">MAJ</span>':'')+'</div></div>'+
        '<div class="cmeta">'+meta+'</div>';
      acts=document.createElement('div');acts.className='cacts';
    }else{
      el=document.createElement('div');el.className='approw';
      el.innerHTML='<div class="rico">'+tileIcon(a)+'</div>'+
        '<div class="rtx"><div class="rnm">'+dnm(a)+(a.update?' <span class="updbadge">MAJ</span>':'')+'</div><div class="rmeta">'+meta+'</div></div>';
      acts=document.createElement('div');acts.className='racts';
    }
    appActs(a,shown,acts);
    el.appendChild(acts);
    el.addEventListener('click',()=>openCfg(a));
    box.appendChild(el);
  });
}

/* ===== Store Abeille : catalogue distant (install/MAJ/désinstall) ===== */
let storeUpd={maj:0,nouveaux:0,total:0};
let storeTimer=null;
async function renderStoreList(box){
  const q=appQuery.trim().toLowerCase();
  box.innerHTML='<div class="cmeta" style="grid-column:1/-1;padding:20px;text-align:center">Lecture du store…</div>';
  let d=null,err=null;
  try{const r=await fetch('/api/store/index',{cache:'no-store'});d=await r.json();if(!d.ok)err=d.reason||'store injoignable';}
  catch(e){err='store injoignable';}
  if(appTab!=='store')return;                  // l'utilisateur a changé d'onglet entre-temps
  if(d&&d.addons)d.addons.forEach(a=>{if(a.category)STORE_CAT[a.id]=a.category;});
  // en-tête : bouton rafraîchir + date de l'index
  const head=document.getElementById('storehead');
  if(head){
    const dt=(d&&d.updated)?new Date(d.updated).toLocaleString('fr-FR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):'—';
    const nMaj=(d&&d.addons?d.addons.filter(a=>a.status==='maj').length:0);
    head.innerHTML='<div class="cmeta" style="margin:0">Index : '+dt+'</div>'+
      (nMaj>=2?'<button class="btnpill install" id="storeMajAll">⟳ Tout mettre à jour ('+nMaj+')</button>':'')+
      '<button class="btnpill" id="storeRefresh">⟳ Rafraîchir</button>';
    head.querySelector('#storeRefresh').addEventListener('click',()=>{checkStoreUpdates(true);renderAppList();});
    const smaj=head.querySelector('#storeMajAll');
    if(smaj)smaj.addEventListener('click',storeUpdateAll);
  }
  if(err){box.innerHTML='<div class="cmeta" style="grid-column:1/-1;padding:24px;text-align:center;color:var(--bad)">⚠ '+err+'</div>';return;}
  // profiter de ce fetch pour rafraîchir le badge sans second appel
  storeUpd={maj:(d.addons||[]).filter(a=>a.status==='maj').length,nouveaux:(d.addons||[]).filter(a=>a.status==='disponible').length,total:0};
  storeUpd.total=storeUpd.maj+storeUpd.nouveaux;updateStoreBadges();
  let items=(d.addons||[]).filter(a=>appCatFilter==='all'||(a.category||'')===appCatFilter)
    .filter(a=>!q||((a.name+' '+(a.description||'')).toLowerCase().includes(q)));
  const W={maj:0,disponible:1,installe:2,incompatible:3};
  items.sort((x,y)=>{
    if(appSortKey==='name')return (x.name||x.id).localeCompare(y.name||y.id,'fr');
    if(appSortKey==='cat')return (x.category||'\uffff').localeCompare(y.category||'\uffff','fr')||(x.name||'').localeCompare(y.name||'','fr');
    return ((W[x.status]|0)-(W[y.status]|0))||(x.name||'').localeCompare(y.name||'','fr');
  });
  box.innerHTML='';
  if(!items.length){box.innerHTML='<div class="cmeta" style="grid-column:1/-1;padding:24px;text-align:center">Aucun addon ne correspond.</div>';return;}
  // Rendu groupé par sections. L'ordre des sections traduit la priorité de lecture.
  const SECTIONS=[
    {key:'maj',        label:'\u2b06\ufe0f  \u00c0 mettre \u00e0 jour', match:a=>a.status==='maj'},
    {key:'disponible', label:'\u2728  Nouveaux',                        match:a=>a.status==='disponible'},
    {key:'installe',   label:'\u2713  Install\u00e9s',                  match:a=>a.status==='installe'},
    {key:'incompatible',label:'\u26a0\ufe0f  Incompatibles',           match:a=>a.status==='incompatible'},
  ];
  // Quand un tri explicite est choisi (nom/catégorie), on n'impose pas les sections.
  const grouped=(appSortKey!=='name'&&appSortKey!=='cat');
  if(grouped){
    let any=false;
    SECTIONS.forEach(sec=>{
      const sub=items.filter(sec.match);
      if(!sub.length)return;
      any=true;
      const hd=document.createElement('div');
      hd.className='storesec';
      hd.style.cssText='grid-column:1/-1';
      hd.innerHTML='<span>'+sec.label+'</span><span class="scnt">'+sub.length+'</span>';
      box.appendChild(hd);
      sub.forEach(a=>box.appendChild(storeItemNode(a)));
    });
    if(!any)box.innerHTML='<div class="cmeta" style="grid-column:1/-1;padding:24px;text-align:center">Aucun addon ne correspond.</div>';
  }else{
    items.forEach(a=>box.appendChild(storeItemNode(a)));
  }
}
/* Construit la carte/ligne d'un addon du store (réutilisé par section). */
function storeItemNode(a){
  const by=BYID[a.id];
  const kb=(a.size?(Math.round(a.size/102.4)/10+' Ko'):'');
  const icoName=a.icon||(by?by.ic:'📦'), icoCol=a.color||(by?(by.cc||by.color):'#f0b429');
  const _logo=a.logo||(by?by.logo:'');
  const _ico=_logo?('<img class="tilogo" src="/addons/'+encodeURIComponent(a.addon||a.id)+'/ui/'+encodeURIComponent(_logo)+'?v='+encodeURIComponent(a.version||(by?by.ver:'')||'0')+'" alt="" onerror="this.replaceWith(document.createRange().createContextualFragment(this.getAttribute(\'data-fb\')||\'\'))" data-fb="'+ic(icoName,icoCol).replace(/"/g,'&quot;')+'">'):ic(icoName,icoCol);
  const dim=(a.status==='installe'||a.status==='incompatible')?' dimmed':'';
  let el,acts;
  if(appView==='cards'){
    el=document.createElement('div');el.className='appcard st-'+a.status+dim+(a.status==='incompatible'?' off':'');
    el.innerHTML='<div class="apptop"><div class="cic">'+_ico+'</div>'+
      '<div class="ctt">'+(a.name||a.id)+storeBadge(a)+'</div></div>'+
      '<div class="cmeta">v'+a.version+(kb?(' · '+kb):'')+(a.category?(' · '+a.category):'')+'</div>';
    acts=document.createElement('div');acts.className='cacts';
  }else{
    el=document.createElement('div');el.className='approw st-'+a.status+dim+(a.status==='incompatible'?' off':'');
    el.innerHTML='<div class="rico">'+_ico+'</div>'+
      '<div class="rtx"><div class="rnm">'+(a.name||a.id)+storeBadge(a)+'</div>'+
      '<div class="rmeta">v'+a.version+(kb?(' · '+kb):'')+(a.category?(' · '+a.category):'')+(a.description?(' · '+a.description):'')+'</div></div>';
    acts=document.createElement('div');acts.className='racts';
  }
  const an=storeActionNode(a);if(an)acts.appendChild(an);
  el.appendChild(acts);
  el.addEventListener('click',()=>openAddonDetail(a));
  return el;
}
function storeBadge(a){
  if(a.status==='maj')return ' <span class="updbadge">⬆ MISE À JOUR '+a.installed_version+' → '+a.version+'</span>';
  if(a.status==='installe')return ' <span class="instbadge">✓ à jour</span>';
  if(a.status==='incompatible')return ' <span class="warnbadge">incompatible</span>';
  if(a.status==='disponible')return ' <span class="newbadge">✨ NOUVEAU</span>';
  return '';
}
function detailBadge(a){
  if(a.status==='maj')return ' <span class="adbadge maj">⬆ MISE À JOUR</span>';
  if(a.status==='disponible')return ' <span class="adbadge new">✨ NOUVEAU</span>';
  if(a.status==='installe')return ' <span class="adbadge inst">✓ à jour</span>';
  if(a.status==='incompatible')return ' <span class="adbadge inc">⚠ incompatible</span>';
  return '';
}
function storeActionNode(a){
  if(a.status==='incompatible'){const n=document.createElement('div');n.className='cmeta';n.textContent='kiosk_api '+a.kiosk_api;return n;}
  if(a.status==='installe'&&a.source==='store'){const b=document.createElement('button');b.className='btnpill';b.textContent='Désinstaller';b.addEventListener('click',e=>{e.stopPropagation();storeUninstall(a);});return b;}
  if(a.status==='installe'&&a.source==='socle'){const n=document.createElement('div');n.className='cmeta';n.textContent='fourni avec Panda';return n;}
  if(a.status==='disponible'||a.status==='maj'){const b=document.createElement('button');b.className='btnpill install';b.textContent=a.status==='maj'?'Mettre à jour':'Installer';b.addEventListener('click',e=>{e.stopPropagation();storeInstall(a);});return b;}
  return null;
}
function openAddonDetail(a){
  const esc=s=>(s||'').replace(/[&<>]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[m]));
  const by=BYID[a.id];
  const kb=(a.size?(Math.round(a.size/102.4)/10+' Ko'):'—');
  const icoName=a.icon||(by?by.ic:'📦'), icoCol=a.color||(by?(by.cc||by.color):'#f0b429');
  const _dlogo=a.logo||(by?by.logo:'');
  const _dico=_dlogo?('<img class="tilogo" src="/addons/'+encodeURIComponent(a.addon||a.id)+'/ui/'+encodeURIComponent(_dlogo)+'?v='+encodeURIComponent(a.version||(by?by.ver:'')||'0')+'" alt="" onerror="this.replaceWith(document.createRange().createContextualFragment(this.getAttribute(\'data-fb\')||\'\'))" data-fb="'+ic(icoName,icoCol).replace(/"/g,'&quot;')+'">'):ic(icoName,icoCol);
  const sub=a.status==='installe'?('Installé · source '+(a.source||'store'))
    :a.status==='incompatible'?'Non compatible avec ce Panda'
    :a.status==='maj'?('Mise à jour disponible · v'+a.installed_version+' → v'+a.version)
    :"Disponible à l'installation";
  const deps=(a.requires&&a.requires.length)?a.requires.map(id=>{
    const b=BYID[id];const nm=b?dnm(b):id;const icn=b?b.ic:'🧩';const icc=b?(b.cc||b.color):'#8a94a0';
    return '<span class="adDep"><span class="di">'+ic(icn,icc)+'</span>'+nm+'</span>';
  }).join(''):'<span class="cmeta">Aucune</span>';
  const ov=document.createElement('div');ov.className='adOverlay';
  ov.innerHTML='<div class="adTop"><button class="adBack">‹ Retour</button>'+
      '<span class="cmeta">'+(a.category?esc(a.category)+' · ':'')+'Store</span></div>'+
    '<div class="adBody">'+
      '<div class="adHead"><div class="adIco">'+_dico+'</div>'+
        '<div class="adHtx"><div class="adCat">'+esc(a.category||'—')+'</div>'+
          '<div class="adNm">'+esc(a.name||a.id)+detailBadge(a)+'</div><div class="adSub">'+sub+'</div></div>'+
        '<div class="adCta" id="adCta"></div></div>'+
      (a.description?'<div class="adDesc">'+esc(a.description)+'</div>':'')+
      '<div class="adGrid">'+
        '<div class="adCell"><div class="k">Version</div><div class="v">v'+esc(a.version)+'</div></div>'+
        '<div class="adCell"><div class="k">Taille</div><div class="v">'+kb+'</div></div>'+
        '<div class="adCell"><div class="k">Contrat</div><div class="v">'+esc(a.kiosk_api||'—')+'</div></div>'+
        '<div class="adCell"><div class="k">Source</div><div class="v">'+esc(a.source||'Abeille')+'</div></div>'+
      '</div>'+
      '<div class="adSec">Dépendances</div><div>'+deps+'</div>'+
      (a.changelog?'<div class="adSec">Nouveautés v'+esc(a.version)+'</div><div class="stchlog"><pre>'+esc(a.changelog)+'</pre></div>':'')+
    '</div>';
  document.body.appendChild(ov);
  ov.querySelector('.adBack').addEventListener('click',()=>ov.remove());
  const cta=storeActionNode(a);if(cta)ov.querySelector('#adCta').appendChild(cta);
}
/* Compteur de MAJ/nouveaux pour le badge (léger, sans télécharger de paquet). */
async function checkStoreUpdates(silent){
  try{
    const r=await fetch('/api/store/updates',{cache:'no-store'});
    const d=await r.json();
    if(d&&d.ok){storeUpd={maj:d.maj||0,nouveaux:d.nouveaux||0,total:d.total||0};}
  }catch(e){/* dépôt injoignable : on laisse le badge tel quel */}
  updateStoreBadges();
}
function updateStoreBadges(){
  const maj=storeUpd.maj||0;
  // Pastille MAJ : bouton admin de l'accueil (gear) + item « Applications » du menu.
  // Ne compte QUE les mises à jour (pas les nouveaux addons).
  const gearB=document.getElementById('gearBadge');
  if(gearB){gearB.textContent=maj||'';gearB.style.display=maj?'flex':'none';}
  const navApps=document.getElementById('navAppsBadge');
  if(navApps){navApps.textContent=maj||'';navApps.style.display=maj?'inline-flex':'none';}
  // La puce « Store » reste discrète : pas de compteur de nouveaux dessus
  // (les nouveaux se signalent par une pastille verte sur chaque fiche).
  const chip=document.getElementById('storeChipBadge');
  if(chip){chip.textContent=maj||'';chip.style.display=maj?'inline-flex':'none';}
}
function setupStoreTimer(){
  if(storeTimer){clearInterval(storeTimer);storeTimer=null;}
  const mode=state.storeCheck||'open';
  const every=mode==='hourly'?3600000:(mode==='daily'?86400000:0);
  if(every)storeTimer=setInterval(()=>checkStoreUpdates(true),every);
}
async function storeInstall(a){
  // 1er appel : peut renvoyer needs_deps (dépendances à confirmer) sans rien installer
  let probe=null;
  try{const r=await fetch('/api/store/install',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:a.id})});probe=await r.json();}
  catch(e){}
  let withDeps=false;
  if(probe&&probe.needs_deps&&probe.needs_deps.length){
    // demander confirmation d'installer aussi les dépendances requises
    const noms=(probe.dep_names&&probe.dep_names.length?probe.dep_names:probe.needs_deps).join(', ');
    const ok=await storeDepConfirm(a.name||a.id, noms);
    if(!ok)return;              // annulé : rien n'a été installé
    withDeps=true;
  }else if(probe&&probe.ok){
    // pas de dépendance : le 1er appel a déjà tout installé
    try{localStorage.setItem('panda-store-goto','installed');}catch(e){}
    const ov=storeBusy((a.status==='maj'?'Mise à jour':'Installation')+' de '+(a.name||a.id)+'…');
    await waitForRestart();location.reload();return;
  }else if(!probe||(!probe.ok&&!probe.needs_deps)){
    toast('⚠ '+((probe&&probe.reason)||'échec de l\'installation'));return;
  }
  // installation effective (chaîne complète si withDeps)
  const overlay=storeBusy((a.status==='maj'?'Mise à jour':'Installation')+' de '+(a.name||a.id)+'…');
  let d=null;
  try{const r=await fetch('/api/store/install',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:a.id,with_deps:withDeps})});d=await r.json();}
  catch(e){}
  if(!d||!d.ok){overlay.remove();toast('⚠ '+((d&&d.reason)||'échec de l\'installation'));return;}
  try{localStorage.setItem('panda-store-goto','installed');}catch(e){}
  await waitForRestart();
  location.reload();
}
/* Confirmation « X requiert Y — installer les deux ? ». Résout true/false. */
function storeDepConfirm(name, deps){
  return new Promise(resolve=>{
    const o=document.createElement('div');o.className='stbusy';
    o.innerHTML='<div class="stbcard"><div class="stbmsg">Dépendance requise</div>'+
      '<div class="stbsub" style="margin:8px 0 14px">« '+name+' » nécessite : <b>'+deps+'</b>.<br>Installer '+
      (deps.indexOf(',')>=0?'ces addons':'cet addon')+' en même temps ?</div>'+
      '<div style="display:flex;gap:10px;justify-content:center">'+
      '<button class="btnpill" id="depNo">Annuler</button>'+
      '<button class="btnpill install" id="depYes">Installer</button></div></div>';
    document.body.appendChild(o);
    o.querySelector('#depNo').addEventListener('click',()=>{o.remove();resolve(false);});
    o.querySelector('#depYes').addEventListener('click',()=>{o.remove();resolve(true);});
  });
}
function storeUninstall(a){
  storeConfirm(a.name||a.id).then(res=>{
    if(!res.ok)return;
    const purge=res.purge;
    const doUninstall=async(cascade)=>{
      const overlay=storeBusy('Désinstallation de '+(a.name||a.id)+'…');
      let d=null;
      try{const r=await fetch('/api/store/uninstall',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:a.id,purge:purge,cascade:cascade})});d=await r.json();}
      catch(e){}
      // refus pour cause de dépendants : proposer la désinstallation en cascade
      if(d&&!d.ok&&d.dependents&&d.dependents.length){
        overlay.remove();
        const noms=(d.dependent_names&&d.dependent_names.length?d.dependent_names:d.dependents).join(', ');
        const tout=await storeCascadeConfirm(a.name||a.id, noms);
        if(tout)return doUninstall(true);   // relance en cascade
        return;                             // annulé : rien n'a été touché
      }
      if(!d||!d.ok){overlay.remove();toast('⚠ '+((d&&(d.message||d.reason))||'échec de la désinstallation'));return;}
      // après le redémarrage, revenir sur Applications
      try{localStorage.setItem('panda-store-goto','installed');}catch(e){}
      await waitForRestart();
      location.reload();
    };
    doUninstall(false);
  });
}
/* Refus de désinstallation : « X est requis par Y — tout désinstaller ? ». Résout true/false. */
function storeCascadeConfirm(name, deps){
  return new Promise(resolve=>{
    const o=document.createElement('div');o.className='stbusy';
    o.innerHTML='<div class="stbcard"><div class="stbmsg">Dépendances installées</div>'+
      '<div class="stbsub" style="margin:8px 0 14px">« '+name+' » est requis par : <b>'+deps+'</b>.<br>'+
      'Tout désinstaller (ces addons <u>et</u> '+name+') ?</div>'+
      '<div style="display:flex;gap:10px;justify-content:center">'+
      '<button class="btnpill" id="casNo">Annuler</button>'+
      '<button class="btnpill stdanger" id="casYes">Tout désinstaller</button></div></div>';
    document.body.appendChild(o);
    o.querySelector('#casNo').addEventListener('click',()=>{o.remove();resolve(false);});
    o.querySelector('#casYes').addEventListener('click',()=>{o.remove();resolve(true);});
  });
}
/* « Tout mettre à jour » : le serveur enchaîne les MAJ (signature + sha256
   par addon, dépendances d'abord) puis UN SEUL restart. Ici : lancement,
   voile avec compteur (poll du status), bilan bref, reload. */
async function storeUpdateAll(){
  let d=null;
  try{const r=await fetch('/api/store/update-all',{method:'POST'});d=await r.json();}catch(e){}
  if(!d||!d.ok){toast('\u26a0 '+((d&&d.reason)||'lancement impossible'));return;}
  if(!d.total){toast('Aucune mise \u00e0 jour disponible');return;}
  const ov=storeBusy('Mise \u00e0 jour 1 sur '+d.total+'\u2026');
  const msg=ov.querySelector('.stbmsg');
  let last=null;
  for(let i=0;i<600;i++){
    await new Promise(r=>setTimeout(r,800));
    let st=null;
    try{const r=await fetch('/api/store/update-all/status',{cache:'no-store'});st=await r.json();}
    catch(e){break;}                       // serveur injoignable = restart final en cours
    if(st&&st.total){last=st;
      if(st.running){if(msg)msg.textContent='Mise \u00e0 jour '+(st.i||1)+' sur '+st.total+(st.current?(' \u2014 '+st.current):'')+'\u2026';}
      else break;                          // bilan final \u00e9crit
    }
  }
  if(last&&last.errors&&last.errors.length){
    if(msg)msg.textContent=last.done+'/'+last.total+' mises \u00e0 jour \u2014 '+last.errors.length+' \u00e9chec(s)';
    await new Promise(r=>setTimeout(r,2500));
  }else if(last&&msg){msg.textContent=last.total+'/'+last.total+' mises \u00e0 jour \u2713';}
  try{localStorage.setItem('panda-store-goto','installed');}catch(e){}
  await waitForRestart();
  location.reload();
}
function storeBusy(msg){
  const o=document.createElement('div');o.className='stbusy';
  o.innerHTML='<div class="stbcard"><div class="stbspin"></div><div class="stbmsg">'+msg+'</div><div class="stbsub">Ne pas éteindre Panda.</div></div>';
  document.body.appendChild(o);return o;
}
function storeConfirm(name){
  return new Promise(resolve=>{
    const o=document.createElement('div');o.className='stbusy';
    o.innerHTML='<div class="stcard"><div class="sttitle">Désinstaller '+name+' ?</div>'+
      '<div class="stmsg">L\'addon et son cache seront supprimés de Panda.</div>'+
      '<label class="stchk"><input type="checkbox" id="stPurge"><span>Effacer aussi les configurations et données<br><small>Sinon, elles sont conservées pour une réinstallation ultérieure.</small></span></label>'+
      '<div class="stacts"><button class="btnpill" id="stCancel">Annuler</button><button class="btnpill stdanger" id="stOk">Désinstaller</button></div></div>';
    document.body.appendChild(o);
    const done=(ok)=>{const purge=o.querySelector('#stPurge').checked;o.remove();resolve({ok:ok,purge:purge});};
    o.querySelector('#stCancel').addEventListener('click',()=>done(false));
    o.querySelector('#stOk').addEventListener('click',()=>done(true));
    o.addEventListener('click',e=>{if(e.target===o)done(false);});
  });
}
async function waitForRestart(){
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  let downSeen=false;
  for(let i=0;i<40;i++){                 // ~ jusqu'à 60 s
    await sleep(1500);
    let ok=false;
    try{const r=await fetch('/healthz',{cache:'no-store'});ok=r.ok;}catch(e){ok=false;}
    if(!ok)downSeen=true;
    else if(downSeen)return true;         // tombé puis revenu = redémarrage terminé
    else if(i>=6)return true;             // jamais vu tomber : restart trop rapide, on recharge
  }
  return true;
}
function secReglages(){
  let h='<h4>Réglages</h4><div class="desc">Date &amp; heure, fuseau horaire et saisie.</div>';

  /* ---- date & heure ---- */
  h+='<div class="wsec" style="padding-left:0">Date &amp; heure</div>'+
    '<div class="setrow"><div class="lft"><div class="t">Réglage de l\'heure</div><div class="d">Automatique : synchronisée via le réseau (NTP). Manuel : réglage à la main. Le fuseau gère l\'heure d\'été.</div></div><select class="inp" id="timeMode" style="max-width:190px"><option value="auto"'+(state.ntp?' selected':'')+'>Automatique (NTP)</option><option value="manual"'+(!state.ntp?' selected':'')+'>Manuel</option></select></div>'+
    '<div class="setrow"><div class="lft"><div class="t">Synchronisation</div><div class="d" id="tsState">Vérification…</div></div><button class="btnpill" id="tsFix">↻ Resynchroniser</button></div>'+
    '<div class="setrow"><div class="lft"><div class="t">Fuseau horaire</div><div class="d">Appliqué via timedatectl</div></div><select class="inp" id="tzSel" style="max-width:240px"><option>Chargement…</option></select></div>'+
    '<div class="setrow"><div class="lft"><div class="t">Date</div><div class="d">'+(state.ntp?'Passe en mode Manuel pour régler':'Réglage manuel')+'</div></div><input type="date" class="inp" id="dateInp"'+(state.ntp?' disabled':'')+'></div>'+
    '<div class="setrow"><div class="lft"><div class="t">Heure</div><div class="d">Format 24 h · appliqué via timedatectl</div></div><input type="time" class="inp" id="timeInp"'+(state.ntp?' disabled':'')+'></div>';
  h+='<div class="wsec" style="padding-left:0;margin-top:16px">Affichage de l\'horloge</div>'+
    '<div class="setrow"><div class="lft"><div class="t">Format de l\'heure</div><div class="d">24 heures ou 12 heures (AM/PM)</div></div><select class="inp" id="clkFmt" style="max-width:160px"><option value="24h"'+((state.clockFmt||'24h')==='24h'?' selected':'')+'>24 h</option><option value="12h"'+(state.clockFmt==='12h'?' selected':'')+'>12 h (AM/PM)</option></select></div>'+
    '<div class="setrow"><div class="lft"><div class="t">Secondes</div><div class="d">Afficher les secondes dans l\'horloge</div></div><div class="sw'+(state.clockSec?' on':'')+'" id="clkSecSw"></div></div>'+
    '<div class="setrow"><div class="lft"><div class="t">Format de la date</div><div class="d">Longue (lundi 13 juillet), courte (13/07/2026) ou masquée</div></div><select class="inp" id="dateFmt" style="max-width:160px"><option value="long"'+((state.dateFmt||'long')==='long'?' selected':'')+'>Longue</option><option value="short"'+(state.dateFmt==='short'?' selected':'')+'>Courte</option><option value="hidden"'+(state.dateFmt==='hidden'?' selected':'')+'>Masquée</option></select></div>';

  /* ---- clavier & langue ---- */
  h+='<div class="wsec" style="padding-left:0;margin-top:16px">Saisie</div>'+
    '<div class="setrow"><div class="lft"><div class="t">Clavier virtuel</div><div class="d">Affiche un clavier à l\'écran (indispensable sans clavier physique)</div></div><div class="sw'+(state.vkb!==false?' on':'')+'" id="vkbSw"></div></div>'+
    '<div class="setrow"><div class="lft"><div class="t">Langue</div><div class="d">Interface et navigateur</div></div><select class="inp" id="langSel"><option value="fr-FR"'+((state.lang||'fr-FR')==='fr-FR'?' selected':'')+'>Français</option><option value="en-US"'+(state.lang==='en-US'?' selected':'')+'>English</option><option value="es-ES"'+(state.lang==='es-ES'?' selected':'')+'>Español</option><option value="de-DE"'+(state.lang==='de-DE'?' selected':'')+'>Deutsch</option><option value="it-IT"'+(state.lang==='it-IT'?' selected':'')+'>Italiano</option></select></div>'+
    '<div class="wsec" style="padding-left:0;margin-top:16px">Navigateur</div>'+
    '<div class="setrow"><div class="lft"><div class="t">Mémoriser les mots de passe</div><div class="d">Conserve les identifiants saisis dans le navigateur. Sans trousseau système, le chiffrement est faible (lisible par qui accède au fichier sur Panda) — à éviter pour des comptes sensibles. Prend effet à la prochaine ouverture du navigateur.</div></div><div class="sw'+(state.browserPw===true?' on':'')+'" id="browserPwSw"></div></div>'+
    '<div class="wsec" style="padding-left:0;margin-top:16px">Store</div>'+
    '<div class="setrow"><div class="lft"><div class="t">Source du store</div><div class="d">« Officiel » : le dépôt Abeille signé — URL et clé de vérification intégrées, rien à configurer. « Perso » : votre propre dépôt — URL, jeton éventuel et clé publique de signature (obligatoire : un store non signé est refusé).</div></div><div style="display:flex;flex-direction:column;gap:7px;max-width:340px;width:100%"><select class="inp" id="storeModeSel"><option value="officiel"'+((state.storeMode||'officiel')!=='perso'?' selected':'')+'>Officiel — Abeille (signé)</option><option value="perso"'+(state.storeMode==='perso'?' selected':'')+'>Perso — mon dépôt</option></select><div id="storePersoBox" style="display:'+(state.storeMode==='perso'?'flex':'none')+';flex-direction:column;gap:7px"><input class="inp" id="storeUrlInp" placeholder="https://mon-depot.example.com/abeille/" value="'+((state.storeUrl||'').replace(/"/g,'&quot;'))+'"><input class="inp" id="storeTokInp" type="password" placeholder="Jeton d\'accès (si dépôt protégé)" value="'+((state.storeToken||'').replace(/"/g,'&quot;'))+'"><input class="inp" id="storeKeyInp" spellcheck="false" placeholder="Clé publique Ed25519 (base64, 44 caractères)" value="'+((state.storePubkey||'').replace(/"/g,'&quot;'))+'"><span id="storeKeyRes" style="font-size:12px;color:var(--dim)"></span><button class="btnpill" id="storeBackOff" type="button">↩ Revenir au store officiel</button></div><div style="display:flex;gap:9px;align-items:center"><button class="btnpill" id="storeUrlTest" type="button">Tester</button><span id="storeUrlRes" style="font-size:12px;color:var(--dim)"></span></div></div></div>'+
    '<div class="setrow"><div class="lft"><div class="t">Vérifier les mises à jour</div><div class="d">Fréquence à laquelle Panda interroge Abeille pour de nouveaux addons ou versions. Un badge apparaît sur « Applications » quand il y en a. Le bouton ⟳ dans l\'onglet Store force une vérification à tout moment.</div></div><select class="inp" id="storeChkSel" style="max-width:200px"><option value="manual"'+((state.storeCheck||'open')==='manual'?' selected':'')+'>Manuel uniquement</option><option value="open"'+((state.storeCheck||'open')==='open'?' selected':'')+'>À l\'ouverture de l\'admin</option><option value="hourly"'+(state.storeCheck==='hourly'?' selected':'')+'>Toutes les heures</option><option value="daily"'+(state.storeCheck==='daily'?' selected':'')+'>Une fois par jour</option></select></div>'+
    '';
  if((state.installed||[]).some(x=>['instagram','recettes'].includes(x)))
    h+='<div class="wsec" style="padding-left:0;margin-top:16px">Suppression</div>'+
       '<div class="setrow"><div class="lft"><div class="t">🗑️ Mode suppression</div>'+
       '<div class="d">Affiche les corbeilles sur les recettes et les médias Instagram</div></div>'+
       '<div class="sw'+(state.delMode?' on':'')+'" id="swDel"></div></div>';

  setcontent.innerHTML=h;

  /* --- câblage date & heure --- */
  const post=async(u,b)=>{try{const r=await fetch(u,{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify(b)});return await r.json();}catch(e){return {ok:false,reason:'serveur injoignable'};}};
  const now=new Date();
  const di=document.getElementById('dateInp'),ti=document.getElementById('timeInp');
  if(di)di.value=now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0')+'-'+String(now.getDate()).padStart(2,'0');
  if(ti)ti.value=now.toTimeString().slice(0,5);

  const tm=document.getElementById('timeMode');
  if(tm)tm.addEventListener('change',async()=>{
    const on=tm.value==='auto';
    const j=await post('/api/system/ntp',{enabled:on});
    if(j.ok){state.ntp=on;save();toast(on?'Heure automatique (NTP)':'Réglage manuel activé');secReglages();}
    else{toast('Impossible — '+(j.reason||''));tm.value=state.ntp?'auto':'manual';}});
  (function(){const st=document.getElementById('tsState'),fx=document.getElementById('tsFix');
    if(!st)return;
    const refresh=()=>fetch('/api/system/timesync').then(r=>r.json()).then(j=>{
      if(!j.ok){st.textContent='État indisponible';return;}
      st.textContent=(j.ntp?'NTP actif':'NTP désactivé')+' · heure '+(j.synced?'synchronisée ✓':'NON synchronisée ⚠');
      /* bouton toujours visible : resynchro à la demande */}).catch(()=>{st.textContent='État indisponible';});
    if(fx)fx.addEventListener('click',async()=>{fx.disabled=true;
      try{const r=await fetch('/api/system/timesync',{method:'POST'});const j=await r.json();
        toast(j.ok?'Synchronisation NTP réactivée':'Impossible — '+(j.reason||''));}catch(e){toast('Serveur injoignable');}
      fx.disabled=false;state.ntp=true;save();setTimeout(refresh,1500);});
    refresh();})();
  const applique=async()=>{
    if(!di.value||!ti.value)return;
    const j=await post('/api/system/time',{date:di.value,time:ti.value});
    if(j.ok){state.ntp=false;save();toast('Heure système réglée');}
    else toast('Impossible — '+(j.reason||''));};
  if(di)di.addEventListener('change',applique);
  const cf=document.getElementById('clkFmt');if(cf)cf.addEventListener('change',()=>{state.clockFmt=cf.value;save();tick();});
  const csw2=document.getElementById('clkSecSw');if(csw2)csw2.addEventListener('click',()=>{state.clockSec=!state.clockSec;csw2.classList.toggle('on',state.clockSec);save();tick();});
  const dfl=document.getElementById('dateFmt');if(dfl)dfl.addEventListener('change',()=>{state.dateFmt=dfl.value;save();tick();});
  if(ti)ti.addEventListener('change',applique);
  const tzSel=document.getElementById('tzSel');
  (async()=>{
    let cur='';
    try{const r=await fetch('/api/system/display');const d=await r.json();
      cur=d.timezone||'';
      if(d.ntp!=null&&d.ntp!==state.ntp){state.ntp=!!d.ntp;save();secReglages();return;}
    }catch(e){}
    try{
      const r=await fetch('/api/system/timezones');const d=await r.json();
      if(!d.ok||!(d.timezones||[]).length){tzSel.innerHTML='<option>indisponible</option>';tzSel.disabled=true;return;}
      tzSel.innerHTML=d.timezones.map(z=>'<option value="'+z+'"'+(z===cur?' selected':'')+'>'+z+'</option>').join('');
      tzSel.disabled=false;
      tzSel.addEventListener('change',async()=>{
        const j=await post('/api/system/timezone',{value:tzSel.value});
        toast(j.ok?('Fuseau : '+j.timezone):('Impossible — '+(j.reason||'')));});
    }catch(e){tzSel.innerHTML='<option>indisponible</option>';tzSel.disabled=true;}
  })();
  const vk=document.getElementById('vkbSw');
  if(vk)vk.addEventListener('click',()=>{state.vkb=(state.vkb===false);vk.classList.toggle('on',state.vkb!==false);save();
    toast(state.vkb!==false?'Clavier virtuel activé':'Clavier virtuel désactivé');});
  const bpw=document.getElementById('browserPwSw');
  if(bpw)bpw.addEventListener('click',()=>{state.browserPw=(state.browserPw!==true);bpw.classList.toggle('on',state.browserPw===true);save();
    toast(state.browserPw?'Mots de passe mémorisés — ferme puis rouvre le navigateur':'Mémorisation des mots de passe désactivée');});
  const swd=document.getElementById('swDel');
  if(swd)swd.addEventListener('click',()=>{state.delMode=!state.delMode;swd.classList.toggle('on',state.delMode);save();
    toast(state.delMode?'Mode suppression activé':'Mode suppression désactivé');});
  const ls=document.getElementById('langSel');
  if(ls)ls.addEventListener('change',()=>{state.lang=ls.value;save();
    toast('Langue : '+ls.options[ls.selectedIndex].text);});
  const scs=document.getElementById('storeChkSel');
  if(scs)scs.addEventListener('change',()=>{state.storeCheck=scs.value;save();setupStoreTimer();
    if(scs.value!=='manual')checkStoreUpdates(true);
    toast('Vérification du store : '+scs.options[scs.selectedIndex].text);});
  const sui=document.getElementById('storeUrlInp');
  if(sui)sui.addEventListener('change',()=>{state.storeUrl=sui.value.trim();save();});
  const sti=document.getElementById('storeTokInp');
  if(sti)sti.addEventListener('change',()=>{state.storeToken=sti.value.trim();save();});
  const smsel=document.getElementById('storeModeSel');
  if(smsel)smsel.addEventListener('change',()=>{state.storeMode=smsel.value;save();const b=document.getElementById('storePersoBox');if(b)b.style.display=smsel.value==='perso'?'flex':'none';});
  const skey=document.getElementById('storeKeyInp');
  if(skey)skey.addEventListener('change',()=>{const v=skey.value.trim();const res=document.getElementById('storeKeyRes');let ok=false;try{ok=v.length===44&&atob(v).length===32;}catch(e){ok=false;}
    if(v&&!ok){if(res)res.textContent='Clé invalide : base64 de 32 octets attendu (44 caractères).';return;}
    if(res)res.textContent=v?'Clé valide \u2713':'';state.storePubkey=v;save();});
  const sboff=document.getElementById('storeBackOff');
  if(sboff)sboff.addEventListener('click',()=>{state.storeMode='officiel';save();const sel=document.getElementById('storeModeSel');if(sel)sel.value='officiel';const b=document.getElementById('storePersoBox');if(b)b.style.display='none';if(typeof toast==='function')toast('Store officiel Abeille r\u00e9tabli');});
  const sut=document.getElementById('storeUrlTest');
  if(sut)sut.addEventListener('click',async()=>{
    const res=document.getElementById('storeUrlRes');
    if(sui)state.storeUrl=sui.value.trim();
    if(sti)state.storeToken=sti.value.trim();
    res.textContent='Test…';res.style.color='var(--dim)';
    try{
      // persiste URL + jeton AVANT le test (le serveur lit la config sauvegardée)
      await fetch('/api/config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({storeUrl:state.storeUrl,storeToken:state.storeToken,font:state.font})});
      const r=await fetch('/api/store/index',{cache:'no-store'});const d=await r.json();
      if(d&&d.ok&&Array.isArray(d.addons)){res.textContent='✓ '+d.addons.length+' addon(s) au catalogue';res.style.color='var(--green)';updateStoreBadges();}
      else{res.textContent='✗ '+((d&&d.reason)||'dépôt injoignable');res.style.color='var(--bad)';}
    }catch(e){res.textContent='✗ dépôt injoignable';res.style.color='var(--bad)';}
  });
}
function moveCat(cats,i,dir){
  const j=i+dir;if(j<0||j>=cats.length)return;
  const arr=cats.slice();const t=arr[i];arr[i]=arr[j];arr[j]=t;
  // `cats` ne contient que les catégories visibles : on réinsère les autres
  // (masquées, déjà connues) pour ne pas les effacer de l'ordre enregistré.
  const rest=[];
  (state.catOrder||[]).forEach(c=>{if(!arr.includes(c)&&!rest.includes(c))rest.push(c);});
  (state.catHidden||[]).forEach(c=>{if(!arr.includes(c)&&!rest.includes(c))rest.push(c);});
  state.catOrder=arr.concat(rest);save();renderHome();secCategorie();
}
function secApparence(){
  let h='<h4>Apparence</h4><div class="desc">Thème, écran et disposition de l\'accueil. L\'ordre des tuiles est fixe.</div>'+
    '<div class="setrow"><div class="lft"><div class="t">Thème</div><div class="d">Clair ou sombre</div></div><div class="seg" id="segTheme"><button data-t="dark">Sombre</button><button data-t="light">Clair</button></div></div>'+
    '<div class="setrow"><div class="lft"><div class="t">Luminosité</div><div class="d">Assombrit l\'affichage (atténuation logicielle — cet écran HDMI n\'a pas de rétroéclairage pilotable)</div></div><input type="range" min="5" max="100" step="5" id="appLum" value="'+(state.brightness||100)+'" style="width:180px"></div>'+
    '<div class="setrow"><div class="lft"><div class="t">Police</div><div class="d">Police de toute l\'interface. « Atkinson » est conçue pour une lisibilité maximale ; essaie-la si le texte te paraît flou.</div></div><select class="inp" id="selFont" style="max-width:220px">'+Object.keys(UI_FONTS).map(k=>'<option value="'+k+'"'+((state.font||'system')===k?' selected':'')+'>'+UI_FONTS[k].label+'</option>').join('')+'</select></div>'+
    '<div class="setrow"><div class="lft"><div class="t">Recharger l\'interface</div><div class="d">Recharge l\'affichage — utile pour appliquer pleinement un changement de police, ou rafraîchir le kiosk sans le redémarrer.</div></div><button class="btnpill" id="btnReloadUI" type="button">Rafraîchir</button></div>'+
    '<div class="wsec" style="padding-left:0;margin-top:16px">Écran</div>'+
    '<div class="setrow"><div class="lft"><div class="t">Mise en veille écran</div><div class="d">Éteint l\'écran après une période d\'inactivité (un toucher rallume, sans rien déclencher)</div></div><select class="inp" id="veille">'+'<option value="0"'+(state.veille===0?' selected':'')+'>Jamais</option>'+'<option value="5"'+(state.veille===5?' selected':'')+'>5 min</option>'+'<option value="15"'+(state.veille===15?' selected':'')+'>15 min</option>'+'<option value="30"'+(state.veille===30?' selected':'')+'>30 min</option>'+'<option value="60"'+(state.veille===60?' selected':'')+'>1 h</option>'+'<option value="120"'+(state.veille===120?' selected':'')+'>2 h</option>'+'<option value="180"'+(state.veille===180?' selected':'')+'>3 h</option>'+'<option value="360"'+(state.veille===360?' selected':'')+'>6 h</option>'+'<option value="720"'+(state.veille===720?' selected':'')+'>12 h</option>'+'</select></div>'+
    '<div class="setrow"><div class="lft"><div class="t">Pendant la veille</div><div class="d">Écran éteint (économie maximale), ou horloge affichée — avec la météo du bandeau si disponible. Un toucher réveille.</div></div><select class="inp" id="veilleMode">'+'<option value="off"'+((state.veilleMode||'off')==='off'?' selected':'')+'>Écran éteint</option>'+'<option value="clock"'+(state.veilleMode==='clock'?' selected':'')+'>Horloge</option>'+'<option value="meteo"'+(state.veilleMode==='meteo'?' selected':'')+'>Horloge + météo</option>'+'</select></div>'+
    '<div class="setrow" id="veilleOffRow" style="'+(((state.veilleMode||'off')!=='off')?'':'display:none')+'"><div class="lft"><div class="t">Extinction totale après</div><div class="d">En mode horloge, éteint complètement la dalle après ce délai supplémentaire (économie maximale). Un toucher rallume.</div></div><select class="inp" id="veilleOff" style="max-width:160px">'+'<option value="0"'+((state.veilleOff||0)===0?' selected':'')+'>Jamais</option>'+'<option value="15"'+(state.veilleOff===15?' selected':'')+'>+ 15 min</option>'+'<option value="30"'+(state.veilleOff===30?' selected':'')+'>+ 30 min</option>'+'<option value="60"'+(state.veilleOff===60?' selected':'')+'>+ 1 h</option>'+'<option value="120"'+(state.veilleOff===120?' selected':'')+'>+ 2 h</option>'+'</select></div>'+
    '<div class="setrow"><div class="lft"><div class="t">Taille du texte</div><div class="d">Agrandir ou réduire l\'affichage</div></div><div class="seg" id="segFont"><button data-fs="92">A−</button><button data-fs="100">A</button><button data-fs="108">A+</button><button data-fs="116">A++</button></div></div>'+
    '<div class="setrow"><div class="lft"><div class="t">Rotation</div><div class="d">Orientation de l\'affichage</div></div><select class="inp" id="rotSel" style="max-width:150px"><option value="normal">Normale</option><option value="left">90° gauche</option><option value="right">90° droite</option><option value="inverted">180°</option></select></div>'+
    '<div class="wsec" style="padding-left:0;margin-top:16px">Accueil</div>'+
    '<div class="setrow"><div class="lft"><div class="t">Menu latéral</div><div class="d">Réaffiche le rail de catégories sur l\'accueil</div></div><div class="sw'+(state.railOn?' on':'')+'" id="railSw"></div></div>'+
    '<div class="setrow"><div class="lft"><div class="t">Affichage du menu</div><div class="d">Contenu des entrées du rail de catégories</div></div><select class="inp" id="railModeSel" style="max-width:200px"'+(state.railOn?'':' disabled')+'><option value="both"'+((state.railMode||'both')==='both'?' selected':'')+'>Icônes et textes</option><option value="icons"'+(state.railMode==='icons'?' selected':'')+'>Icônes seulement</option><option value="text"'+(state.railMode==='text'?' selected':'')+'>Textes seulement</option></select></div>';
  setcontent.innerHTML=h;

  /* --- thème --- */
  const seg=document.getElementById('segTheme');
  [...seg.children].forEach(b=>{if(b.dataset.t===state.theme)b.classList.add('on');
    b.addEventListener('click',()=>{state.theme=b.dataset.t;
      document.documentElement.setAttribute('data-theme',state.theme);
      try{localStorage.setItem('panda-theme',state.theme);}catch(e){}
      save();secApparence();});});

  const selF=document.getElementById('selFont');
  if(selF)selF.addEventListener('change',()=>{state.font=selF.value;applyFont();save();
    if(typeof toast==='function')toast('Police : '+(UI_FONTS[state.font]||UI_FONTS.system).label);});
  const brl=document.getElementById('btnReloadUI');
  if(brl)brl.addEventListener('click',()=>{
    try{localStorage.setItem('panda-reload-sec','apparence');}catch(e){}
    const ov=document.createElement('div');ov.className='stbusy';
    ov.innerHTML='<div class="stbcard"><div class="stbspin"></div><div class="stbmsg">Rafraîchissement…</div><div class="stbsub">L\'interface se recharge.</div></div>';
    document.body.appendChild(ov);
    setTimeout(()=>location.reload(),5000);
  });

  const segF=document.getElementById('segFont');
  if(segF){const cur=state.fontScale||100;
    [...segF.children].forEach(b=>{if(parseInt(b.dataset.fs)===cur)b.classList.add('on');
      b.addEventListener('click',()=>{state.fontScale=parseInt(b.dataset.fs);applyFontScale();save();secApparence();});});}

  /* --- écran (réglages système réels) --- */
  const post=async(u,b)=>{try{const r=await fetch(u,{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify(b)});return await r.json();}catch(e){return {ok:false,reason:'serveur injoignable'};}};
  /* --- luminosité (atténuation logicielle) --- */
  const al=document.getElementById('appLum');
  fetch('/api/system/display').then(r=>r.json()).then(dd=>{
    if(al&&dd&&dd.brightness!=null){al.value=dd.brightness;applyBrightness(dd.brightness);}
    const rot=document.getElementById('rotSel');
    if(rot&&!dd.display){rot.disabled=true;rot.title='Affichage non détecté';}
  }).catch(()=>{});
  if(al){
    al.addEventListener('input',()=>applyBrightness(al.value));   // aperçu en direct
    al.addEventListener('change',async()=>{
      const v=parseInt(al.value);applyBrightness(v);state.brightness=v;
      const j=await post('/api/system/brightness',{value:v});
      toast(j.ok?('Luminosité '+j.value+' %'):('Impossible — '+(j.reason||'')));});
  }
  const rot=document.getElementById('rotSel');
  if(rot)rot.value=state.rotation||'normal';   // reflète la rotation enregistrée
  if(rot)rot.addEventListener('change',async()=>{
    const j=await post('/api/system/rotation',{value:rot.value});
    toast(j.ok?'Rotation appliquée':('Impossible — '+(j.reason||'')));});
  const vmod=document.getElementById('veilleMode');
  if(vmod)vmod.addEventListener('change',()=>{state.veilleMode=vmod.value;save();
    const row=document.getElementById('veilleOffRow');if(row)row.style.display=(vmod.value!=='off')?'':'none';});
  const voff=document.getElementById('veilleOff');
  if(voff)voff.addEventListener('change',()=>{state.veilleOff=parseInt(voff.value)||0;save();});
  const vsel=document.getElementById('veille');
  if(vsel)vsel.addEventListener('change',async()=>{
    const mins=parseInt(vsel.value)||0;
    const j=await post('/api/system/veille',{minutes:mins});
    if(j.ok){state.veille=mins;save();}
    toast(j.ok?(j.note||(mins?('Veille après '+mins+' min'):'Veille désactivée')):('Impossible — '+(j.reason||'')));});

  /* --- accueil --- */
  document.getElementById('railSw').addEventListener('click',()=>{state.railOn=!state.railOn;save();renderHome();secApparence();});
  const rms=document.getElementById('railModeSel');
  if(rms)rms.addEventListener('change',()=>{state.railMode=rms.value;save();renderHome();});
}

function secCategorie(){
  const A=allCats();
  const usage={};(state.installed||[]).forEach(id=>{const c=catOf(id);usage[c]=(usage[c]||0)+1;});
  const hiddenSet=(state.catHidden||[]);
  let order=sortedCats(Object.keys(A).filter(c=>c!=='_none'));
  if(usage['_none'])order=order.concat(['_none']);
  const visibles=order.filter(c=>!hiddenSet.includes(c));
  const masquees=order.filter(c=>hiddenSet.includes(c));
  let h='<h4>Catégories</h4><div class="desc">Organise les catégories du menu de l\'accueil : renomme-les, change l\'icône, réordonne-les, range tes applications.</div>';
  h+='<div id="catMgr"></div>';
  h+='<button class="btnpill install" id="catAdd" style="margin-top:12px">➕ Nouvelle catégorie</button>';
  if(masquees.length){
    h+='<div class="cathdrow" id="catHidToggle" style="margin-top:20px"><span class="cathchevron" id="catHidChev">▸</span> Catégories masquées <span class="crc">'+masquees.length+'</span></div>';
    h+='<div id="catHidList" style="display:none"></div>';
  }

  setcontent.innerHTML=h;

  const rowHtml=(c,idx,arr)=>{
    const info=A[c];const n=usage[c]||0;
    const hidden=hiddenSet.includes(c);
    const isNone=(c==='_none');
    const row=document.createElement('div');row.className='catrow';
    row.innerHTML=
      '<span class="cri">'+ic(info.i,info.c)+'</span>'+
      '<span class="crn">'+info.l+(hidden?' <span class="crh">masquée</span>':'')+'</span>'+
      '<span class="crc">'+n+' app'+(n>1?'s':'')+'</span>'+
      '<span class="cra">'+
        (isNone?'':(
        (hidden?'':'<button class="crbtn" data-cup="'+c+'"'+(idx===0?' disabled':'')+' title="Monter">▲</button>'+
        '<button class="crbtn" data-cdown="'+c+'"'+(idx===arr.length-1||arr[idx+1]==='_none'?' disabled':'')+' title="Descendre">▼</button>')+
        '<button class="crbtn" data-cedit="'+c+'" title="Éditer">✏️</button>'+
        (hidden?'<button class="crbtn" data-cshow="'+c+'" title="Réafficher">👁</button>':'')+
        '<button class="crbtn del" data-cdel="'+c+'" title="Supprimer">🗑️</button>'))+
      '</span>';
    return row;
  };

  /* ---- catégories visibles ---- */
  const mgr=document.getElementById('catMgr');
  visibles.forEach((c,idx)=>mgr.appendChild(rowHtml(c,idx,visibles)));

  /* ---- catégories masquées (section repliable) ---- */
  if(masquees.length){
    const hl=document.getElementById('catHidList');
    masquees.forEach((c,idx)=>hl.appendChild(rowHtml(c,idx,masquees)));
    const tog=document.getElementById('catHidToggle');
    tog.addEventListener('click',()=>{
      const open=hl.style.display!=='none';
      hl.style.display=open?'none':'block';
      document.getElementById('catHidChev').textContent=open?'▸':'▾';
    });
  }

  const wire=(rootEl)=>{
    rootEl.querySelectorAll('[data-cup]').forEach(b=>b.addEventListener('click',()=>moveCat(visibles,visibles.indexOf(b.dataset.cup),-1)));
    rootEl.querySelectorAll('[data-cdown]').forEach(b=>b.addEventListener('click',()=>moveCat(visibles,visibles.indexOf(b.dataset.cdown),1)));
    rootEl.querySelectorAll('[data-cedit]').forEach(b=>b.addEventListener('click',()=>editCat(b.dataset.cedit)));
    rootEl.querySelectorAll('[data-cdel]').forEach(b=>b.addEventListener('click',()=>deleteCat(b.dataset.cdel)));
    rootEl.querySelectorAll('[data-cshow]').forEach(b=>b.addEventListener('click',()=>{
      const c=b.dataset.cshow;state.catHidden=(state.catHidden||[]).filter(x=>x!==c);
      save();renderHome();secCategorie();toast('Catégorie réaffichée');}));
  };
  wire(mgr);
  if(masquees.length)wire(document.getElementById('catHidList'));

  document.getElementById('catAdd').addEventListener('click',()=>{
    state.catCustom=state.catCustom||{};
    const id='cat'+Date.now();
    state.catCustom[id]={l:'Nouvelle catégorie',i:'📁'};
    state.catOrder=(state.catOrder||sortedCats(Object.keys(allCats()))).concat([id]);
    save();editCat(id);});
}
/* Édition complète d'une catégorie : nom + icône (+ affichage accueil). */
function editCat(c){
  if(c==='_none')return;
  const A=allCats();const info=A[c];if(!info)return;
  const ICONS=['📁','🏠','🌤️','🍽️','📅','🎬','🔧','📚','🌱','🎵','📸','🛰️','🔒','🛒','💡','⭐','🐾','☕','🎮','📊','🗂️','🏷️'];
  const CATCOLORS=['#888780','#378add','#5ac8a8','#639922','#f0b429','#e0892b','#e8a06a','#d85a30','#e8635a','#534ab7','#7aa2f7','#c98af0'];
  const sh=document.createElement('div');sh.className='evsheet';
  const cur={i:info.i,l:info.l,c:info.c||'#888780',hidden:(state.catHidden||[]).includes(c)};
  const render=()=>{
    sh.innerHTML='<div class="evbox" style="width:480px"><div class="evtitle">✏️ Éditer la catégorie</div>'+
      '<div class="cfgf" style="margin-top:6px"><span>Nom</span>'+
        '<input class="inp" id="ecName" value="'+cur.l.replace(/"/g,'&quot;')+'" '+(info.builtin?'':'')+'></div>'+
      '<div class="cfgf" style="margin-top:12px"><span>Icône</span>'+
        '<div class="eciconrow">'+ICONS.map(x=>'<span class="ecico'+(x===cur.i?' on':'')+'" data-ic="'+x+'" style="color:'+(cur.c||'#888780')+'">'+ic(x,cur.c)+'</span>').join('')+'</div>'+
        '<input class="inp" id="ecIcon" value="'+cur.i+'" maxlength="4" style="margin-top:8px;text-align:center;font-size:20px;max-width:90px" placeholder="ou colle un emoji"></div>'+
      '<div class="cfgf" style="margin-top:12px"><span>Couleur</span>'+
        '<div class="eccolrow">'+CATCOLORS.map(col=>'<span class="eccol'+(col===cur.c?' on':'')+'" data-col="'+col+'" style="background:'+col+'"></span>').join('')+'</div></div>'+
      '<div class="setrow" style="margin-top:12px"><div class="lft"><div class="t">Afficher sur l\'accueil</div><div class="d">Masque la catégorie sans la supprimer</div></div><div class="sw'+(cur.hidden?'':' on')+'" id="ecShow"></div></div>'+
      (info.builtin?'<div class="desc" style="margin-top:8px;color:var(--faint)">Catégorie d\'origine : renommable et personnalisable, mais non supprimable.</div>':'')+
      '<div class="cfgf" style="margin-top:14px"><span>Applications dans cette catégorie</span>'+
        '<div class="ecapps">'+(state.installed||[]).map(id=>BYID[id]).filter(Boolean)
          .sort((x,y)=>dnm(x).localeCompare(dnm(y),'fr'))
          .map(ap=>'<div class="ecapp'+(catOf(ap.id)===c?' on':'')+'" data-eapp="'+ap.id+'">'+ic(ap.ic,ap.color)+' <span>'+dnm(ap)+'</span></div>').join('')+
        '</div><div class="desc" style="margin-top:4px;color:var(--faint)">Touche une application pour l\'ajouter ici. Touche une application déjà ici pour la détacher (elle passe « Sans catégorie »).</div></div>'+
      '<button class="tprecb" id="ecSave" style="margin-top:14px">Enregistrer</button>'+
      '<button class="catclose" id="ecCancel">Annuler</button></div>';
    sh.querySelectorAll('[data-ic]').forEach(o=>o.addEventListener('click',()=>{cur.i=o.dataset.ic;document.getElementById('ecIcon').value=o.dataset.ic;sh.querySelectorAll('.ecico').forEach(e=>e.classList.toggle('on',e.dataset.ic===cur.i));}));
    sh.querySelectorAll('[data-col]').forEach(o=>o.addEventListener('click',()=>{cur.c=o.dataset.col;sh.querySelectorAll('.eccol').forEach(e=>e.classList.toggle('on',e.dataset.col===cur.c));sh.querySelectorAll('.ecico').forEach(e=>{e.style.color=cur.c;const em=e.getAttribute('data-ic');e.innerHTML=ic(em,cur.c);});}));
    document.getElementById('ecIcon').addEventListener('input',e=>{cur.i=e.target.value.trim()||'📁';sh.querySelectorAll('.ecico').forEach(el=>el.classList.toggle('on',el.dataset.ic===cur.i));});
    document.getElementById('ecName').addEventListener('input',e=>cur.l=e.target.value);
    document.getElementById('ecShow').addEventListener('click',e=>{cur.hidden=!cur.hidden;e.target.classList.toggle('on',!cur.hidden);});
    sh.querySelectorAll('[data-eapp]').forEach(el=>el.addEventListener('click',()=>{
      const id=el.dataset.eapp;state.appCat=state.appCat||{};
      if(catOf(id)===c){ // déjà ici -> détacher vers « Sans catégorie »
        state.appCat[id]='_none';
      } else state.appCat[id]=c;
      save();renderHome();el.classList.toggle('on',catOf(id)===c);
    }));
    document.getElementById('ecCancel').addEventListener('click',()=>sh.remove());
    document.getElementById('ecSave').addEventListener('click',()=>{
      const nom=(cur.l||'').trim()||'Catégorie';const icone=(cur.i||'📁').trim()||'📁';const coul=(cur.c||'#888780');
      state.catNames=state.catNames||{};state.catCustom=state.catCustom||{};state.catColors=state.catColors||{};state.catIcons=state.catIcons||{};
      if(CATS[c]){
        if(nom!==CATS[c].l)state.catNames[c]=nom; else delete state.catNames[c];
        if(coul!==CATS[c].c)state.catColors[c]=coul; else delete state.catColors[c];
        if(icone!==CATS[c].i)state.catIcons[c]=icone; else delete state.catIcons[c];
      }
      else { state.catCustom[c]=state.catCustom[c]||{}; state.catCustom[c].l=nom; state.catCustom[c].i=icone; state.catCustom[c].c=coul; }
      state.catHidden=state.catHidden||[];
      const hi=state.catHidden.indexOf(c);
      if(cur.hidden&&hi<0)state.catHidden.push(c); else if(!cur.hidden&&hi>=0)state.catHidden.splice(hi,1);
      save();renderHome();sh.remove();secCategorie();toast('Catégorie enregistrée');});
  };
  document.body.appendChild(sh);render();
  sh.addEventListener('click',e=>{if(e.target===sh)sh.remove();});
}
/* Suppression avec migration des applications présentes. */
function deleteCat(c){
  const A=allCats();
  const builtin=!!CATS[c];
  const apps=(state.installed||[]).filter(id=>catOf(id)===c);
  const doDelete=()=>{
    if(builtin){
      // catégorie d'origine : on ne peut pas l'effacer du code -> on la masque
      state.catHidden=state.catHidden||[];
      if(!state.catHidden.includes(c))state.catHidden.push(c);
    }else{
      delete (state.catCustom||{})[c];
    }
    Object.keys(state.appCat||{}).forEach(id=>{if(state.appCat[id]===c)delete state.appCat[id];});
    state.catOrder=(state.catOrder||[]).filter(x=>x!==c);
    save();renderHome();secCategorie();};
  if(!apps.length){doDelete();toast(builtin?'Catégorie masquée':'Catégorie supprimée');return;}
  // destinations : autres catégories réelles + « Sans catégorie »
  const dests=sortedCats(Object.keys(A).filter(x=>x!==c&&x!=='_none')).concat(['_none']);
  const sh=document.createElement('div');sh.className='evsheet';
  sh.innerHTML='<div class="evbox" style="width:470px"><div class="evtitle">🗑️ Supprimer « '+A[c].l+' »</div>'+
    '<div class="desc" style="margin:6px 0 10px">'+apps.length+' application'+(apps.length>1?'s':'')+' ('+apps.map(id=>dnm(BYID[id]||{id:id,nm:id})).join(', ')+') — vers quelle catégorie les déplacer ?</div>'+
    '<div style="max-height:300px;overflow:auto">'+dests.map(x=>'<div class="catopt" data-mig="'+x+'" style="min-height:48px">'+ic(A[x].i,A[x].c)+' '+A[x].l+'</div>').join('')+'</div>'+
    '<button class="catclose" id="dcCancel">Annuler</button></div>';
  document.body.appendChild(sh);
  const close=()=>sh.remove();
  sh.querySelector('#dcCancel').addEventListener('click',close);
  sh.addEventListener('click',e=>{if(e.target===sh)close();});
  sh.querySelectorAll('[data-mig]').forEach(o=>o.addEventListener('click',()=>{
    const dest=o.dataset.mig;state.appCat=state.appCat||{};
    apps.forEach(id=>state.appCat[id]=dest);close();doDelete();
    toast(apps.length+' app'+(apps.length>1?'s déplacées':' déplacée')+' vers '+A[dest].l);}));
}
function secSec(){
  setcontent.innerHTML='<h4>Sécurité</h4>'+
    '<div class="setrow"><div class="lft"><div class="t">Verrouillage par code</div><div class="d">Demande le PIN au démarrage et à la déconnexion</div></div><div class="sw'+(state.lockEnabled?' on':'')+'" id="lockSw"></div></div>'+
    '<div class="setrow"><div class="lft"><div class="t">Changer le code PIN</div><div class="d">Nouveau PIN à 6 chiffres</div></div><button class="btnpill" id="chgPin">Modifier</button></div>'+
    '<div class="setrow"><div class="lft"><div class="t">Mot de passe administrateur</div><div class="d">Protège les Paramètres et les clés API (8 caractères min.)</div></div><button class="btnpill'+(adminDefault?' install':'')+'" id="chgAdm">Modifier</button></div>'+
    '<div id="admForm"></div>'+
    '<div class="setrow"><div class="lft"><div class="t">Verrouillage automatique</div><div class="d">Redemande le code PIN après inactivité</div></div><select class="inp" id="autolock"><option value="0">Jamais</option><option value="1">1 min</option><option value="5">5 min</option></select></div>'+
    '<div class="setrow"><div class="lft"><div class="t">Accès sans mot de passe</div><div class="d">Ouvre les Paramètres sans demander le mot de passe. L\'activation exige le mot de passe admin.</div></div><div class="sw'+(adminNoPw?' on':'')+'" id="nopwSw"></div></div>'+
    '<div id="nopwForm"></div>';
  document.getElementById('lockSw').addEventListener('click',()=>{state.lockEnabled=!state.lockEnabled;save();secSec();});
  document.getElementById('chgPin').addEventListener('click',startChangePin);
  document.getElementById('chgAdm').addEventListener('click',showAdminForm);
  const al=document.getElementById('autolock');al.value=String(state.autolock);al.addEventListener('change',()=>{state.autolock=parseInt(al.value);save();resetIdle();});
  const npw=document.getElementById('nopwSw');
  if(npw)npw.addEventListener('click',async()=>{
    if(adminNoPw){
      const r=await fetch('/api/admin/nopw',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({on:false})});
      const j=await r.json();if(j.ok){adminNoPw=false;npw.classList.remove('on');document.getElementById('nopwForm').innerHTML='';toast('Mot de passe requis pour l\'admin');}
    }else{
      const box=document.getElementById('nopwForm');
      box.innerHTML='<div class="setrow" style="flex-direction:column;align-items:stretch;gap:8px"><input class="inp" type="password" id="nopwPw" placeholder="Mot de passe admin pour confirmer"><div class="admerr" id="nopwErr"></div><button class="btnpill install" id="nopwSave">Confirmer</button></div>';
      document.getElementById('nopwSave').addEventListener('click',async()=>{
        const pw=document.getElementById('nopwPw').value;const err=document.getElementById('nopwErr');err.textContent='';
        const r=await fetch('/api/admin/nopw',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({on:true,password:pw})});
        const j=await r.json();if(j.ok){adminNoPw=true;box.innerHTML='';npw.classList.add('on');toast('Accès admin sans mot de passe activé');}else err.textContent=j.reason||'Erreur';});
    }});
}
function showAdminForm(){
  const box=document.getElementById('admForm');if(!box)return;
  box.innerHTML='<div class="setrow" style="flex-direction:column;align-items:stretch;gap:8px">'+
    '<input class="inp" type="password" id="admOld" placeholder="Mot de passe actuel">'+
    '<input class="inp" type="password" id="admNew" placeholder="Nouveau mot de passe (8 caractères min.)">'+
    '<input class="inp" type="password" id="admNew2" placeholder="Confirmer le nouveau mot de passe">'+
    '<div class="admerr" id="admChgErr"></div>'+
    '<button class="btnpill install" id="admSave">Enregistrer</button></div>';
  document.getElementById('admSave').addEventListener('click',async()=>{
    const o=document.getElementById('admOld').value,n=document.getElementById('admNew').value,n2=document.getElementById('admNew2').value;
    const err=document.getElementById('admChgErr');err.textContent='';
    if(n!==n2){err.textContent='Les deux mots de passe ne correspondent pas';return;}
    if(n.length<8){err.textContent='8 caractères minimum';return;}
    try{
      const r=await fetch('/api/admin/change',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({old:o,new:n})});
      const j=await r.json();
      if(j.ok){adminDefault=false;toast('Mot de passe administrateur modifié');secSec();}
      else err.textContent=j.error||'Erreur';
    }catch(e){err.textContent='Serveur injoignable';}
  });
}

/* ---------- NOTIFICATIONS AGENDA (bandeau en-tête) ---------- */
function startAgendaNotif(){
  _auiBackground();   // hooks Phase 3 : chaque addon background alimente ses surfaces
}

/* ---------- CLAVIER VIRTUEL (écran tactile, pas de clavier physique) ---------- */
const VK_ROWS_AZ=[
  ['1','2','3','4','5','6','7','8','9','0'],
  ['a','z','e','r','t','y','u','i','o','p'],
  ['q','s','d','f','g','h','j','k','l','m'],
  ['w','x','c','v','b','n','.','-','_','@']
];
const VK_ROWS_NUM=[['1','2','3'],['4','5','6'],['7','8','9'],['.','0','-']];
let vkTarget=null,vkShift=false;
// le clavier est créé dynamiquement : aucune dépendance à l'ordre du DOM
const vkb=document.createElement('div');
vkb.id='vkb';vkb.setAttribute('aria-hidden','true');
vkb.innerHTML='<div class="vkbar"><span id="vkbTarget">Clavier</span><span class="vkclose" id="vkbClose">Fermer ▾</span></div><div id="vkbKeys"></div>';
document.body.appendChild(vkb);
const vkbKeys=vkb.querySelector('#vkbKeys');
function vkIsNum(el){return el.type==='number'||el.inputMode==='numeric';}
function vkRender(){
  if(!vkTarget)return;
  const rows=vkIsNum(vkTarget)?VK_ROWS_NUM:VK_ROWS_AZ;
  let h='';
  rows.forEach(r=>{h+='<div class="vkrow">'+r.map(k=>{
    const lab=(vkShift&&/[a-z]/.test(k))?k.toUpperCase():k;
    return '<div class="vk" data-k="'+lab+'">'+lab+'</div>';}).join('')+'</div>';});
  if(!vkIsNum(vkTarget)){
    h+='<div class="vkrow">'+
       '<div class="vk wide fn'+(vkShift?' act':'')+'" data-a="shift">⇧ Maj</div>'+
       '<div class="vk xwide" data-k=" ">espace</div>'+
       '<div class="vk fn" data-k="/">/</div><div class="vk fn" data-k=":">:</div>'+
       '<div class="vk wide fn" data-a="back">⌫</div>'+
       '</div>';
  }else{
    h+='<div class="vkrow"><div class="vk wide fn" data-a="back">⌫ Effacer</div><div class="vk wide fn" data-a="close">OK</div></div>';
  }
  vkbKeys.innerHTML=h;
}
function vkInsert(txt){
  if(!vkTarget)return;
  const el=vkTarget,s0=el.selectionStart,e0=el.selectionEnd;
  if(s0!=null&&el.setRangeText){el.setRangeText(txt,s0,e0,'end');}
  else el.value+=txt;
  el.dispatchEvent(new Event('input',{bubbles:true}));
  if(vkShift){vkShift=false;vkRender();}
}
function vkBack(){
  if(!vkTarget)return;
  const el=vkTarget,s0=el.selectionStart,e0=el.selectionEnd;
  if(s0!=null&&el.setRangeText){ if(s0===e0&&s0>0)el.setRangeText('',s0-1,s0,'end'); else el.setRangeText('',s0,e0,'end'); }
  else el.value=el.value.slice(0,-1);
  el.dispatchEvent(new Event('input',{bubbles:true}));
}
function vkOpen(el){
  // Ancien clavier HTML désactivé : on utilise désormais wvkbd (clavier
  // Wayland natif AZERTY, affiché au focus via /api/system/keyboard/show).
  return;
}
function vkClose(){vkb.classList.remove('show');document.body.classList.remove('vkbopen');vkTarget=null;}
vkbKeys.addEventListener('pointerdown',e=>{
  const k=e.target.closest('.vk');if(!k)return;
  e.preventDefault(); // ne pas voler le focus au champ
  if(k.dataset.a==='shift'){vkShift=!vkShift;vkRender();return;}
  if(k.dataset.a==='back'){vkBack();return;}
  if(k.dataset.a==='close'){vkClose();return;}
  if(k.dataset.k!=null)vkInsert(k.dataset.k);
});
vkb.querySelector('#vkbClose').addEventListener('click',vkClose);
/* focusin/focusout de l'ancien clavier HTML retirés : c'est désormais le
   gestionnaire wvkbd (plus haut) qui affiche/masque le clavier au focus. */

/* ---------- LOCK / PIN ---------- */
const lock=document.getElementById('lock'),dots=document.getElementById('dots'),keypad=document.getElementById('keypad');
let entry="",pinMode="unlock",newPin="";
function buildDots(){dots.innerHTML='';for(let i=0;i<6;i++){const d=document.createElement('i');if(i<entry.length)d.classList.add('f');dots.appendChild(d);}}
function buildKeypad(){
  keypad.innerHTML='';
  [{l:"1"},{l:"2"},{l:"3"},{l:"4"},{l:"5"},{l:"6"},{l:"7"},{l:"8"},{l:"9"},{l:"Annuler",a:"cancel"},{l:"0"},{l:"⌫",a:"del"}].forEach(k=>{
    const b=document.createElement('div');b.className='key'+(k.a?' act':'');b.textContent=k.l;
    b.addEventListener('click',()=>press(k.a||k.l));
    keypad.appendChild(b);
  });
}
function press(k){
  if(k==='del'){entry=entry.slice(0,-1);buildDots();return;}
  if(k==='cancel'){onCancel();return;}
  if(entry.length>=6)return;
  entry+=k;buildDots();
  if(entry.length===6)setTimeout(submit,120);
}
function onCancel(){
  if(pinMode==='unlock'){entry="";buildDots();}
  else{closeLockPrompt();toast('Modification annulée');}
}
function shakeErr(msg){dots.classList.add('err');lock.querySelector('.lockbox').classList.add('shake');if(msg)document.getElementById('lockHint').textContent=msg;setTimeout(()=>{dots.classList.remove('err');lock.querySelector('.lockbox').classList.remove('shake');entry="";buildDots();},450);}
async function submit(){
  if(pinMode==='unlock'){
    try{
      const r=await fetch('/api/pin/verify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pin:entry})});
      const d=await r.json();
      if(d.ok){await pullConfig();applyState();lock.classList.remove('show');entry="";buildDots();document.getElementById('lockHint').textContent="6 chiffres";resetIdle();updateFleet();updateConnIcons();updateVolBtn();_volBtnBootRetry();startAgendaNotif();}
      else if(d.wait){shakeErr("Trop d'essais — attendez "+d.wait+" s");}
      else{shakeErr((d.remaining||0)+" essai(s) restant(s)");}
    }catch(e){shakeErr("Serveur injoignable");}
  }else if(pinMode==='new'){newPin=entry;entry="";buildDots();document.getElementById('lockAsk').textContent="Confirmez le code";pinMode='confirm';}
  else if(pinMode==='confirm'){
    if(entry===newPin){
      try{const r=await fetch('/api/pin/change',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({new:newPin})});const d=await r.json();
        if(d.ok){toast('Code modifié');closeLockPrompt();}else{document.getElementById('lockAsk').textContent=d.error||"Erreur";newPin="";entry="";buildDots();pinMode='new';}
      }catch(e){shakeErr("Serveur injoignable");}
    }else{document.getElementById('lockAsk').textContent="Codes différents — réessayez";newPin="";entry="";buildDots();pinMode='new';}
  }
}
function lockNow(){pinMode='unlock';entry="";document.getElementById('lockAsk').textContent="Entrez votre code";document.getElementById('lockHint').textContent="6 chiffres";buildDots();lock.classList.add('show');}
function startChangePin(){pinMode='new';entry="";newPin="";document.getElementById('lockAsk').textContent="Nouveau code";document.getElementById('lockHint').textContent="6 chiffres";buildDots();lock.classList.add('show');}
function closeLockPrompt(){pinMode='unlock';entry="";lock.classList.remove('show');buildDots();}
async function doLogout(){try{await fetch('/api/logout',{method:'POST'});}catch(e){}lockNow();}
/* Menu déconnexion / redémarrer / arrêter (tactile, gros boutons). */
function showPowerMenu(){
  let m=document.getElementById('pwrMenu');
  if(m){m.remove();return;}
  m=document.createElement('div');m.id='pwrMenu';
  m.style.cssText='position:absolute;inset:0;z-index:9900;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center';
  const bs='display:block;width:280px;margin:10px auto;padding:16px;font-size:17px;font-weight:700;border:none;border-radius:14px;cursor:pointer';
  m.innerHTML='<div style="background:var(--panel);border:1px solid var(--border);border-radius:20px;padding:26px 30px;text-align:center">'+
    '<button id="pwrLogout" style="'+bs+';background:var(--accent);color:#fff">Se déconnecter</button>'+
    '<button id="pwrReboot" style="'+bs+';background:var(--tile);color:var(--text);border:1px solid var(--border)">Redémarrer</button>'+
    '<button id="pwrOff" style="'+bs+';background:#c0392b;color:#fff">Arrêter</button>'+
    '<button id="pwrCancel" style="'+bs+';background:transparent;color:var(--dim)">Annuler</button></div>';
  document.querySelector('.kiosk').appendChild(m);
  m.addEventListener('click',e=>{if(e.target===m)m.remove();});
  document.getElementById('pwrCancel').addEventListener('click',()=>m.remove());
  document.getElementById('pwrLogout').addEventListener('click',()=>{m.remove();doLogout();});
  document.getElementById('pwrReboot').addEventListener('click',async()=>{m.remove();toast('Redémarrage…');
    try{await fetch('/api/system/power/reboot',{method:'POST'});}catch(e){}});
  document.getElementById('pwrOff').addEventListener('click',async()=>{m.remove();toast('Arrêt…');
    try{await fetch('/api/system/power/poweroff',{method:'POST'});}catch(e){}});
}
document.getElementById('logout').addEventListener('click',showPowerMenu);

/* auto-lock idle */
let idleT;
let veilleT=null,screenIsOff=false;
function screenOff(){
  if(screenIsOff)return;screenIsOff=true;
  // Voile noir : l'écran s'éteint mais le tactile reste actif — le voile
  // capte le premier toucher (rallumage) sans cliquer l'interface dessous.
  const mode=(state.veilleMode||'off');
  const v=document.createElement('div');v.id='veil';
  v.style.cssText='position:fixed;inset:0;background:#000;z-index:99999';
  v.addEventListener('pointerdown',e=>{e.stopPropagation();e.preventDefault();screenOn();},{once:true,capture:true});
  if(mode!=='off'){
    // veille « habitée » : horloge (+ météo du bandeau), dalle laissée allumée
    v.innerHTML='<div id="veilBox" style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);text-align:center;color:#cfd4dc;font-family:var(--sans);transition:transform 1.2s">'+
      '<div id="veilClk" style="font-size:15vw;font-weight:600;letter-spacing:.02em;line-height:1"></div>'+
      '<div id="veilDate" style="font-size:3.2vw;color:#8b93a1;margin-top:1.4vh"></div>'+
      (mode==='meteo'?'<div id="veilWx" style="font-size:3.6vw;color:#aab2bf;margin-top:2.4vh"></div>':'')+'</div>';
    const upd=()=>{const d=new Date();const c=document.getElementById('veilClk');if(!c)return;
      c.textContent=d.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit',hour12:(state.clockFmt==='12h')});
      const de=document.getElementById('veilDate');if(de)de.textContent=d.toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long'});
      if(mode==='meteo'){const w=document.getElementById('veilWx'),s=document.getElementById('wxBar');if(w)w.innerHTML=((s&&s.innerHTML)||'').trim();}
      // anti-marquage : léger déplacement aléatoire du bloc chaque minute
      const b=document.getElementById('veilBox');
      if(b&&d.getSeconds()===0)b.style.transform='translate('+(-50+(Math.random()*8-4))+'%,'+(-50+(Math.random()*8-4))+'%)';
    };
    upd();v._t=setInterval(upd,1000);
    // 2e étape : après veilleOff minutes d'horloge, extinction TOTALE de la dalle
    // (le voile reste pour capter le toucher ; l'horloge est masquée).
    if((state.veilleOff||0)>0){
      v._off=setTimeout(()=>{
        const box=document.getElementById('veilBox');if(box)box.style.display='none';
        if(v._t){clearInterval(v._t);v._t=null;}
        fetch('/api/system/screen',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({on:false})}).catch(()=>{});
      },state.veilleOff*60000);
    }
  }
  document.body.appendChild(v);
  if(mode==='off')fetch('/api/system/screen',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({on:false})}).catch(()=>{});
}
function screenOn(){
  screenIsOff=false;
  const v=document.getElementById('veil');
  // Rallumer la dalle si elle a été éteinte (mode 'off' direct, OU 2e étape atteinte).
  const wasOff=(state.veilleMode||'off')==='off'||(v&&!v._t&&(state.veilleOff||0)>0);
  if(wasOff)fetch('/api/system/screen',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({on:true})}).catch(()=>{});
  if(v){if(v._t)clearInterval(v._t);if(v._off)clearTimeout(v._off);setTimeout(()=>v.remove(),150);}
  resetIdle();
}
function resetIdle(){clearTimeout(idleT);clearTimeout(veilleT);if(state.autolock>0&&state.lockEnabled)idleT=setTimeout(doLogout,state.autolock*60000);if((state.veille||0)>0&&!screenIsOff)veilleT=setTimeout(screenOff,state.veille*60000);}
['pointerdown','keydown'].forEach(ev=>window.addEventListener(ev,resetIdle));

/* ---------- misc ---------- */
function updGearBadge(){const b=document.getElementById('gearBadge');if(b)b.style.display='none';}
let toastT;function toast(m){const t=document.getElementById('toast');t.innerHTML=m;t.classList.add('show');clearTimeout(toastT);toastT=setTimeout(()=>t.classList.remove('show'),1500);}

/* ---- Mise à jour de Panda : overlay plein écran + bandeau post-MAJ ----------
   L'overlay est ajouté à <body>, au-dessus de tout, et capte toute interaction :
   il vit donc indépendamment de la section affichée (accueil, Store, réglages…)
   et personne ne peut taper sur une interface en cours de bascule, où qu'il
   soit dans le kiosk. Son polling /healthz lui est propre et continue quelle
   que soit la navigation. */
function _semArr(v){return String(v||'').split('.').map(n=>parseInt(n,10)||0);}
function semverGt(a,b){const x=_semArr(a),y=_semArr(b),n=Math.max(x.length,y.length);
  for(let i=0;i<n;i++){const d=(x[i]||0)-(y[i]||0);if(d)return d>0;}return false;}
// Patience avant le cas « pas de retour » (cas 3). Doit couvrir le PIRE cas
// complet de panda-update — téléchargements + extraction + pip éventuel +
// restart + HEALTH_TIMEOUT (30 s) + éventuel chemin de rollback — et pas
// seulement HEALTH_TIMEOUT. 240 s laisse une marge confortable (cf.
// docs/self-update.md). Cadence de polling identique à l'existant : 3 s.
const UPD_PATIENCE_MS=240000, UPD_POLL_MS=3000, UPD_START_MS=5000;
let _updOv=null,_updPoll=null;
function startUpdateOverlay(prev, expected){
  if(_updOv)return;                                   // un seul overlay à la fois
  const o=document.createElement('div');o.className='updov';
  o.innerHTML='<div class="updcard"><div class="stbspin"></div>'+
    '<div class="updttl">Mise à jour en cours…</div>'+
    '<div class="updsub">Ne débranchez pas l\'écran. Le kiosk va redémarrer tout seul dans quelques instants.</div>'+
    '<div class="upddots"><i></i><i></i><i></i></div></div>';
  document.body.appendChild(o);_updOv=o;
  const started=Date.now();let sawDown=false;
  function stop(){if(_updPoll){clearTimeout(_updPoll);_updPoll=null;}}
  function finalState(cls,ttl,sub,tap){
    o.className='updov '+cls;
    o.innerHTML='<div class="updcard"><div class="updttl">'+ttl+'</div>'+
      '<div class="updsub">'+sub+'</div>'+
      (tap?'<div class="updtap">Touchez l\'écran pour recharger</div>':'')+'</div>';
    if(tap)o.addEventListener('click',()=>location.reload(),{once:true});
  }
  function schedule(){
    if(Date.now()-started>UPD_PATIENCE_MS){stop();
      finalState('bad','Le kiosk ne répond pas',
        'La mise à jour prend plus de temps que prévu. Vérifiez le kiosk ou contactez un administrateur.',true);
      return;}
    _updPoll=setTimeout(poll,UPD_POLL_MS);
  }
  function poll(){
    fetch('/healthz',{cache:'no-store'}).then(r=>r.json()).then(j=>{
      if(j&&j.status==='ok'){
        const v=j.version||'';
        if(!prev)prev=v;                               // garde-fou : baseline si inconnue
        if(semverGt(v,prev)){                          // version montée → succès
          stop();o.className='updov ok';
          o.innerHTML='<div class="updcard"><div class="updttl">Mise à jour réussie</div>'+
            '<div class="updsub">Le kiosk redémarre…</div></div>';
          setTimeout(()=>location.reload(),1500);return;}
        if(sawDown){                                    // revenu après un arrêt, sans montée → rollback
          stop();
          finalState('warn','Mise à jour non appliquée',
            'La mise à jour n\'a pas pu être appliquée. L\'ancienne version (v'+v+') a été restaurée automatiquement.',true);
          return;}
      }
      schedule();                                      // sinon (ancien service encore là) : on patiente
    }).catch(()=>{sawDown=true;schedule();});          // service injoignable = fenêtre de redémarrage
  }
  _updPoll=setTimeout(poll,UPD_START_MS);
}
function showUpdateBanner(version){
  const b=document.createElement('div');b.className='updbanner';b.style.zIndex='1000000';
  b.innerHTML='✓ Nouvelle version installée avec succès — <b>v'+(version||'?')+'</b><span class="updbannerclose">Toucher pour fermer</span>';
  document.body.appendChild(b);
  requestAnimationFrame(()=>b.classList.add('show'));
  // Reste affiché jusqu'au tap : pas de disparition automatique, pour être
  // visible même si l'écran a fini de se redessiner après le déverrouillage.
  const kill=()=>{try{sessionStorage.removeItem('pandaUpdDone');}catch(e){}
    b.classList.remove('show');setTimeout(()=>b.remove(),300);};
  b.addEventListener('click',kill,{once:true});
}
async function checkUpdateDone(){
  try{
    // Persiste à travers un reload de page : le marqueur serveur est one-shot,
    // mais un rechargement juste après le déverrouillage escamotait le bandeau.
    const saved=sessionStorage.getItem('pandaUpdDone');
    if(saved!==null){showUpdateBanner(saved);return;}
    const r=await fetch('/api/system/update-done',{cache:'no-store'});const d=await r.json();
    if(d&&d.ok&&d.pending){
      try{sessionStorage.setItem('pandaUpdDone',d.version||'');}catch(e){}
      showUpdateBanner(d.version);
    }
  }catch(e){}
}
function tick(){const d=new Date();var topt={hour:'2-digit',minute:'2-digit',hour12:(state.clockFmt==='12h')};if(state.clockSec)topt.second='2-digit';document.getElementById('clk').textContent=d.toLocaleTimeString('fr-FR',topt);var de=document.getElementById('date');if(!de)return;if(state.dateFmt==='hidden'){de.style.display='none';}else{de.style.display='';var dopt=(state.dateFmt==='short')?{day:'2-digit',month:'2-digit',year:'numeric'}:{weekday:'long',day:'numeric',month:'long'};de.textContent=d.toLocaleDateString('fr-FR',dopt);}}
tick();setInterval(tick,1000);
// Le rafraîchissement système est piloté par startSysTimer(), démarré à
// l'ouverture de l'onglet Système et arrêté à sa fermeture — pas de second
// intervalle global ici (il doublait les appels /api/system).

// état de la flotte (Uptime Kuma) : pastille bandeau + ligne Système
function _svgWifi(on){
  return '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="'+(on?'var(--accent)':'var(--faint)')+'" stroke-width="2.2" stroke-linecap="round"><path d="M2.5 9a15.5 15.5 0 0 1 19 0"/><path d="M5.6 12.5a11 11 0 0 1 12.8 0"/><path d="M8.8 16a6.2 6.2 0 0 1 6.4 0"/><circle cx="12" cy="19.3" r="1.4" fill="'+(on?'var(--accent)':'var(--faint)')+'" stroke="none"/></svg>';
}
function _svgBt(on){
  return '<svg width="15" height="17" viewBox="0 0 24 24" fill="none" stroke="'+(on?'#7aa2f7':'var(--faint)')+'" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 7l10 10-5 4V3l5 4L7 17"/></svg>';
}
async function updateConnIcons(){
  const el=document.getElementById('connIcons');if(!el)return;
  try{
    const r=await fetch('/api/system/connstatus');if(!r.ok)throw 0;
    const d=await r.json();let h='';
    if(d.wifi&&d.wifi.present&&d.wifi.enabled&&state.wifiInd!==false)
      h+='<span title="WiFi'+(d.wifi.connected?' — '+d.wifi.ssid:' : déconnecté')+'" style="display:flex">'+_svgWifi(d.wifi.connected)+'</span>';
    if(d.bt&&d.bt.present&&d.bt.powered&&state.btInd!==false)
      h+='<span title="Bluetooth'+(d.bt.connected?' — '+d.bt.name:' : aucun appareil')+'" style="display:flex">'+_svgBt(d.bt.connected)+'</span>';
    if(h){el.innerHTML=h;el.style.display='flex';}
    else{el.innerHTML='';el.style.display='none';}
  }catch(e){el.style.display='none';}
}
setInterval(updateConnIcons,30000);
/* ---- Contrôle du volume dans la barre du haut ---- */
function _svgVol(level,muted){
  const c='currentColor';
  let waves='';
  if(!muted&&level>0)waves+='<path d="M15.5 8.5a5 5 0 0 1 0 7"/>';
  if(!muted&&level>50)waves+='<path d="M18 5a9 9 0 0 1 0 14"/>';
  const mute=muted?'<line x1="17" y1="9" x2="23" y2="15"/><line x1="23" y1="9" x2="17" y2="15"/>':'';
  return '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="'+c+'" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>'+waves+mute+'</svg>';
}
let _volState={level:50,muted:false,ok:false};
async function updateVolBtn(){
  const btn=document.getElementById('volBtn');if(!btn)return;
  if(state.volBar===false){btn.style.display='none';return;}
  try{
    const r=await fetch('/api/system/volume');const d=await r.json();
    if(d&&d.ok){_volState={level:d.volume,muted:d.muted,ok:true};
      btn.innerHTML=_svgVol(d.volume,d.muted);btn.style.display='';btn.title='Volume '+d.volume+'%';}
    else if(_volState.ok){btn.style.display='';}
  }catch(e){if(_volState.ok)btn.style.display='';}
}
// Au démarrage, PipeWire peut n'être pas encore prêt (le service Flask démarre
// avant la session audio) : on réessaie quelques fois rapprochées jusqu'à ce
// que l'API réponde, sinon le bouton resterait caché jusqu'au prochain cycle.
function _volBtnBootRetry(){
  let n=0;
  const iv=setInterval(async()=>{
    n++;
    if(_volState.ok||n>20){clearInterval(iv);return;}
    if(state.volBar!==false)await updateVolBtn();
  },3000);
}
function toggleVolPopover(){
  let pop=document.getElementById('volPop');
  if(pop){pop.remove();return;}
  pop=document.createElement('div');pop.id='volPop';pop.className='volpop';
  pop.innerHTML='<div class="volpoprow"><span id="volPopIco">'+_svgVol(_volState.level,_volState.muted)+'</span>'+
    '<input type="range" min="0" max="150" step="5" id="volPopSlider" value="'+_volState.level+'">'+
    '<span class="volpopval" id="volPopVal">'+_volState.level+'%</span></div>';
  document.querySelector('.kiosk').appendChild(pop);
  const sl=document.getElementById('volPopSlider'),val=document.getElementById('volPopVal'),ico=document.getElementById('volPopIco');
  const apply=async(v)=>{val.textContent=v+'%';ico.innerHTML=_svgVol(v,false);
    try{await fetch('/api/system/volume',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({value:parseInt(v)})});}catch(e){}
    _volState.level=parseInt(v);const b=document.getElementById('volBtn');if(b)b.innerHTML=_svgVol(v,false);};
  sl.addEventListener('input',()=>{val.textContent=sl.value+'%';ico.innerHTML=_svgVol(sl.value,false);});
  sl.addEventListener('change',()=>apply(sl.value));
  // fermeture au clic extérieur
  setTimeout(()=>{document.addEventListener('click',function cl(e){
    if(!pop.contains(e.target)&&e.target.id!=='volBtn'&&!document.getElementById('volBtn').contains(e.target)){
      pop.remove();document.removeEventListener('click',cl);}},0);},50);
}
(function(){
  const vb=document.getElementById('volBtn');
  if(vb)vb.addEventListener('click',e=>{e.stopPropagation();toggleVolPopover();});
})();
setInterval(updateVolBtn,30000);
async function updateFleet(){
  const pill=document.getElementById('fleetPill');const sys=null;
  if(!state.installed.includes('kuma')||(state.hidden||[]).includes('kuma')){if(pill){pill.innerHTML='';pill.style.display='none';}return;}
  if(pill)pill.style.display='flex';
  try{
    const r=await fetch('/addons/kuma/api/kuma/fleet');if(!r.ok)return;const d=await r.json();
    const label=d.label||'Flotte';
    if(!d.ok){if(pill)pill.innerHTML='<span class="dot" style="background:var(--faint)"></span>'+label+' · –';if(sys)sys.textContent='— (Kuma non configuré)';return;}
    const allUp=(d.down===0);
    const pd=(c)=>'<span class="pdot" style="background:'+c+'"></span>';
    let html;
    if(d.format==='dots'){
      html=label+' '+pd('var(--green)')+'<b>'+d.up+'</b> '+pd('var(--bad)')+'<b>'+d.down+'</b>';
    }else if(d.format==='text'){
      html=label+' · <span style="color:var(--green);font-weight:600">'+d.up+' en ligne</span> / <span style="color:var(--bad);font-weight:600">'+d.down+' hors ligne</span>';
    }else{
      html='<span class="dot" style="background:'+(allUp?'var(--green)':'var(--warn)')+';box-shadow:0 0 8px '+(allUp?'var(--green)':'var(--warn)')+'"></span>'+label+' · '+d.up+'/'+d.total+' up';
    }
    if(pill)pill.innerHTML=html;
    if(sys)sys.textContent=d.up+'/'+d.total+' up'+(d.down?(' · '+d.down+' hors ligne'):'');
  }catch(e){}
}
setInterval(updateFleet,30000);
function fit(){
  // Plein écran permanent : le mode aperçu (cadre + mise à l'échelle), qui
  // servait au développement sur navigateur de bureau, a été retiré.
  document.body.classList.add('fullscreen');
}
fit();window.addEventListener('resize',fit);

// init
async function boot(){
  buildDots();buildKeypad();
  // Thème appliqué IMMÉDIATEMENT depuis le cache local (évite le flash de
  // mauvais thème sur la page PIN), confirmé ensuite par /api/session.
  let cachedTheme=null;
  try{cachedTheme=localStorage.getItem('panda-theme');}catch(e){}
  document.documentElement.setAttribute('data-theme',cachedTheme||state.theme||'dark');
  try{
    const r=await fetch('/api/session');const s=await r.json();
    if(s.theme){state.theme=s.theme;document.documentElement.setAttribute('data-theme',s.theme);
      try{localStorage.setItem('panda-theme',s.theme);}catch(e){}}
    // Bandeau post-MAJ : vérifié dès le chargement, écran de PIN compris —
    // le bandeau (z-index 1000000) s'affiche au-dessus du verrouillage.
    try{checkUpdateDone();}catch(e){}
    if(s.authed){lock.classList.remove('show');
      await pullConfig();applyState();resetIdle();updateFleet();updateConnIcons();updateVolBtn();_volBtnBootRetry();startAgendaNotif();setupStoreTimer();if((state.storeCheck||'open')!=='manual')checkStoreUpdates(true);
      let goto=null;try{goto=localStorage.getItem('panda-store-goto');localStorage.removeItem('panda-store-goto');}catch(e){}
      if(goto==='installed'){appTab='myapps';openSettings('apps');}
      let rsec=null;try{rsec=localStorage.getItem('panda-reload-sec');localStorage.removeItem('panda-reload-sec');}catch(e){}
      if(rsec){openSettings(rsec);}}
    else{lockNow();}
  }catch(e){lockNow();}
}
boot();
startIconify();
