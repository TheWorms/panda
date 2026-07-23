# Mise à jour de Panda — modèle de confiance et procédure

Panda peut se mettre à jour lui-même depuis l'interface admin
(**⚙ Réglages → Version → ⬆ Mettre à jour**). Cette page explique ce que la
mise à jour garantit, comment elle fonctionne, comment l'installer sur une
machine, et comment un mainteneur publie une release signée.

## Ce que la mise à jour garantit

Une release de code est authentifiée **exactement comme le store d'addons** :
signature **Ed25519** de la clé privée du mainteneur, clé publique **embarquée
dans le socle**, empreinte **SHA-256** de l'archive.

La chaîne complète : *`release.json` signé → empreinte authentifiée → archive
vérifiée avant extraction*. Conséquence : même si l'hébergement GitHub était
compromis, un attaquant ne pourrait pas faire installer un code modifié — il ne
possède pas la clé privée, donc ne peut ni forger `release.json`, ni altérer
l'archive sans invalider son empreinte.

La clé des releases est **distincte** de celle du store (`STORE_OFFICIAL_PUBKEY`) :
compromettre l'une n'entame pas l'autre. La confiance « code exécuté en root »
et la confiance « addons du store » restent séparées.

## Comment ça marche

**Côté interface** (`static/panda.js`, `secVersion()`) : au chargement, un appel
`GET /api/system/selfupdate` compare la version installée à la dernière release
signée. Le bouton **⬆ Mettre à jour** n'apparaît que si une version plus récente
existe **et** que l'outil `panda-update` est présent sur la machine. Au clic :
confirmation, `POST /api/system/selfupdate`, puis rechargement automatique quand
le service revient.

**Côté serveur** (`app.py`) : les deux routes sont protégées par `@require_auth`
+ `@require_admin`. La vérification lit la version depuis `release.json`
(téléchargé et **signature vérifiée**), pas une lecture brute du code :
l'interface et l'outil parlent de la même version, elle-même prouvée.
L'application lance l'outil de façon détachée (il survit au redémarrage du
service qu'il provoque) :

    sudo -n /usr/local/bin/panda-update

**L'outil** (`install/panda-update`, exécuté **en root** via un sudoers dédié) :

1. **Verrou** (`flock` sur `/run/panda-update.lock`) — un second lancement est refusé.
2. **Journalisation** sur stdout (→ journald) et `/var/log/panda-update.log`.
3. **Téléchargement** de `release.json`, `release.json.sig` et `panda.zip`
   (HTTPS, TLS vérifié, timeouts explicites).
4. **Vérification** de la signature de `release.json`, puis du SHA-256 de
   l'archive — **avant toute écriture**. Tout échec = abandon, aucun fichier
   touché, code de sortie non nul.
5. **Refus de downgrade** (version ≤ installée). Échappement de secours :
   `PANDA_ALLOW_DOWNGRADE=1`.
6. **Sauvegarde** du code courant dans `/var/backups/panda/panda-<version>-<horodatage>.tar.gz`
   (les 5 dernières sont conservées).
7. **Bascule atomique** : extraction défensive (anti zip-slip, refus des liens
   symboliques) dans un dossier temporaire sur le même système de fichiers,
   validation (`app.py` présent, version cohérente avec `release.json`), puis
   remplacement par renommages atomiques. Seul le **code** est remplacé ;
   `config.json`, `data/`, `addons/` et `venv/` sont préservés — leur présence
   est revérifiée après bascule.
8. **Dépendances** : réinstallées dans le venv existant **seulement si**
   `requirements.txt` a changé.
9. **Redémarrage** du service `panda`, puis validation que `/healthz` répond
   `status: ok` **à la nouvelle version** (30 s de polling).
10. **Rollback automatique** si l'étape 9 échoue : la sauvegarde est restaurée,
    le service redémarré, l'outil sort en erreur. Une mise à jour ratée ne
    laisse jamais un kiosk mort.

### Périmètre remplacé

| Chemin | Sort |
|---|---|
| `app.py`, `registry.py`, `addon_backends.py`, `requirements.txt` | remplacé |
| `static/`, `registry/` | remplacé |
| `config.json`, `data/`, `addons/`, `venv/` | **préservé** |

L'archive ne contient **que** le code : les chemins préservés ne peuvent pas
être écrasés par construction.

## Sécurité

- **Interpréteur** : l'outil tourne sous `/usr/bin/python3` (root), **jamais**
  sous le venv de l'application. Le venv appartient à l'utilisateur applicatif ;
  l'exécuter en root serait une élévation de privilèges triviale. La seule
  dépendance root est `python3-cryptography` (paquet système).
- **Permissions** : `/usr/local/bin/panda-update` est `root:root`, mode `0755`,
  non modifiable par l'utilisateur applicatif ni par le service Flask.
- **Sudoers** : `/etc/sudoers.d/panda-update` (mode `0440`, validé par
  `visudo -c`) autorise **exactement** ce chemin, sans argument, `NOPASSWD` —
  rien de plus large.
- **Pas de code arbitraire** : l'archive n'est jamais « jouée » (aucun installeur
  embarqué n'est exécuté), on copie des fichiers. `subprocess` reçoit des listes
  d'arguments, jamais `shell=True` ; aucune donnée distante n'est interpolée dans
  un shell.

## Installer l'outil sur une machine

Sur une machine **déjà installée**, sans rejouer tout `install.sh` :

```bash
cd /chemin/vers/le/dépôt/panda
bash install/install-updater.sh
```

Le script est idempotent : il pose `python3-cryptography`, le binaire
`panda-update` (root:root 0755) et le sudoers dédié, puis affiche un
récapitulatif. Sur une **nouvelle** installation, `install/install.sh` le fait
automatiquement (étape 4b).

> La mise à jour ne fonctionnera qu'une fois la **clé publique de release
> embarquée** et une **release signée publiée** (voir ci-dessous). Tant que ce
> n'est pas fait, l'interface affiche « mise à jour signée non configurée » et
> l'outil refuse de tourner — c'est volontaire.

## Publier une release (mainteneur)

**1. Générez la paire de clés** (une seule fois, sur votre poste — jamais sur le
kiosk) :

```bash
python3 tools/gen-release-keys.py
```

La clé **privée** (`~/ca/panda-release.key`, chiffrée) ne doit jamais quitter
votre poste ; sauvegardez-la avec sa passphrase. La clé **publique** affichée
doit être **embarquée à deux endroits identiques** :

- `app.py` → constante `PANDA_RELEASE_PUBKEY`
- `install/panda-update` → constante `RELEASE_PUBKEY`

Commitez ce changement, puis redéployez le socle sur vos kiosks (`install.sh`
ou copie de ces deux fichiers).

**2. Bumpez la version** : mettez à jour `APP_VERSION` dans `app.py`.

**3. Construisez et signez la release** :

```bash
python3 tools/build-release.py            # produit dist/panda.zip, release.json, release.json.sig
```

Le script zippe le code, calcule le SHA-256, écrit `release.json`, le signe
(votre passphrase est demandée) et vérifie la signature dans la foulée
(autotest). S'il affiche ✅, un kiosk portant la clé publique correspondante
acceptera la release.

**4. Publiez sur GitHub** : créez une release **taguée `v<version>`** et attachez
les **trois** fichiers (`panda.zip`, `release.json`, `release.json.sig`).
L'outil les récupère via
`https://github.com/TheWorms/panda/releases/latest/download/`.

Une version publiée est immuable : toute correction passe par un nouveau numéro.

## Dépannage

- **Journal** : `/var/log/panda-update.log` et `journalctl` (l'outil écrit sur
  stdout). Chaque étape y est tracée.
- **Bouton absent alors qu'une version existe** : l'outil n'est pas installé sur
  la machine (`install/install-updater.sh`), ou la clé/release n'est pas
  configurée. L'interface l'indique explicitement.
- **« signature de la release invalide »** : la clé publique embarquée ne
  correspond pas à la clé privée qui a signé, ou les assets ont été altérés.
  Rien n'est installé.
- **Rejouer une version** (dépannage) : `sudo PANDA_ALLOW_DOWNGRADE=1 /usr/local/bin/panda-update`.
- **Restaurer manuellement** : les sauvegardes sont dans `/var/backups/panda/` ;
  chacune est un `tar.gz` des chemins « code », extractible dans `/opt/panda`.

## Rotation de clé

Générez une nouvelle paire, remplacez la clé publique aux **deux** endroits
(`PANDA_RELEASE_PUBKEY` et `RELEASE_PUBKEY`), redéployez le socle sur les kiosks,
puis signez les releases suivantes avec la nouvelle clé privée. Les kiosks non
mis à jour continueront de vérifier avec l'ancienne clé jusqu'au redéploiement.

## Plan de test

À valider **sur la VM kiosk de développement**, jamais directement en production.

| Cas | Attendu |
|---|---|
| **Déjà à jour** (release = version installée) | Bouton absent ; message « ✓ Panda est à jour ». L'outil lancé à la main sort proprement sans rien toucher. |
| **MAJ disponible** (release > installée) | Bouton visible ; après clic, MAJ appliquée, le kiosk revient seul, `config.json`, addons installés et états (`data/`) intacts, nouvelle version affichée dans `/healthz`. |
| **Signature invalide** (`release.json.sig` altéré ou mauvaise clé) | Refus avant toute écriture ; aucun fichier `/opt/panda` modifié ; code de sortie ≠ 0 ; journal explicite. |
| **SHA-256 faux** (`panda.zip` altéré) | Refus avant extraction ; rien touché ; code ≠ 0. |
| **Réseau coupé** pendant le téléchargement | Refus propre, message réseau explicite, installation en place intacte. |
| **Service qui ne repart pas** (ex. archive de test volontairement cassée) | Rollback automatique effectif : sauvegarde restaurée, service redémarré à l'ancienne version, `/healthz` de nouveau `ok`. |
| **Deux lancements simultanés** | Le second est refusé immédiatement (verrou `flock`). |
| **`requirements.txt` inchangé / changé** | Deps non réinstallées / réinstallées dans le venv, respectivement. |
| **Downgrade** (release < installée) | Refusé sauf `PANDA_ALLOW_DOWNGRADE=1`. |

Vérification rapide après une MAJ réussie :

```bash
curl -fsS http://127.0.0.1:8090/healthz        # status ok + nouvelle version
ls /var/backups/panda/                          # sauvegarde horodatée présente
sudo tail -n 40 /var/log/panda-update.log       # déroulé de l'opération
```

## Retour visuel côté interface

Une mise à jour peut être lancée depuis **Réglages → Version**, mais aussi
subie passivement (déclenchée depuis un autre appareil, ou pendant qu'on
navigue ailleurs). Deux éléments d'interface rendent l'opération lisible.

### Overlay plein écran (pendant la MAJ)

Dès que `POST /api/system/selfupdate` répond `ok`, `static/panda.js` affiche un
**overlay plein écran** (`startUpdateOverlay`) ajouté à `<body>`, au-dessus de
tout (y compris le clavier virtuel), qui **capte toute interaction** : quelle
que soit la vue affichée, personne ne peut taper sur une interface en cours de
bascule. Il anime l'attente (spinner + points), **sans compte à rebours ni
pourcentage** (durée réelle inconnue). Son polling `/healthz` (cadence 3 s) lui
est propre et survit à tout changement de section.

Il distingue **trois issues**, sans jamais annoncer un succès mensonger :

| Issue | Détection | Affichage |
|---|---|---|
| **Succès** | `/healthz` revient `ok` à une version **supérieure** | « Mise à jour réussie », puis rechargement |
| **Rollback** | le service a été vu **injoignable** (fenêtre de restart) puis revient `ok` à la **même** version | « Mise à jour non appliquée — l'ancienne version a été restaurée », toucher pour recharger |
| **Pas de retour** | plus de **240 s** sans issue | « Le kiosk ne répond pas — vérifiez le kiosk ou contactez un administrateur », toucher pour recharger |

Le drapeau « service vu injoignable » (`sawDown`) est **indispensable** :
pendant tout le téléchargement/extraction, l'**ancien** service répond encore
`/healthz` à l'ancienne version. Sans ce garde-fou, l'interface conclurait à
tort à un rollback. Le seul `systemctl restart` a lieu à la toute fin ; c'est
la fenêtre d'indisponibilité qui atteste que la bascule a réellement eu lieu.

**Seuil des 240 s (cas 3)** : il doit couvrir le *pire cas complet* de
`panda-update`, pas seulement `HEALTH_TIMEOUT` (30 s). Budget : jusqu'à 3
téléchargements × `DL_TIMEOUT` (30 s) + sauvegarde + extraction + `pip` éventuel
+ `systemctl restart` + `HEALTH_TIMEOUT` (30 s), et le cas échéant le chemin de
rollback (restauration + restart + 30 s). 240 s laisse une marge confortable
au-dessus de ce cumul tout en évitant de tourner indéfiniment ; au-delà,
l'interface propose de recharger d'un toucher plutôt que de rester muette.

### Bandeau de confirmation (après la MAJ)

Au **prochain chargement** de l'interface après une MAJ **réussie**, un bandeau
bref « Nouvelle version installée avec succès — v<version> » s'affiche
(disparaît seul après ~6 s ou au premier toucher). Il n'apparaît **jamais** lors
d'un démarrage ordinaire (reboot du Pi, restart manuel, simple rechargement).

Le déclencheur est **porté par le serveur**, pas par le navigateur (l'appareil
qui rouvre l'interface n'est pas forcément celui qui a lancé la MAJ) :

- `panda-update` écrit, **juste après** la validation `/healthz` réussie, un
  marqueur `data/.update-done.json` (`{"version", "ts"}`). `data/` est un chemin
  **préservé** entre versions (jamais dans `CODE_PATHS`) ; le fichier est
  `chown` vers l'utilisateur applicatif pour que Flask puisse le lire **et** le
  supprimer. En cas de **rollback**, aucun marqueur n'est écrit → aucun bandeau
  mensonger.
- `GET /api/system/update-done` (protégée par `@require_auth`, pour que le mur
  affiche le bandeau même hors session admin) **revendique** le marqueur par
  `os.rename` avant de le lire, puis le supprime : lecture-suppression
  **atomique**, servie **une seule fois**.
- **Concurrence** (deux onglets ouverts juste après une MAJ) : seul le premier
  `rename` réussit ; l'autre appel reçoit `pending:false`. **Un seul onglet
  affiche le bandeau** — comportement volontaire et sans conséquence, le message
  étant purement informatif.

> Petite fenêtre de course assumée : l'overlay recharge la page ~1,5 s après
> avoir détecté le succès, ce qui laisse à `panda-update` le temps d'écrire le
> marqueur avant que `update-done` ne soit interrogé. Si le marqueur n'était pas
> encore là, le bandeau serait simplement omis (best-effort, jamais bloquant).
