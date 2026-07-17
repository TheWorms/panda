/* Radio — interface embarquée (contrat Phase 3, crash-test n°3).
   Défi : la lecture audio survit à la fermeture de la vue (barre #rdBar
   persistante). L'élément <audio> et l'état courant vivent donc dans le
   hook background(), pas dans la vue : render() ne fait que piloter.
   Favoris via sdk.store (reprise one-shot de state.radioFav). */
window.PandaAddons = window.PandaAddons || {};
window.PandaAddons.radio = (function () {
  let S = null, root = null, tile = null, bgSdk = null;
  let audio = null, current = null;
  let tab = 'stations', query = '';
  let favs = null, favsLoaded = false;

  const CSS = ".rdstar{margin-left:auto;font-size:16px;flex:none;padding:2px 4px;border-radius:6px;color:var(--faint)}\n.rdstar.fav{color:var(--warn)}\n.rdstar:active{background:var(--accent-tint)}\n.rdtabs{display:flex;gap:6px;margin-bottom:10px}\n.rdgrid{display:grid;grid-template-columns:repeat(3,1fr);gap:9px}\n.rdcard{display:flex;align-items:center;gap:10px;background:var(--tile);border:1px solid var(--border-soft);\n          border-radius:11px;padding:10px 12px;cursor:pointer;min-height:58px}\n.rdcard:active,.rdcard.on{border-color:var(--accent);background:var(--accent-tint)}\n.rdlogo{width:34px;height:34px;border-radius:8px;background:var(--bg);flex:none;display:flex;\n          align-items:center;justify-content:center;font-size:16px;overflow:hidden}\n.rdlogo img{width:100%;height:100%;object-fit:contain}\n.rdn{font-weight:600;font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}\n.rdm{font-size:10px;color:var(--faint)}\n.rdplayer{display:flex;align-items:center;gap:14px;background:var(--tile);border:1px solid var(--accent);\n            border-radius:12px;padding:12px 16px;margin-bottom:12px}";
  function ensureCss() {
    if (document.getElementById('rdUiCss')) return;
    const st = document.createElement('style');
    st.id = 'rdUiCss'; st.textContent = CSS;
    document.head.appendChild(st);
  }

  async function loadFavs(sdk) {
    if (favsLoaded) return;
    const st = await sdk.store.load();
    favs = st.radioFav || null;
    if (!favs && typeof window.state === 'object' && window.state && window.state.radioFav) {
      favs = JSON.parse(JSON.stringify(window.state.radioFav));
      await sdk.store.save({ radioFav: favs });
    }
    favs = favs || [];
    favsLoaded = true;
  }
  function saveFavs(sdk) { sdk.store.save({ radioFav: favs }); }
  const isFav = uuid => (favs || []).some(x => x.uuid === uuid);
  function toggleFav(st, sdk) {
    favs = favs || [];
    const i = favs.findIndex(x => x.uuid === st.uuid);
    if (i >= 0) favs.splice(i, 1);
    else favs.push({ uuid: st.uuid, name: st.name, url: st.url, favicon: st.favicon,
      country: st.country, codec: st.codec, bitrate: st.bitrate, tags: st.tags || [] });
    saveFavs(sdk);
  }

  function updBar() {
    const bar = document.getElementById('rdBar'); if (!bar) return;
    if (!current || !audio) { bar.style.display = 'none'; bar.onclick = null; return; }
    bar.style.display = 'inline-flex';
    bar.innerHTML = '<span class="rdpulse"></span>📻<span class="rdmarq"><span>' + current.name + ' — en écoute</span></span>';
    bar.onclick = () => (bgSdk || S).open();
  }
  function play(st) {
    if (audio) { audio.pause(); audio = null; }
    try {
      audio = new Audio(st.url);
      audio.play().catch(e => { const er = document.getElementById('rdErr'); if (er) er.textContent = 'Lecture impossible : ' + e.message; });
      current = st;
    } catch (e) { current = null; }
    updBar();
    if (root && document.body.contains(root)) paint();
  }
  function stop() {
    if (audio) { audio.pause(); audio = null; }
    current = null; updBar();
    if (root && document.body.contains(root)) paint();
  }

  async function render(el, sdk, a) {
    S = sdk; bgSdk = bgSdk || sdk; root = el; tile = a || tile;
    ensureCss();
    await loadFavs(sdk);
    let cfg = await sdk.config();
    let d = null;
    if (tab === 'favoris') { d = { ok: true, stations: favs }; }
    else {
      try {
        const r = await sdk.api('/search?country=' + encodeURIComponent(cfg.country || 'France') +
          '&tag=' + encodeURIComponent(cfg.tag || '') + '&q=' + encodeURIComponent(query));
        d = await r.json();
      } catch (e) { d = { ok: false, reason: 'serveur injoignable' }; }
    }
    paint(d);
  }
  function paint(d) {
    const el = root; if (!el || !document.body.contains(el)) return;
    if (d) el._rd = d; else d = el._rd;
    if (!d) return;
    let h = '';
    if (current) {
      h += '<div class="rdplayer"><div class="rdlogo">' + (current.favicon ? '<img src="' + current.favicon + '" onerror="this.parentNode.textContent=&quot;📻&quot;">' : '📻') + '</div>' +
        '<div style="min-width:0"><div class="rdn">' + current.name + '</div>' +
        '<div class="rdm">' + (current.country || '') + ' · ' + (current.codec || '') + ' ' + (current.bitrate || '') + ' kbps</div></div>' +
        '<button class="wch" id="rdStopBtn" style="margin-left:auto">⏹ Arrêter</button></div>';
    }
    h += '<div class="rdtabs"><span class="wch' + (tab === 'stations' ? ' on' : '') + '" data-rdt="stations">Stations</span>' +
      '<span class="wch' + (tab === 'favoris' ? ' on' : '') + '" data-rdt="favoris">⭐ Favoris (' + (favs || []).length + ')</span></div>';
    if (tab === 'stations') {
      h += '<div class="koadd"><input id="rdQ" placeholder="Rechercher une station…" value="' + S.esc(query) + '" autocomplete="off">' +
        '<button id="rdGo">Chercher</button></div>';
    }
    h += '<div class="kotoast" id="rdErr"></div>';
    if (!d || !d.ok) {
      h += '<div class="stub"><div class="big">📻</div><div class="t1">Radio</div><div class="t2">' + ((d && d.reason) || '') + '<br>Les stations proviennent de radio-browser.info (aucune clé requise).</div></div>';
    } else if (!d.stations.length) {
      h += '<div class="stub"><div class="big">' + (tab === 'favoris' ? '⭐' : '📻') + '</div><div class="t2">' +
        (tab === 'favoris' ? 'Aucun favori — touche l\'étoile d\'une station pour l\'ajouter' : 'Aucune station trouvée') + '</div></div>';
    } else {
      h += '<div class="rdgrid">' + d.stations.map(st => '<div class="rdcard' + (current && current.uuid === st.uuid ? ' on' : '') + '" data-uuid="' + st.uuid + '">' +
        '<div class="rdlogo">' + (st.favicon ? '<img src="' + st.favicon + '" onerror="this.parentNode.textContent=&quot;📻&quot;">' : '📻') + '</div>' +
        '<div style="min-width:0"><div class="rdn">' + st.name + '</div>' +
        '<div class="rdm">' + ((st.tags || []).filter(Boolean).slice(0, 2).join(' · ') || st.country || '') + '</div></div>' +
        '<span class="rdstar' + (isFav(st.uuid) ? ' fav' : '') + '" data-fav="' + st.uuid + '">\u2605\uFE0E</span></div>').join('') + '</div>';
      h += '<div class="wsrc">Stations : radio-browser.info · lecture sur la sortie audio du kiosk · vue embarquée v0.2.0</div>';
    }
    el.innerHTML = h;
    el.querySelectorAll('[data-rdt]').forEach(t => t.addEventListener('click', () => { tab = t.dataset.rdt; render(el, S, tile); }));
    const sb = document.getElementById('rdStopBtn'); if (sb) sb.addEventListener('click', () => stop());
    const qi = document.getElementById('rdQ');
    if (qi) {
      const go = () => { query = (qi.value || '').trim(); S.vk.close(); render(el, S, tile); };
      document.getElementById('rdGo').addEventListener('click', go);
      qi.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
    }
    if (d && d.ok) {
      el.querySelectorAll('[data-fav]').forEach(sti => sti.addEventListener('click', ev => {
        ev.stopPropagation();
        const st = d.stations.find(x => x.uuid === sti.dataset.fav); if (!st) return;
        toggleFav(st, S); render(el, S, tile);
      }));
      el.querySelectorAll('[data-uuid]').forEach(c => c.addEventListener('click', () => {
        const st = d.stations.find(x => x.uuid === c.dataset.uuid); if (st) play(st);
      }));
    }
  }

  function background(sdk) { bgSdk = sdk; updBar(); }
  function unmount() { root = null; }   // audio et current conservés : lecture persistante

  return { render, background, unmount };
})();
