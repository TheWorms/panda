# 🐼 Panda — kiosk domestique pour écran tactile

Panda transforme un Raspberry Pi et un écran tactile en **tableau de bord
mural pour la maison** : météo et vigilance, agenda, minuteurs de cuisine,
radios et musique, courses et repas, phases de lune, transports, domotique…
Le tout **piloté au doigt**, extensible par un **store d'addons**
([Abeille](https://github.com/TheWorms/abeille)), et entièrement
**auto-hébergé** : aucune donnée ne quitte votre réseau, hormis les appels
aux services que vous configurez.

- Serveur **Python / Flask**, interface **JavaScript sans framework**
- Écran **1024×600**, Chromium plein écran via **labwc** (Wayland) + Squeekboard
- **SDK d'addons** stable (`kiosk_api 1.x`) : les applications s'installent,
  se mettent à jour et se développent sans toucher au socle

---

## Installation de A à Z

### 0. Matériel

| Élément | Recommandé |
|---|---|
| Carte | Raspberry Pi 5 (Pi 4 possible) |
| Écran | Tactile HDMI 1024×600 (IPS) |
| Stockage | microSD A2 32 Go |
| OS | **Debian 13 « Trixie »** (ou Raspberry Pi OS basé Trixie), 64-bit **Lite** |

### 1. Préparer le système

Flashez l'OS **Lite** (sans bureau) avec Raspberry Pi Imager. Dans les
options : nom d'hôte, **créez votre utilisateur**, Wi-Fi si besoin, activez SSH.

```bash
ssh <votre-user>@<ip-du-pi>
sudo apt update && sudo apt -y upgrade
```

### 2. Récupérer Panda

```bash
git clone https://github.com/TheWorms/panda.git
cd panda
```

### 3. Installer

Lancez le script **avec votre utilisateur courant** (pas root ; il demande
sudo au besoin). Par défaut il installe tout : service Flask **et** session
écran (labwc + Chromium + Squeekboard, lancés au démarrage sur tty1).

```bash
bash install/install.sh
sudo reboot
```

Au redémarrage, l'écran affiche Panda directement.

**Options** (variables d'environnement) :

```bash
NO_KIOSK=1  bash install/install.sh   # service Flask seul, sans l'affichage
NO_SPLASH=1 bash install/install.sh   # sans le thème de démarrage Plymouth
NO_CLIP=1   bash install/install.sh   # sans wl-clip-persist (évite la toolchain Rust)
```

Sans écran (usage navigateur), utilisez `NO_KIOSK=1` et ouvrez
`http://<ip-du-pi>:8090`.

### 4. Premier démarrage

1. **Définissez le code PIN** demandé à l'écran (verrouillage du kiosk).
2. **⚙ Paramètres → Sécurité** : définissez le **mot de passe admin** et
   désactivez « accès admin sans mot de passe » (actif par défaut au début).
3. **⚙ Réglages → heure** : vérifiez « NTP actif · heure synchronisée ✓ ».
4. **⚙ Apparence** : thème, police, mise en veille de l'écran.

### 5. Connecter le store d'addons (Abeille)

Dans **⚙ Réglages → URL du store** :

```
https://raw.githubusercontent.com/TheWorms/abeille/main/
```

Touchez **Tester**, puis ouvrez le **Store** depuis l'accueil pour installer
des applications.

**Configurer un addon.** Chaque tuile installée porte une icône **⚙** :
touchez-la pour ouvrir son panneau de configuration (URL du service, jeton
d'accès, options…), renseignez les champs puis **Enregistrer** (et **Tester**
si le bouton est présent). La configuration est relue à chaud, sans
redémarrage. Pour les addons liés (ex. cuisine/KitchenOwl), un seul réglage
suffit : les addons associés héritent de la même connexion.

*Astuce — jetons longs.* Pour coller un token API sans le saisir sur l'écran
tactile, depuis un autre poste :

```bash
ssh -t <votre-user>@<ip-du-pi> 'python3 ~/panda-cfg.py'
```

Menu interactif qui découvre les addons configurables ; les champs sensibles
(token, clé, mot de passe) sont saisis en invisible.

### 6. Sauvegarde et restauration

```bash
bash install/backup-data.sh
# → ~/panda-data-AAAA-MM-JJ.tar.gz  (config, PIN, addons installés, états)
```

Rangez cette archive ailleurs que sur le Pi.

### 7. Mettre à jour

```bash
cd panda && git pull
bash install/install.sh          # idempotent : ne touche jamais vos données
```

---

## Dépannage

| Symptôme | Piste |
|---|---|
| Écran noir au boot | `systemctl status panda panda-kiosk` ; `journalctl -u panda-kiosk -n 50` |
| `/healthz` muet | `curl -s http://127.0.0.1:8090/healthz` sur le Pi |
| Store refuse d'installer | URL du store + **Tester** dans ⚙ Réglages |
| Heure fausse après coupure | ⚙ Réglages → « ↻ Resynchroniser » |
| Écran ne se rallume pas | `WAYLAND_DISPLAY=wayland-0 wlr-randr` |

## Architecture (développer un addon)

Un addon = un dossier : `manifest.json` (+ `ui.js`, + `backend.py`). Le socle
charge l'interface (`window.PandaAddons.<id>.render(el, sdk, tile)`), monte le
backend sous `/addons/<id>/api/*`, fournit un state JSON persistant (≤ 64 Ko)
et des hooks d'arrière-plan. Contrat gelé `kiosk_api 1.x` : voir
`docs/sdk-addons.md` et le dépôt [Abeille](https://github.com/TheWorms/abeille).

## Licence

GPL-3.0 — voir [LICENSE](LICENSE).
