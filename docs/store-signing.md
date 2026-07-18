# Signature du store — modèle de confiance

Panda n'installe **que des addons provenant d'un store signé**. Cette page
explique ce que ça garantit, comment ça fonctionne, et comment héberger votre
propre store si vous le souhaitez.

## Ce que la signature garantit

Le catalogue du store (`index.json`) est signé **Ed25519** par la clé privée
du mainteneur. Le kiosk embarque la clé publique correspondante et vérifie la
signature **avant** toute lecture du catalogue. Chaque paquet listé est ensuite
contrôlé par son empreinte **SHA-256**, inscrite dans l'index signé.

La chaîne complète : *index signé → empreintes authentifiées → paquets
vérifiés*. Conséquence : même si l'hébergement du store (GitHub, un serveur
Git, un CDN…) était compromis, un attaquant ne pourrait **pas** faire installer
un addon modifié — il ne possède pas la clé privée, donc ne peut ni forger un
index, ni altérer un paquet sans invalider son empreinte.

Ce qui n'est **pas** couvert : le socle lui-même (le contenu de ce dépôt), que
vous déployez vous-même — l'acte d'installation est votre acte de confiance —
et le contenu fonctionnel des addons, qui relève du mainteneur du store.

## Les deux modes

Dans **⚙ Réglages → Source du store** :

| Mode | URL | Clé de vérification | Pour qui |
|---|---|---|---|
| **Officiel** (défaut) | Intégrée, non modifiable | Intégrée au socle, non modifiable | Tout le monde |
| **Perso** | Saisie manuelle | **Obligatoire**, collée dans les réglages | Qui héberge son propre store |

En mode **Officiel**, rien à configurer : le kiosk pointe sur le store Abeille
officiel et vérifie avec la clé publique compilée dans le code. Ni l'URL ni la
clé ne peuvent être changées depuis l'interface — c'est volontaire : seule une
modification du code (accès au système) peut déplacer la racine de confiance.

En mode **Perso**, vous fournissez l'URL de votre dépôt, un jeton d'accès
éventuel, et la **clé publique** de votre store (base64, 44 caractères). Un
store perso **sans clé est refusé** : il n'existe pas de mode « sans
signature ». Le bouton **↩ Revenir au store officiel** rétablit le mode
Officiel en un geste.

## Héberger votre propre store

Tout l'outillage est dans `tools/` de ce dépôt.

**1. Générez votre paire de clés** (une seule fois, sur votre poste d'admin —
jamais sur le kiosk) :

```bash
python3 tools/gen-store-keys.py
```

La clé **privée** (`~/ca/abeille-signing.key`) est chiffrée par une passphrase
et ne doit jamais quitter votre poste. Sauvegardez-la (avec sa passphrase)
dans un gestionnaire de mots de passe : sans elle, plus aucune publication
possible. La clé **publique** (`~/ca/abeille-signing.pub`, une ligne base64)
est celle que les kiosks colleront en mode Perso.

**2. Créez le dépôt du store** : un dépôt Git servi en HTTP(S) contenant
`index.json`, `index.json.sig` et `zips/<id>/<id>-<version>.zip`. Le format de
l'index est décrit dans le dépôt du store officiel
([Abeille](https://github.com/TheWorms/abeille), `docs/format.md`).

**3. Publiez vos addons** :

```bash
./tools/publish-addon.sh --set-version 0.1.0 <id>
```

Le script valide le manifeste, construit le paquet, calcule le SHA-256, met à
jour l'index **et le signe** (votre passphrase est demandée), puis commit et
pousse. Une version publiée est immuable : toute modification passe par un
nouveau numéro de version.

Les chemins par défaut (`~/Git/abeille`, `~/Git/addons-src`…) se surchargent
par variables d'environnement : `STORE_REPO=… ADDONS_SRC=… ./tools/publish-addon.sh <id>`.

**4. Côté kiosk** : ⚙ Réglages → Source du store → **Perso**, renseignez
l'URL, le jeton éventuel, et collez votre clé publique. **Tester** vérifie
immédiatement la chaîne complète (téléchargement + signature).

Workflow conseillé, celui du store officiel : un dépôt **privé de test** (votre
kiosk pointe dessus, vous validez chaque addon en réel) et un dépôt **public**
alimenté par `tools/promote-addon.sh <id>`, qui copie le paquet validé, vérifie
son empreinte, re-signe l'index public et pousse.

## Cas de dépannage

Si votre chaîne de signature est cassée (clé perdue, `.sig` manquant après une
manipulation), le kiosk refuse toute installation — c'est le comportement
attendu. Pour un dépannage **temporaire**, la clé de configuration
`storeNoSig: true` (à poser dans `config.json` via SSH, volontairement absente
de l'interface) suspend la vérification. Ne la laissez jamais active : elle
annule toute la protection.

## Rotation de clé

Pour changer de clé (compromission, perte) : générez une nouvelle paire,
remplacez la clé publique (constante `STORE_OFFICIAL_PUBKEY` d'`app.py` pour
un store officiel de fork, ou simplement la clé collée dans les réglages en
mode Perso), re-signez l'index avec `tools/sign-index.py`, et redéployez le
socle sur vos kiosks. Les paquets existants restent valides : seuls l'index et
sa signature changent.
