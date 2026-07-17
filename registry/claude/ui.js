/* claude — stub porté au contrat Phase 3 (SDK v1). Sans backend. */
window.PandaAddons = window.PandaAddons || {};
window.PandaAddons.claude = {
  render(el, sdk, tile) {
    const t = tile || {};
    el.innerHTML = '<div class="stub"><div class="big">' + (t.ic || t.icon || '🧩') + '</div>' +
      '<div class="t1">' + (t.nm || t.name || 'claude') + '</div>' +
      '<div class="t2">Tuile en attente d\'implémentation — sans backend pour l\'instant.</div></div>';
  }
};
