/* Calculatrice — porté au contrat Phase 3 (SDK v1). Aucun backend, aucun réseau.
   L'état (expr/hist) est conservé entre ouvertures, comme avant l'extraction. */
window.PandaAddons = window.PandaAddons || {};
window.PandaAddons.calculatrice = (function () {
  let expr = '', hist = '';
  function safeEval(e) {
    if (!/^[0-9+\-*/.()%\s]+$/.test(e)) throw new Error('caractère invalide');
    const r = Function('"use strict";return (' + e.replace(/%/g, '/100') + ')')();
    if (typeof r !== 'number' || !isFinite(r)) throw new Error('résultat invalide');
    return r;
  }
  function render(el) {
    const K = [['C', 'fn'], ['(', 'fn'], [')', 'fn'], ['÷', 'op'],
      ['7', ''], ['8', ''], ['9', ''], ['×', 'op'],
      ['4', ''], ['5', ''], ['6', ''], ['−', 'op'],
      ['1', ''], ['2', ''], ['3', ''], ['+', 'op'],
      ['%', 'fn'], ['0', ''], [',', ''], ['=', 'eq']];
    el.innerHTML = '<div class="cawrap"><div class="cadisp"><div class="cahist">' + hist + '</div>' +
      '<div class="cares">' + (expr || '0').replace(/\*/g, '×').replace(/\//g, '÷').replace(/-/g, '−') + '</div></div>' +
      '<div class="cagrid">' + K.map(k => '<div class="cabtn ' + k[1] + '" data-k="' + k[0] + '">' + k[0] + '</div>').join('') +
      '<div class="cabtn fn" data-k="⌫" style="grid-column:span 4">⌫ Effacer</div></div></div>';
    el.querySelectorAll('[data-k]').forEach(b => b.addEventListener('click', () => {
      const k = b.dataset.k;
      if (k === 'C') { expr = ''; hist = ''; }
      else if (k === '⌫') expr = expr.slice(0, -1);
      else if (k === '=') {
        try {
          const r = safeEval(expr);
          hist = expr.replace(/\*/g, '×').replace(/\//g, '÷') + ' =';
          expr = String(Math.round(r * 1e10) / 1e10);
        } catch (e) { hist = 'erreur'; }
      }
      else if (k === '÷') expr += '/';
      else if (k === '×') expr += '*';
      else if (k === '−') expr += '-';
      else if (k === ',') expr += '.';
      else expr += k;
      render(el);
    }));
  }
  const CSS = ".cawrap{display:flex;flex-direction:column;align-items:center;padding-top:6px}\n.cagrid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;width:420px}\n.cabtn{height:58px;border-radius:12px;border:1px solid var(--border-soft);background:var(--tile);color:var(--text);\n         font-size:20px;font-weight:600;display:flex;align-items:center;justify-content:center;cursor:pointer;user-select:none}\n.cabtn:active{background:var(--accent-tint);border-color:var(--accent)}\n.cabtn.op{color:var(--accent)}\n.cabtn.eq{background:var(--accent);color:#fff;border-color:var(--accent)}\n.cabtn.fn{font-size:15px;color:var(--dim)}\n.cadisp{background:var(--tile);border:1px solid var(--border-soft);border-radius:12px;padding:14px 18px;\n          margin-bottom:12px;width:420px;text-align:right}\n.cahist{font-size:12px;color:var(--faint);min-height:16px;font-variant-numeric:tabular-nums}\n.cares{font-size:34px;font-weight:700;font-variant-numeric:tabular-nums;overflow:hidden;text-overflow:ellipsis}";
  function ensureCss() { if (document.getElementById('caUiCss')) return; const s = document.createElement('style'); s.id = 'caUiCss'; s.textContent = CSS; document.head.appendChild(s); }
  return {
    render(el) { ensureCss(); render(el); }
  };
})();
