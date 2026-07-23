/* Météo — Open-Meteo + Vigilance Météo-France (Phase 3, lot D final).
   Le bandeau #wxBar (accueil, noyau) est alimenté par ce module : background()
   rafraîchit périodiquement (15 min, idempotent) et pilote la barre. */
window.PandaAddons = window.PandaAddons || {};
window.PandaAddons.meteo = (function () {
  let S=null, root=null, tile=null, bgSdk=null, bgTimer=null;
  let data=null, vig=null, hourMode='cards', geoCoords=null;
  const CSS = "  .wtop{display:flex;align-items:center;gap:18px;padding:18px 22px 12px}\n  .wemoji{font-size:50px;line-height:1}\n  .wtemp{font-size:52px;font-weight:300;line-height:1;font-variant-numeric:tabular-nums}\n  .wstat{background:var(--tile);border:1px solid var(--border-soft);border-radius:10px;padding:7px 13px;font-size:11.5px;color:var(--dim)}\n  .wstat b{display:block;font-size:14px;color:var(--text);margin-top:1px}\n  .whours{display:flex;gap:8px;overflow-x:auto;padding:0 22px 8px}\n  .whours::-webkit-scrollbar{height:6px}.whours::-webkit-scrollbar-thumb{background:var(--border);border-radius:3px}\n  .whour{background:var(--tile);border:1px solid var(--border-soft);border-radius:10px;padding:9px 8px;text-align:center;flex:1 1 0;min-width:52px}\n  .whour .ht{font-size:11px;color:var(--dim)}.whour .he{font-size:20px;margin:2px 0}.whour .hp{font-size:11px;color:var(--accent)}\n  .wgrid{display:flex;gap:20px;padding:16px 22px 6px;align-items:center}\n  .wleft{flex:0 0 38%}\n  .wleft .wtop{display:flex;align-items:center;gap:14px;padding:0}\n  .wleft .wcity{font-size:16px;font-weight:600;margin-top:8px}\n  .wleft .wcond{font-size:13px;color:var(--dim);margin-top:2px}\n  .wright{flex:1;display:flex;flex-direction:column;gap:10px}\n  .wrstats{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}\n  .vigbar{margin:14px 22px 4px;padding:9px 14px;border-radius:10px;border:1px solid var(--vc,var(--dim));border-left:4px solid var(--vc,var(--dim));font-size:13px}\n  .vigbar b{color:var(--vc)}\n  .vigblink{animation:vigpulse 1.1s ease-in-out infinite}\n  .wdaycards{display:grid;grid-template-columns:repeat(7,1fr);gap:8px;padding:0 22px 16px}\n  .wdcard{background:var(--tile);border:1px solid var(--border-soft);border-radius:10px;padding:10px 6px;text-align:center}\n  .wdcn{font-size:12px;font-weight:600;text-transform:capitalize}.wdcdate{font-size:10px;color:var(--faint);margin-top:1px}.wdce{font-size:22px;margin:3px 0}.wsi{margin-right:3px}.wstat b{margin-top:1px}\n  .wdct{font-size:13px}.wdct span{color:var(--dim);margin-left:4px}\n  .wdcp{font-size:11px;color:var(--accent);margin-top:3px}.wdcuv{font-size:11px;color:var(--dim)}";
  function ensureCss(){if(document.getElementById('wxUiCss'))return;const s=document.createElement('style');s.id='wxUiCss';s.textContent=CSS+"\n.wemoji,.wdce,.whour .he,.wsi,.wdcp,.wdcuv,.stub .big{font-family:'Noto Color Emoji','Segoe UI Emoji','Apple Color Emoji',sans-serif}";document.head.appendChild(s);}
  function wc(code,isDay){
    const D=isDay!==0;const m={
      0:[D?'☀️':'🌙','Ciel clair'],1:[D?'🌤️':'🌙','Peu nuageux'],2:['⛅','Partiellement nuageux'],3:['☁️','Couvert'],
      45:['🌫️','Brouillard'],48:['🌫️','Brouillard givrant'],
      51:['🌦️','Bruine légère'],53:['🌦️','Bruine'],55:['🌦️','Bruine dense'],56:['🌧️','Bruine verglaçante'],57:['🌧️','Bruine verglaçante'],
      61:['🌧️','Pluie faible'],63:['🌧️','Pluie'],65:['🌧️','Pluie forte'],66:['🌧️','Pluie verglaçante'],67:['🌧️','Pluie verglaçante'],
      71:['🌨️','Neige faible'],73:['🌨️','Neige'],75:['🌨️','Neige forte'],77:['🌨️','Grains de neige'],
      80:['🌦️','Averses'],81:['🌦️','Averses'],82:['⛈️','Averses violentes'],85:['🌨️','Averses de neige'],86:['🌨️','Averses de neige'],
      95:['⛈️','Orage'],96:['⛈️','Orage + grêle'],99:['⛈️','Orage + grêle']};
    return m[code]||['❓','—'];
  }
  function getGeo(){
    return new Promise(res=>{
      if(geoCoords){res(geoCoords);return;}
      if(!navigator.geolocation){res(null);return;}
      navigator.geolocation.getCurrentPosition(
        p=>{geoCoords={lat:p.coords.latitude,lon:p.coords.longitude};res(geoCoords);},
        ()=>res(null),{timeout:8000,maximumAge:1800000});
    });
  }
  async function refresh(sdk){
    let q='';
    let cfg={};try{cfg=await sdk.config();}catch(e){}
    const geoOn=(cfg.geo!==false), hasFixed=(cfg.lat&&cfg.lon);
    if(geoOn&&!hasFixed){const g=await getGeo();if(g)q='?lat='+g.lat+'&lon='+g.lon;}
    try{const r=await fetch('/addons/meteo/api/weather'+q);data=await r.json();}catch(e){data=null;}
    try{const rv=await fetch('/addons/meteo/api/vigilance');vig=await rv.json();}catch(e){vig=null;}
    updBar();
    if(root&&document.body.contains(root))paint();
  }
  function updBar(){
    const bar=document.getElementById('wxBar');if(!bar)return;
    if(!data||!data.ok){bar.style.display='none';return;}
    bar.style.display='';
    const c=data.current,w=wc(c.code,c.is_day);
    const rain=data.rain_in===0?' · pluie':(data.rain_in!=null?' · pluie dans '+data.rain_in+'h':'');
    bar.innerHTML=w[0]+' <span class="deg">'+Math.round(c.temp)+'°</span> '+w[1]+rain;
  }
  const dDate=x=>new Date(x).toLocaleDateString('fr-FR',{day:'numeric',month:'short'});
  function weekCards(days){
    return '<div class="wdaycards">'+(days||[]).map((x,i)=>{const dw=wc(x.code,1);const dn=i===0?'Auj.':new Date(x.date).toLocaleDateString('fr-FR',{weekday:'short'});
      return '<div class="wdcard"><div class="wdcn">'+dn+'</div><div class="wdcdate">'+dDate(x.date)+'</div><div class="wdce">'+dw[0]+'</div><div class="wdct"><b>'+Math.round(x.tmax)+'°</b><span>'+Math.round(x.tmin)+'°</span></div><div class="wdcp">💧 '+(x.pop!=null?x.pop:'—')+'%</div><div class="wdcuv">☀️ UV '+(x.uv!=null?Math.round(x.uv):'—')+'</div></div>';}).join('')+'</div>';
  }
  function hourCurveSVG(hours,isDay){
    if(!hours||hours.length<2)return '';
    const W=960,H=180,padX=28,padTop=26,padBot=50;
    const temps=hours.map(x=>x.temp);
    const lo=Math.min(...temps),hi=Math.max(...temps),rng=(hi-lo)||1;
    const n=hours.length,xw=(W-2*padX)/(n-1);
    const X=i=>padX+i*xw,Y=t=>padTop+(1-(t-lo)/rng)*(H-padTop-padBot);
    const pts=hours.map((x,i)=>X(i).toFixed(1)+','+Y(x.temp).toFixed(1)).join(' ');
    let g='';
    hours.forEach((x,i)=>{const hw=wc(x.code,isDay);
      g+='<circle cx="'+X(i).toFixed(1)+'" cy="'+Y(x.temp).toFixed(1)+'" r="3" fill="var(--accent)"/>'+
         '<text x="'+X(i).toFixed(1)+'" y="'+(Y(x.temp)-8).toFixed(1)+'" text-anchor="middle" font-size="11" font-weight="600" fill="var(--text)">'+Math.round(x.temp)+'°</text>'+
         '<text x="'+X(i).toFixed(1)+'" y="'+(H-26)+'" text-anchor="middle" font-size="15">'+hw[0]+'</text>'+
         '<text x="'+X(i).toFixed(1)+'" y="'+(H-8)+'" text-anchor="middle" font-size="10" fill="var(--dim)">'+x.time.slice(11,13)+'h</text>';});
    return '<div style="padding:0 22px 12px"><svg viewBox="0 0 '+W+' '+H+'" style="width:100%;height:auto"><polyline points="'+pts+'" fill="none" stroke="var(--accent)" stroke-width="2"/>'+g+'</svg></div>';
  }
  function paint(){
    const el=root;if(!el||!document.body.contains(el))return;
    const d=data||{ok:false,reason:'chargement impossible'};
    if(!d.ok){el.innerHTML='<div class="stub"><div class="big">🌧️</div><div class="t1">Météo indisponible</div><div class="t2">'+(d.reason||'')+' — vérifie la connexion et la position dans ⚙ Météo.</div><button class="btnpill install" id="wxRetry" style="margin-top:14px">↻ Actualiser</button></div>';
      const rb=document.getElementById('wxRetry');if(rb)rb.addEventListener('click',()=>refresh(S));return;}
    const c=d.current,w=wc(c.code,c.is_day);
    const uvLvl=uv=>uv==null?'':(uv<3?'faible':uv<6?'modéré':uv<8?'élevé':uv<11?'très élevé':'extrême');
    const rain=d.rain_in===0?'en cours':(d.rain_in!=null?'dans '+d.rain_in+' h':'aucune');
    let h='';
    if(vig&&vig.ok){
      const vc={1:'var(--green)',2:'var(--warn)',3:'#e8853a',4:'var(--bad)'}[vig.level]||'var(--dim)';
      const active=vig.level>=2;
      h+='<div class="vigbar'+(active?' vigblink':'')+'" style="--vc:'+vc+'">🚨 <b>'+(vig.dept_name||('dépt '+vig.dept))+'</b> · Vigilance '+vig.color+' — <span style="color:var(--dim)">'+vig.label+'</span></div>';
    }
    const air=d.air||{};
    const polList=[['grass_pollen','Graminées'],['birch_pollen','Bouleau'],['alder_pollen','Aulne'],['ragweed_pollen','Ambroisie'],['olive_pollen','Olivier'],['mugwort_pollen','Armoise']].filter(p=>(air[p[0]]||0)>0);
    const plvl=v=>v<10?'faible':v<40?'modéré':'élevé';
    h+='<div class="wgrid"><div class="wleft">'+
         '<div class="wtop"><div class="wemoji">'+w[0]+'</div><div class="wtemp">'+Math.round(c.temp)+'°</div></div>'+
         '<div class="wcity">'+d.ville+'</div><div class="wcond">'+w[1]+' · ressenti '+Math.round(c.feels)+'°</div>'+
       '</div><div class="wright">'+
         '<div class="wrstats">'+
           '<div class="wstat"><span class="wsi">💨</span>Vent<b>'+Math.round(c.wind)+' km/h</b></div>'+
           '<div class="wstat"><span class="wsi">🌬️</span>Rafales<b>'+Math.round(c.gust)+' km/h</b></div>'+
           '<div class="wstat"><span class="wsi">☀️</span>UV<b>'+(c.uv!=null?c.uv+' ('+uvLvl(c.uv)+')':'—')+'</b></div>'+
           '<div class="wstat"><span class="wsi">💧</span>Humidité<b>'+c.humidity+' %</b></div>'+
           '<div class="wstat"><span class="wsi">🌧️</span>Pluie<b>'+rain+'</b></div>'+
         '</div>'+
         (polList.length?('<div class="wpollen" style="padding:0">'+polList.map(p=>'<div class="wpill">🌿 '+p[1]+' · <b>'+plvl(air[p[0]])+'</b></div>').join('')+'</div>'):'')+
       '</div></div>';
    h+='<div class="wsec">Heure par heure <span class="wtoggle"><span class="wch'+(hourMode==='cards'?' on':'')+'" data-hour="cards">Cartes</span><span class="wch'+(hourMode==='curve'?' on':'')+'" data-hour="curve">Courbe</span></span></div>';
    if(hourMode==='curve'){h+=hourCurveSVG(d.hours,c.is_day);}
    else{h+='<div class="whours">'+d.hours.map(x=>{const hw=wc(x.code,c.is_day);return '<div class="whour"><div class="ht">'+x.time.slice(11,13)+'h</div><div class="he">'+hw[0]+'</div><div>'+Math.round(x.temp)+'°</div><div class="hp">'+(x.pop!=null?x.pop+'%':'')+'</div></div>';}).join('')+'</div>';}
    h+='<div class="wsec">7 jours</div>'+weekCards(d.days);
    h+='<div class="wsrc">Données : Open-Meteo (prévisions, UV, pollens) · Vigilance Météo-France · vue embarquée v0.19.0</div>';
    el.innerHTML=h;
    el.querySelectorAll('[data-hour]').forEach(x=>x.addEventListener('click',()=>{hourMode=x.dataset.hour;paint();}));
  }
  async function render(el,sdk,a){
    S=sdk;bgSdk=bgSdk||sdk;root=el;tile=a||tile;ensureCss();
    if(data)paint();else el.innerHTML='<div class="stub"><div class="t2">Chargement de la météo…</div></div>';
    await refresh(sdk);
  }
  function background(sdk){
    bgSdk=sdk;ensureCss();
    if(bgTimer)clearInterval(bgTimer);        // idempotent
    refresh(sdk);
    bgTimer=setInterval(()=>refresh(bgSdk),900000);
  }
  function unmount(){root=null;}              // bandeau + timer conservés
  return { render, background, unmount };
})();
