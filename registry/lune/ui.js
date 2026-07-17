/* Lune — éphémérides IMCCE/local (Phase 3, lot D final). Embarque aussi les
   règles td* (liste des éclipses) que la migration de marée avait sorties du
   noyau — répare l'affichage des éclipses cassé depuis le 0.99.55. */
window.PandaAddons = window.PandaAddons || {};
window.PandaAddons.lune = (function () {
  let S=null, root=null, tile=null;
  let data=null, tab='today', days=null, year=null;
  const CSS = "  .mngrid{display:flex;gap:20px;padding:16px 22px 8px;align-items:center}\n  .mnvis{flex:0 0 190px;display:flex;flex-direction:column;align-items:center;gap:8px}\n  .mnname{font-size:15px;font-weight:600;text-align:center}\n  .mnsub{font-size:12px;color:var(--dim)}\n  .mncol{flex:1;display:grid;grid-template-columns:repeat(2,1fr);gap:8px}\n  .mnrow{display:flex;align-items:center;gap:10px;background:var(--tile);border:1px solid var(--border-soft);border-radius:10px;padding:9px 13px}\n  .mnrow .k{font-size:12px;color:var(--dim)}\n  .mnrow .v{margin-left:auto;font-weight:600;font-size:13.5px;font-variant-numeric:tabular-nums}\n  .mncal{display:grid;grid-template-columns:repeat(10,1fr);gap:6px;padding:0 22px 12px}\n  .mncal.week{grid-template-columns:repeat(7,1fr);gap:8px}\n  .mncell{background:var(--tile);border:1px solid var(--border-soft);border-radius:9px;padding:7px 3px;text-align:center}\n  .mcd{font-size:10px;color:var(--dim);text-transform:capitalize}\n  .mcn{font-size:9.5px;color:var(--faint)}\n  .mci{font-size:19px;margin:2px 0}\n  .mcp{font-size:10px;color:var(--accent);font-variant-numeric:tabular-nums}\n  .mnyear{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;padding:0 22px 14px}\n  .mycard{background:var(--tile);border:1px solid var(--border-soft);border-radius:10px;padding:8px}\n  .myh{font-size:11.5px;font-weight:600;margin-bottom:4px;color:var(--dim)}\n  .myrow{display:flex;align-items:center;gap:6px;font-size:10.5px;padding:1px 0}\n  .myl{color:var(--dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}\n  .myd{margin-left:auto;font-variant-numeric:tabular-nums;font-weight:600}\n.tdlist{display:grid;grid-template-columns:1fr;gap:8px;padding:0 22px 12px}\n.tdrow{display:flex;align-items:center;gap:12px;background:var(--tile);border:1px solid var(--border-soft);border-left:4px solid var(--accent);border-radius:10px;padding:9px 13px}\n.tdrow.bm{border-left-color:var(--warn)}\n.tdtag{font-family:var(--mono);font-size:10.5px;font-weight:700;padding:3px 8px;border-radius:6px;background:var(--accent-tint);color:var(--accent)}\n.tdrow.bm .tdtag{background:rgba(240,180,41,.15);color:var(--warn)}\n.tdtime{font-size:17px;font-weight:600;font-variant-numeric:tabular-nums}\n.tdinfo{margin-left:auto;text-align:right;font-size:12px;color:var(--dim)}\n.tdinfo b{display:block;font-size:14px;color:var(--text)}\n.tdlabel{margin-left:14px;font-size:12.5px;color:var(--dim)}\n.tdcol .tdlist{grid-template-columns:1fr;padding:0}";
  function ensureCss(){if(document.getElementById('mnUiCss'))return;const s=document.createElement('style');s.id='mnUiCss';s.textContent=CSS;document.head.appendChild(s);}
  function moonSVG(illum,waxing){
    const R=70,C=80,k=Math.max(0,Math.min(1,illum/100));
    const rx=Math.abs(1-2*k)*R;
    const litRight=waxing;
    const sweepOuter=litRight?1:0, sweepInner=(k<0.5)===litRight?0:1;
    const lit='<path d="M '+C+' '+(C-R)+' A '+R+' '+R+' 0 0 '+sweepOuter+' '+C+' '+(C+R)+
              ' A '+rx.toFixed(1)+' '+R+' 0 0 '+sweepInner+' '+C+' '+(C-R)+' Z" fill="#f2e9c8"/>';
    return '<svg viewBox="0 0 160 160" style="width:150px;height:150px">'+
      '<circle cx="'+C+'" cy="'+C+'" r="'+R+'" fill="#22262b" stroke="var(--border-soft)"/>'+
      (k>0.995?'<circle cx="'+C+'" cy="'+C+'" r="'+R+'" fill="#f2e9c8"/>':(k<0.005?'':lit))+'</svg>';
  }
  const fmtDT=iso=>{if(!iso)return '—';const d=new Date(iso);
    return d.toLocaleDateString('fr-FR',{day:'numeric',month:'short'})+' '+d.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'});};
  const fmtT=iso=>{if(!iso)return '—';return new Date(iso).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'});};
  async function refresh(){
    try{const r=await S.api('/moon');data=await r.json();}
    catch(e){data={ok:false,reason:'serveur injoignable'};}
    days=null;paint();extra();
  }
  async function extra(){
    if(tab==='today'&&!days){
      try{const r=await S.api('/moon/days?n=7');const j=await r.json();days=j.days;}catch(e){days=[];}
      paint();return;
    }
    if(tab==='week'||tab==='month'){
      const n=tab==='week'?7:30;
      try{const r=await S.api('/moon/days?n='+n);const j=await r.json();days=j.days;}catch(e){days=[];}
      paint();
    }else if(tab==='year'&&!year){
      try{const r=await S.api('/moon/year');year=await r.json();}catch(e){year={year:'',phases:[]};}
      paint();
    }
  }
  function paint(){
    const el=root;if(!el||!document.body.contains(el))return;
    const d=data||{ok:false,reason:'chargement impossible'};
    if(!d.ok){el.innerHTML='<div class="stub"><div class="big">🌙</div><div class="t1">Éphémérides indisponibles</div><div class="t2">'+(d.reason||'')+'</div><button class="btnpill install" id="mnRetry" style="margin-top:14px">↻ Actualiser</button></div>';
      const rb=document.getElementById('mnRetry');if(rb)rb.addEventListener('click',refresh);return;}
    const tabs=[['today','Aujourd\'hui'],['week','Semaine'],['month','Mois'],['year','Année']];
    let h='<div class="wsec">Lune <span class="wtoggle">'+tabs.map(t=>'<span class="wch'+(tab===t[0]?' on':'')+'" data-mn="'+t[0]+'">'+t[1]+'</span>').join('')+'</span></div>';
    if(tab==='today'){
      h+='<div class="mngrid"><div class="mnvis">'+moonSVG(d.illumination,d.waxing)+
        '<div class="mnname">'+d.icon+' '+d.name+'</div><div class="mnsub">'+(d.waxing?'croissante':'décroissante')+'</div></div>'+
        '<div class="mncol">'+
          '<div class="mnrow"><span class="k">Illumination</span><span class="v">'+d.illumination+' %</span></div>'+
          '<div class="mnrow"><span class="k">Âge</span><span class="v">'+d.age+' j</span></div>'+
          '<div class="mnrow"><span class="k">🌙 Lever</span><span class="v">'+fmtT(d.moonrise)+'</span></div>'+
          '<div class="mnrow"><span class="k">🌙 Coucher</span><span class="v">'+fmtT(d.moonset)+'</span></div>'+
          '<div class="mnrow"><span class="k">☀️ Lever</span><span class="v">'+fmtT(d.sunrise)+'</span></div>'+
          '<div class="mnrow"><span class="k">☀️ Coucher</span><span class="v">'+fmtT(d.sunset)+'</span></div>'+
          '<div class="mnrow"><span class="k">🌑 Nouvelle lune</span><span class="v">'+fmtDT(d.next_new)+'</span></div>'+
          '<div class="mnrow"><span class="k">🌕 Pleine lune</span><span class="v">'+fmtDT(d.next_full)+'</span></div>'+
        '</div></div>';
      h+='<div class="wsec">Semaine</div>';
      if(!days)h+='<div class="wpollen"><div class="wpill">Chargement…</div></div>';
      else h+='<div class="mncal week">'+days.slice(0,7).map(x=>{const dt=new Date(x.date+'T12:00:00');
        return '<div class="mncell"><div class="mcd">'+dt.toLocaleDateString('fr-FR',{weekday:'short'})+'</div>'+
               '<div class="mcn">'+dt.getDate()+'/'+(dt.getMonth()+1)+'</div>'+
               '<div class="mci">'+x.icon+'</div><div class="mcp">'+Math.round(x.illumination)+'%</div></div>';}).join('')+'</div>';
    }else if(tab==='week'||tab==='month'){
      if(!days){h+='<div class="wpollen"><div class="wpill">Chargement…</div></div>';}
      else{
        const cls=tab==='week'?'mncal week':'mncal';
        h+='<div class="'+cls+'">'+days.map(x=>{
          const dt=new Date(x.date+'T12:00:00');
          return '<div class="mncell"><div class="mcd">'+dt.toLocaleDateString('fr-FR',{weekday:'short'})+'</div>'+
                 '<div class="mcn">'+dt.getDate()+'/'+(dt.getMonth()+1)+'</div>'+
                 '<div class="mci">'+x.icon+'</div><div class="mcp">'+Math.round(x.illumination)+'%</div></div>';}).join('')+'</div>';
      }
    }else{
      if(!year){h+='<div class="wpollen"><div class="wpill">Chargement…</div></div>';}
      else{
        if(year.eclipses&&year.eclipses.length){
          h+='<div class="wsec">Éclipses '+year.year+'</div><div class="tdlist" style="grid-template-columns:1fr 1fr">'+
            year.eclipses.map(e=>{const dd=new Date(e.date);
              return '<div class="tdrow'+(e.kind==='solaire'?' bm':'')+'"><span class="tdtag">'+e.icon+'</span>'+
                     '<span class="tdtime">'+dd.toLocaleDateString('fr-FR',{day:'numeric',month:'short'})+'</span>'+
                     '<span class="tdlabel">Éclipse '+e.kind+' '+e.type+'</span>'+
                     '<span class="tdinfo"><b>'+dd.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})+'</b></span></div>';}).join('')+'</div>';
        }
        const byMonth={};
        year.phases.forEach(p=>{const mm=new Date(p.date).getMonth();(byMonth[mm]=byMonth[mm]||[]).push(p);});
        const MN=['Janv','Févr','Mars','Avril','Mai','Juin','Juil','Août','Sept','Oct','Nov','Déc'];
        h+='<div class="mnyear">'+MN.map((nm,i)=>'<div class="mycard"><div class="myh">'+nm+' '+year.year+'</div>'+
          ((byMonth[i]||[]).map(p=>'<div class="myrow"><span>'+p.icon+'</span><span class="myl">'+p.label+'</span><span class="myd">'+new Date(p.date).toLocaleDateString('fr-FR',{day:'numeric'})+'</span></div>').join('')||'<div class="myrow" style="color:var(--faint)">—</div>')+'</div>').join('')+'</div>';
      }
    }
    const src=(tab==='year'&&year&&year.source)?year.source:(d.source||'local');
    h+='<div class="wsrc">'+(src==='imcce'
      ?'Phases & éclipses : IMCCE / Observatoire de Paris (opale.imcce.fr) · illumination, lever/coucher : calcul local'
      :'Éphémérides : calcul local (IMCCE injoignable — repli automatique)')+' · vue embarquée v0.20.0</div>';
    el.innerHTML=h;
    el.querySelectorAll('[data-mn]').forEach(x=>x.addEventListener('click',()=>{tab=x.dataset.mn;paint();extra();}));
  }
  async function render(el,sdk,a){
    S=sdk;root=el;tile=a||tile;ensureCss();
    el.innerHTML='<div class="stub"><div class="t2">Calcul des éphémérides…</div></div>';
    await refresh();
  }
  return { render };
})();
