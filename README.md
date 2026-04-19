# FK Soundcloud

J'en ai eu marre de balancer mes morceaux sur SoundCloud pour avoir juste un lien d'ecoute propre. Ce repo sert a ca: une plateforme perso, statique, elegante, hebergeable sur GitHub Pages, qui lit directement les fichiers ranges dans `musics/`.

Site public:
[https://borishnt.github.io/fk-soundcloud](https://borishnt.github.io/fk-soundcloud)

## Ce que fait le projet

- Scanne automatiquement `musics/ARTIST_NAME/RELEASE_NAME/`
- Detecte les fichiers audio, la cover, les `.txt` de tracks et le `.txt` de release si present
- Genere `data/library.json`
- Construit un frontend pur HTML/CSS/JS avec:
  - page d'accueil
  - page artistes
  - page artiste
  - page release
  - page playlists
  - page playlist
  - lecteur audio global sticky persistant
  - recherche rapide
  - partage / copie de lien

## Structure attendue

Chaque release doit ressembler a ceci:

```text
musics/
  MEGASUKA/
    JUMP [MEGASUKA RMX]/
      JUMP [MEGASUKA RMX].mp3
      JUMP [MEGASUKA RMX].txt
      cover.png
```

Exemple de `.txt` de track:

```text
date_of_creation:2026-03-28
date_of_release:2026-04-18
genre:Hard Techno
artist:MEGASUKA
ogartist:BLACKPINK
ep-lp:JUMP [MEGASUKA RMX] EP
title:JUMP [MEGASUKA RMX]
nberofthetrack:1
fullname:BLACKPINK - JUMP [MEGASUKA RMX]
```

Regles actuelles:

- un `.txt` par track, avec le meme nom de base que le fichier audio
- un `.txt` de release/EP optionnel si besoin de metadata communes
- `nberofthetrack` sert a ordonner les pistes dans la release
- plusieurs fichiers audio dans un meme dossier sont supportes
- l'ancien format `infos.txt` reste lu comme fallback

## Generer le catalogue

Sans npm:

```bash
node scripts/generate-library.js
```

Avec les scripts npm si ton environnement le permet:

```bash
npm run generate:library
```

Le fichier genere est:

```text
data/library.json
```

## Lancer en local

Comme le frontend charge `data/library.json` en `fetch`, il faut passer par un vrai serveur statique:

```bash
node scripts/serve.js
```

Puis ouvrir:

```text
http://localhost:4173
```

Navigation interne:

- Le site utilise une navigation frontend legere via History API.
- Le lecteur global reste donc vivant pendant les changements de page internes.
- En cas de rechargement complet du navigateur, l'etat est restaure au mieux via `localStorage`.

## Publier sur GitHub Pages

1. Commit et push le repo sur GitHub.
2. Va dans `Settings > Pages`.
3. Choisis `Deploy from a branch`.
4. Selectionne la branche (`main` par exemple) et le dossier `/ (root)`.
5. Verifie que `data/library.json` est bien committe apres chaque ajout de musique.

Le site sera servi directement depuis les fichiers statiques du repo.

## Maintenance rapide

- Couleurs et tokens: `assets/css/tokens.css`
- Layout et composants de page: `assets/css/site.css`
- Lecteur audio sticky: `assets/css/player.css`
- Shell global et actions communes: `assets/js/app.js`
- Chargement / recherche du catalogue: `assets/js/library.js`
- Lecteur audio et persistance localStorage: `assets/js/player.js`
- Rendu des vues: `assets/js/views.js`
- Generation du catalogue: `scripts/generate-library.js`

## URLs utilisees

- `index.html`
- `artists.html`
- `artist.html?slug=megasuka`
- `release.html?artist=megasuka&release=blackpink-jump-megasuka-rmx`
- `playlists.html`
- `playlist.html?type=all`
- `playlist.html?type=artist&slug=megasuka`

## Notes

- Le player sauvegarde le volume, la file d'attente, le morceau courant et la position via `localStorage`.
- Le player conserve aussi l'etat play/pause, repeat et shuffle.
- Media Session API est branchee pour exposer titre, artiste, cover, play/pause, previous/next et seek quand le navigateur le supporte.
- Sur mobile et ecran verrouille, le comportement depend du navigateur et du systeme. Le support implemente ici est le meilleur support web realiste, sans promettre 100 % de compatibilite.
- Le partage natif utilise `navigator.share` si disponible, sinon le site copie le lien.
- Le frontend est volontairement sans framework lourd pour rester lisible et compatible GitHub Pages.
