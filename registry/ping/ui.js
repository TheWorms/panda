/* Ping — témoin du chargeur backend, porté au contrat Phase 3 (SDK v1). */
window.PandaAddons = window.PandaAddons || {};
window.PandaAddons.ping = {
  async render(el, sdk) {
    el.innerHTML = '<div class="stub"><div class="big">🛰️</div>' +
      '<div class="t1">Ping — témoin backend</div>' +
      '<div class="t2" id="pingOut">Appel de /addons/ping/api/ping…</div></div>';
    try {
      const r = await sdk.api('/ping');
      const d = await r.json();
      const o = document.getElementById('pingOut');
      if (o) o.innerHTML = d && d.pong
        ? 'pong ✓ · addon <b>' + d.addon + '</b> · ' + d.hits + ' appel(s) · clés config : ' + ((d.config_keys || []).join(', ') || '(aucune)')
        : 'réponse inattendue';
    } catch (e) {
      const o = document.getElementById('pingOut');
      if (o) o.textContent = 'backend injoignable';
    }
  }
};
