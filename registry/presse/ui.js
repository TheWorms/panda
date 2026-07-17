/* Presse — stub extrait du noyau, porté au contrat Phase 3 (SDK v1).
   Aucun backend, aucun réseau : la tuile garde son rendu d'attente, mais
   respecte désormais le vrai contrat window.PandaAddons.<id>.render(). */
window.PandaAddons = window.PandaAddons || {};
window.PandaAddons.presse = {
  render(el, sdk, tile) {
    const t = tile || {};
    el.innerHTML = '<div class="stub"><div class="big">' + (t.ic || t.icon || '📰') + '</div>' +
      '<div class="t1">' + (t.nm || t.name || 'Presse') + '</div>' +
      '<div class="t2">Tuile en attente d\'implémentation — extraite du noyau, sans backend pour l\'instant.</div></div>';
  }
};
