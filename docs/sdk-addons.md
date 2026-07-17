# SDK addons — contrat kiosk_api 1.x (résumé)

Un addon est un dossier contenant :

- `manifest.json` — identité, version, `kiosk_api: "^1.3"`, catégorie
  (Maison, Quotidien, Services, Médias, Outils), entrée UI, backend éventuel,
  dépendances d'installation (`requires`)
- `ui.js` — expose `window.PandaAddons.<id> = { render(el, sdk, tile),
  configPanel?, background?, unmount? }` ; le CSS est embarqué dans un
  `<style id="…">` injecté par le module
- `backend.py` — optionnel ; monté par le socle sous `/addons/<id>/api/*`

Le `sdk` reçu par `render` fournit notamment : `api()` (backend de l'addon),
`store.load()/save()` (état JSON persistant ≤ 64 Ko), `config()`,
`toast()`, `notify()`, `ic()`, `rel()` (fichiers du dossier de l'addon,
servis sur `/addons/<id>/ui/<fichier>`).

Le contrat est **gelé** : le socle n'évolue qu'en ajoutant (jamais en
retirant), avec incrément du mineur (`1.3 → 1.4`). Un addon `^1.3`
fonctionne sur tout socle 1.x ≥ 1.3.

Format de publication et exemple complet : voir le dépôt Abeille.
