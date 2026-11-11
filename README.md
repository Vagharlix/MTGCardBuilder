# Card Studio

Éditeur de cartes personnalisées **100 % hors ligne** pour PC (Windows, macOS, toutes les distributions Linux) et Android. Il reprend l'éditeur « Creator » de mtgcardbuilder.com : même moteur de rendu, mêmes onglets, mêmes options.

Usage personnel uniquement. Non affilié à Wizards of the Coast, ni sponsorisé ou approuvé par eux.

## Fonctionnalités

- **Frame** : groupes et packs de cadres (Regular, Tokens, Sagas, Planeswalkers, Transform, Modal DFC, Showcase, Universes Beyond, Promos, Textless, anciens cadres…), recherche, *Load Frame Version*, *Rotate Frame*, *Auto load*, import de cadres perso, masques, ajout pleine carte / moitié droite / moitié gauche / centre, calques (glisser pour réordonner, clic pour opacité, position, teinte, masques).
- **Text** : toutes les zones de texte, codes de mise en forme et de mana, barre de symboles rapide, gras / italique, bornes et taille de police, ajout d'un surnom, d'un F/E ou d'une date.
- **Art** : import (fichier, glisser-déposer, URL), déplacement à la souris ou au doigt, pincer pour zoomer, Maj + glisser pour l'échelle, Ctrl + glisser pour la rotation, *Auto Fit*, niveaux de gris.
- **Set Symbol** : 291 extensions disponibles hors ligne, avec la rareté, ou ton propre symbole.
- **Watermark** : galerie avec recherche et catégories (guildes, clans, écoles, familles…), 434 symboles d'extension, couleurs gauche/droite, opacité, position.
- **Collector** : numéro, rareté, extension, langue, artiste, année, numéro de série, étoile ou point, valeurs par défaut.
- **Import/Preset** : presets à partir de ta galerie (par catégorie), import d'une vraie carte depuis Scryfall (nécessite Internet), sauvegarde, chargement, export et import `.cardconjurer`.
- **Save and Update Gallery**, **Download image** (PNG 2010×2814 ou JPEG), **Create Card Back**.
- **Galerie** locale (sans limite de 5 Mo) et **Print PDF** : planche A4 ou Letter, cartes à 63×88 mm, traits de coupe, fond perdu.
- Sauvegarde automatique de la carte en cours, thème sombre ou clair, interface adaptée au mobile.

## Installer

Les fichiers d'installation sont produits par GitHub Actions :
- onglet **Actions → Build apps → Run workflow** : coche les plateformes voulues, puis télécharge les « Artifacts » en bas de la page du run ;
- ou pousse un tag `v1.0.1` : les fichiers sont ajoutés automatiquement à une **Release**.

| Système | Fichier | Remarque |
|---|---|---|
| Windows | `Card Studio_x.y.z_x64-setup.exe` ou `.msi` | Si SmartScreen s'affiche : « Informations complémentaires → Exécuter quand même ». |
| macOS (Apple Silicon) | `Card Studio_x.y.z_aarch64.dmg` | L'app n'est pas signée : la première fois, clic droit → Ouvrir. Si macOS refuse encore : `xattr -cr "/Applications/Card Studio.app"`. Pour un Mac Intel : `npx tauri build` sur le Mac. |
| Linux (toutes distributions) | `card-studio_x.y.z_amd64.AppImage` | `chmod +x *.AppImage` puis double-clic. |
| Debian / Ubuntu / Mint | `.deb` | `sudo apt install ./card-studio_*.deb` |
| Fedora / openSUSE | `.rpm` | `sudo dnf install ./card-studio-*.rpm` |
| Android (arm64) | `Card-Studio-…-arm64.apk` | Autorise l'installation d'applis inconnues pour ton navigateur ou ton gestionnaire de fichiers. |
| iPhone / iPad | — | Il faut un Mac et un compte développeur Apple (`npx tauri ios init`, puis `npx tauri ios build`). |

Les images exportées sur Android vont dans **Téléchargements/Card Studio**.

**Mise à jour Android** : installe le nouvel APK par-dessus l'ancien. Ne désinstalle pas l'app avant, sinon tu perds ta galerie. Ça ne marche que si toutes les versions sont signées avec la même clé. La clé n'est pas dans le dépôt : ajoute-la une fois dans **Settings → Secrets and variables → Actions** :
- `ANDROID_KEYSTORE_BASE64` : le fichier `card-studio.jks` encodé en base64 ;
- `ANDROID_KEYSTORE_PASSWORD` : son mot de passe (alias `card-studio`).

Sans ces secrets, chaque build est signé avec une clé temporaire différente.

## Développer

Prérequis : Node 22, Rust stable, et sous Linux les paquets `libwebkit2gtk-4.1-dev librsvg2-dev`.

```bash
npm install
```

Pour tester l'interface dans un navigateur :

```bash
npm run serve
```

Puis ouvre http://127.0.0.1:8080.

Pour lancer l'app de bureau en mode développement :

```bash
npx tauri dev
```

Pour produire les paquets de bureau du système courant :

```bash
npx tauri build
```

Pour produire l'APK Android (Android SDK et NDK requis) :

```bash
npx tauri android build --apk
```

### Organisation

- `web/` : l'application (HTML/CSS/JS, sans étape de build).
  - `web/index.html`, `web/css/app.css`, `web/js/app/*` : l'interface Card Studio (onglets, galerie, PDF, autosave, gestes tactiles).
  - `web/js/creator-23.js`, `web/js/frames/*` : le moteur de rendu des cartes et les packs de cadres.
  - `web/img/` : cadres, symboles et filigranes, convertis de PNG en WebP (1,9 Go → 253 Mo). `web/js/app/assets.js` redirige les chemins `.png` du moteur vers les `.webp`, donc les fichiers `.cardconjurer` d'autres éditeurs restent compatibles.
- `src-tauri/` : l'enveloppe native Tauri 2. Elle utilise le moteur web du système au lieu d'embarquer Chromium (app légère et rapide), et ajoute l'enregistrement de fichiers et l'ouverture des liens.
- `scripts/import-engine.mjs` : réimporte le moteur et les images depuis une copie de Card Conjurer, avec conversion WebP.
- `scripts/vendor-ui.mjs` : copie les polices de l'interface et les symboles Keyrune.
- `scripts/build-data.mjs` : génère la liste des extensions disponibles hors ligne.
