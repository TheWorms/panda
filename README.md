# 🐼 Panda — kiosk domestique pour écran tactile

Panda transforme un Raspberry Pi et un écran tactile en **tableau de bord
mural pour la maison** : météo et vigilance, agenda, minuteurs de cuisine,
radios et musique, courses et repas, phases de lune, transports, domotique…
Le tout **piloté au doigt**, extensible par un **store d'addons** ([Abeille](https://github.com/TheWorms/abeille)),
et entièrement **auto-hébergé** : aucune donnée ne quitte votre réseau,
hormis les appels aux services que vous configurez.

- Serveur **Python / Flask**, interface **JavaScript sans framework**
- Pensé pour un écran **1024×600** en mode kiosk (Chromium + labwc/Wayland)
- **SDK d'addons** stable (`kiosk_api 1.x`) : les applications s'installent,
  se mettent à jour et se développent sans toucher au socle

---

## Installation de A à Z

### 0. Matériel

| Élément | Recommandé | Minimum testé |
|---|---|---|
| Carte | Raspberry Pi 5 | Pi 4 |
| Écran | Tactile HDMI 1024×600 (IPS) | tout écran HDMI |
| Stockage | microSD A2 32 Go | 16 Go |
| OS | Debian 13 « Trixie » (ou Raspberry Pi OS basé Trixie) | — |

### 1. Préparer le système

Flashez Debian/Raspberry Pi OS **Lite** (64 bits) avec Raspberry Pi Imager.
Dans les options de l'imager : définissez le nom d'hôte, **créez votre
utilisateur** (remplacez `panda` par le vôtre partout ci-dessous), votre
réseau Wi-Fi le cas échéant, et activez SSH.

Premier démarrage, puis depuis votre poste :

```bash
ssh panda@<ip-du-pi>
sudo apt update && sudo apt -y upgrade
```

### 2. Récupérer Panda

```bash
git clone https://github.com/TheWorms/panda.git
cd panda
```

*(ou téléchargez l'archive de la dernière release et décompressez-la)*

### 3. Installer

Le script fait tout : dépendances, environnement Python, service systemd,
droits sudo ciblés, et — avec `--with-kiosk` — la session écran complète
(autologin → labwc → Chromium plein écran).

```bash
KIOSK_USER=panda sudo -E bash install/install.sh --with-kiosk
sudo reboot
```

Au redémarrage, l'écran affiche Panda. Sans écran (usage navigateur seul),
omettez `--with-kiosk` et ouvrez `http://<ip-du-pi>:8090`.

Options utiles :

```bash
--data panda-data-2026-07-16.tar.gz   # restaurer une sauvegarde (réinstallation)
--ca mon-ca.crt                       # installer une CA maison (store en HTTPS interne)
```

### 4. Premier démarrage

1. **Définissez le code PIN** demandé à l'écran (verrouillage du kiosk).
2. Ouvrez **⚙ Paramètres → Sécurité** : définissez le **mot de passe
   admin** et désactivez « accès admin sans mot de passe » (actif par
   défaut pour faciliter la prise en main).
3. **⚙ Réglages → heure** : vérifiez « NTP actif · heure synchronisée ✓ ».
4. **⚙ Apparence** : thème, police, mise en veille de l'écran.

### 5. Connecter le store d'addons (Abeille)

Dans **⚙ Réglages → URL du store**, renseignez l'adresse d'un dépôt
Abeille, par exemple le store public :

```
https://raw.githubusercontent.com/TheWorms/abeille/main/
```

…ou celle de votre propre miroir auto-hébergé (Gitea/Forgejo : l'URL
« raw » de la branche, jeton d'accès possible pour un dépôt privé).
Touchez **Tester**, puis ouvrez le **Store** depuis l'accueil : installez
météo avancée, cuisine, transports, musique…

### 6. Sauvegarde et restauration

```bash
bash install/backup-data.sh
# → ~/panda-data-AAAA-MM-JJ.tar.gz  (config, PIN, addons installés, états)
```

Rangez cette archive ailleurs que sur le Pi. Pour tout réinstaller à
l'identique : étape 3 avec `--data`.

### 7. Mettre à jour

```bash
cd panda && git pull
sudo bash install/install.sh          # idempotent : ne touche jamais vos données
```

---

## Dépannage

| Symptôme | Piste |
|---|---|
| L'écran reste noir au boot | `systemctl status panda`, puis `journalctl -u panda -n 50` |
| `/healthz` ne répond pas | `curl -s http://127.0.0.1:8090/healthz` sur le Pi ; port 8090 occupé ? |
| Le Store refuse d'installer | URL du store + **Tester** dans ⚙ Réglages ; CA installée si HTTPS interne |
| Heure fausse après coupure | ⚙ Réglages → « ↻ Resynchroniser » (le NTP est réarmé à chaque démarrage) |
| L'écran ne se rallume pas | vérifiez `wlr-randr` : `WAYLAND_DISPLAY=wayland-0 wlr-randr` |

## Architecture (pour développer un addon)

Un addon = un dossier : `manifest.json` (+ `ui.js`, + `backend.py`).
Le socle charge l'interface (`window.PandaAddons.<id>.render(el, sdk, tile)`),
monte le backend sous `/addons/<id>/api/*`, fournit un state JSON persistant
(≤ 64 Ko) et des hooks d'arrière-plan. Contrat gelé `kiosk_api 1.x` :
voir `docs/` et le dépôt [Abeille](https://github.com/TheWorms/abeille)
pour le format de publication.

## Licence

GPL-3.0 — voir [LICENSE](LICENSE).
