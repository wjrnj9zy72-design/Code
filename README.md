# 🃏 Marque-Points

Compteur de points pour **Papayoo** et d'autres jeux de cartes ou de dés.
Une page web, aucune dépendance, aucun build : on l'ouvre, on saisit les
manches, elle tient le classement.

<p>
  <img src="docs/screenshot-light.png" alt="Une partie de Papayoo en thème clair" width="45%" />
  <img src="docs/screenshot-dark.png" alt="La même partie en thème sombre" width="45%" />
</p>

## Ce que ça fait

- **Une partie = des manches** : on saisit le score de chaque joueur, l'appli
  tient les totaux, le classement (ex æquo compris) et l'écart avec le leader.
- **Les règles de comptage du jeu sont connues** : sens du classement (le plus
  petit ou le plus grand total gagne), fin de partie (score limite, nombre de
  manches fixe, ou à la demande), total attendu par manche.
- **Contrôle de saisie** : à Papayoo une manche distribue exactement 250 points
  de pénalité — si le compte n'y est pas, l'appli le signale avant d'enregistrer.
  Le bouton *Compléter* remplit automatiquement le dernier score manquant.
- **Elle s'installe et marche hors ligne** : ajoutée à l'écran d'accueil, elle
  s'ouvre sans réseau — dans un train, une cave, un gîte — et se resynchronise
  au retour de la connexion.
- **Les résultats s'exportent** : un récapitulatif en texte à coller dans une
  conversation, ou un fichier **Word** et **PDF** du classement et des manches.
- **Statistiques par joueur** : parties jouées, gagnées, moyenne et meilleur
  score, jeu par jeu.
- **Rejouer** relance une partie avec les mêmes joueurs et les mêmes règles, et
  les noms déjà utilisés sont proposés à la saisie.
- **Le donneur tourne** : l'app rappelle à qui c'est de donner.
- **Passer l'app à quelqu'un, avec ou sans les parties** : *Partager l'app*, sur
  l'accueil, propose trois liens — l'app seule (la personne repart de zéro),
  l'app **avec toutes** vos parties, ou l'app avec **celles que vous cochez**.
  Le lien part par la feuille de partage du téléphone, ou s'affiche à copier avec
  un **code QR** ; il reste court quel que soit le nombre de parties, parce qu'il
  ne porte pas les parties mais un identifiant qui les désigne.
- **Les liens avec parties sont gardés à double tour.** Les créer demande une
  **clé de partage** que seul celui qui héberge la base détient : personne
  d'autre ne peut partager de parties, même en récupérant la clé publique dans le
  code de la page. Les ouvrir demande un **code à six chiffres**, tiré au hasard
  à chaque partage, que la personne tape à l'arrivée — dix essais, puis le lien
  se ferme de lui-même. Le lien et le code voyagent séparément, exprès : *Copier*
  ne copie que le lien. La liste des parties d'un lot est chiffrée avec ce code,
  donc la base elle-même ne sait pas ce qu'un lot désigne. Et *Mes partages*, dans
  la section **Données**, rappelle chaque code et permet de **révoquer** un lien
  déjà envoyé.
- **Parties partagées, à la demande** : branchée sur une base (voir
  [docs/DEPLOIEMENT.md](docs/DEPLOIEMENT.md)), l'appli donne un lien par partie.
  La personne qui le reçoit ouvre la même partie, avec ses scores, et peut y
  ajouter des manches — chaque écran se rafraîchit tout seul. Rien ne quitte
  l'appareil tant que personne n'a appuyé sur *Partager*.
- **Le Tarot se calcule tout seul** : preneur, contrat, bouts et points réalisés,
  et l'appli en tire le score de chacun — en montrant son calcul, pour qu'il soit
  vérifiable à la table.
- **Compter les cartes au doigt** : pour les jeux dont le score est une pile de
  cartes, un compteur s'ouvre depuis la manche en cours. On touche les cartes
  ramassées, il fait la somme et reporte le score — plus d'addition de tête.
- **Correction** : on clique sur une ligne du tableau pour modifier ou supprimer
  une manche, *Annuler la dernière manche* défait la saisie précédente, et
  *Renommer* corrige un nom mal saisi sans toucher aux scores.
- **Ça marche sur téléphone**, hors ligne, en français ou en anglais, en thème
  clair ou sombre. Les parties sont enregistrées dans le navigateur, et
  exportables en JSON pour sauvegarder ou changer d'appareil.

## Jeux fournis

### Jeux de cartes

| Jeu | Vainqueur | Fin de partie | Total par manche |
| --- | --- | --- | --- |
| Papayoo | plus petit score | 250 points | 250 (210 de Payoos + 40 pour le Papayoo) |
| Hearts / Cœurs | plus petit score | 100 points | 26 |
| Belote / Coinche (par équipes) | plus grand score | 1000 points | 162 |
| Tarot | plus grand score | 5 manches | 0 (somme nulle, scores négatifs autorisés) |
| Skyjo | plus petit score | 100 points | libre |
| 6 qui prend ! | plus petit score | 66 points | libre |
| Uno | plus grand score | 500 points | libre |
| Rami / Rummy | plus grand score | 500 points | libre |
| Mille Bornes | plus grand score | 5000 points | libre |
| Skull King | plus grand score | 10 manches | libre, négatifs autorisés |
| Wizard | plus grand score | 60 ÷ nb de joueurs | libre, négatifs autorisés |
| Canasta | plus grand score | 5000 points | libre, négatifs autorisés |
| Scopa | plus grand score | 11 points | libre |
| Cabo / Dutch | plus petit score | 100 points | libre, négatifs autorisés |
| Président | plus grand score | 10 points | libre, négatifs autorisés |

### Tuiles, lettres et dominos

| Jeu | Vainqueur | Fin de partie | Total par manche |
| --- | --- | --- | --- |
| Rummikub | plus grand score | à la demande | 0 (somme nulle) |
| Dominos | plus grand score | 100 points | libre |
| Scrabble | plus grand score | à la demande | libre (une manche = un coup) |

### Dés, extérieur, et le reste

| Jeu | Vainqueur | Fin de partie | Total par manche |
| --- | --- | --- | --- |
| Yams / Yahtzee | plus grand score | à la demande | libre |
| Pétanque (par équipes) | plus grand score | 13 points | libre (une manche = une mène) |
| Mölkky | plus grand score | 50 points | libre, négatifs autorisés (le retour à 25) |
| Jeu de plateau | plus grand score | à la demande | libre (une manche = une partie) |
| Jeu personnalisé | au choix | au choix | au choix |

Chaque réglage reste modifiable au moment de créer la partie : les variantes de
table sont la règle, pas l'exception. Un total de manche inattendu est un
**avertissement**, jamais un blocage.

### Le compteur de cartes

Cinq jeux se comptent pièce par pièce plutôt qu'en additionnant de tête. Le
bouton 🂠 à côté de chaque joueur ouvre un compteur adapté au jeu :

| Jeu | Ce qu'on touche | Interrupteurs |
| --- | --- | --- |
| Papayoo | les Payoos ramassés, 1 à 20 (une seule fois chacun) | le Papayoo, +40 |
| Skyjo | chaque carte restante devant soi, de -2 à 12 | score doublé |
| Hearts / Cœurs | ♥, une fois par cœur ramassé | dame de pique, +13 |
| 6 qui prend ! | la valeur en têtes de bœuf de chaque carte, 1 / 2 / 3 / 5 / 7 | — |
| Rummikub | les tuiles restées sur le chevalet, joker compris | — |

*Annuler la dernière* corrige une erreur de doigt, *Reporter le score* écrit le
total dans la manche. Le compteur est une calculatrice : seul le total est
enregistré, pas le détail des cartes.

Le **Tarot**, lui, ne se compte pas : il se calcule. Son écran demande le
preneur, le contrat, les bouts et les points réalisés, puis applique la formule
de la fédération — `(25 + écart + petit au bout) × multiplicateur`, la poignée
et le chelem venant après la multiplication — et répartit le résultat entre le
preneur, son appelé éventuel et la défense. Le détail du calcul est affiché,
parce qu'une calculatrice invérifiable ne vaut rien à une table de jeu.

Les autres jeux gardent la saisie directe : la belote mêle les plis et les
annonces, Uno et le Rami dépendent des cartes restées dans la main des autres.

## Utiliser l'appli

### Le plus simple : un seul fichier

[`dist/marque-points.html`](dist/marque-points.html) contient l'appli entière —
HTML, CSS et JavaScript réunis. Téléchargez-le, ouvrez-le par double-clic : pas
de serveur, pas d'installation, et ça marche hors ligne. C'est aussi le format à
envoyer aux autres joueurs, ou à garder sur le téléphone.

Il est reconstruit avec :

```bash
npm run bundle   # → dist/marque-points.html
```

Un test vérifie que le fichier livré correspond bien aux sources.

### Pour développer : le dossier servi en HTTP

```bash
npm start            # http://localhost:8080
PORT=3000 npm start  # autre port
```

`npm start` sert le dossier avec un petit serveur statique sans dépendance
(`tools/serve.js`). N'importe quel serveur statique fait l'affaire :

```bash
python3 -m http.server 8080
```

Passer par `http://` est ici nécessaire : les modules ES séparés ne se chargent
pas depuis un `file://` — c'est précisément ce que le fichier unique résout.

Pour jouer avec le téléphone pendant que l'ordinateur sert l'appli, ouvrez
`http://<ip-locale-de-l-ordinateur>:8080` depuis le même réseau Wi-Fi.

## Tests

```bash
npm test
```

Les tests (`node --test`, sans dépendance) couvrent le moteur de score :
totaux, classement et ex æquo, fins de partie, validation d'une manche,
complétion automatique, compteurs de cartes (dont la vérification qu'une
manche entière de Papayoo comptée carte par carte fait bien 250), cohérence
des presets et des traductions, et fraîcheur des fichiers livrés dans
`dist/`.

## Organisation du code

```
index.html        coquille de la page
styles.css        thème clair/sombre, mise en page mobile d'abord
src/games.js      définition des jeux (presets) et de leurs compteurs
src/helpers.js    arithmétique du compteur de cartes
src/tarot.js      calcul d'une donne de Tarot, contrat par contrat
src/stats.js      statistiques par joueur, jeu par jeu
src/recap.js      le récapitulatif texte d'une partie
src/export-docx.js  génération du .docx (zip et XML écrits à la main)
src/export-pdf.js   génération du .pdf (objets et table de références)
src/qr.js         encodeur de codes QR, versions 1 à 6
sw.js             cache applicatif : l'app s'ouvre sans réseau
manifest.webmanifest  ce qui la rend installable
src/model.js      création et modification d'une partie (fonctions pures)
src/scoring.js    totaux, classement, état de la partie, validation
src/storage.js    persistance localStorage (tolérante aux erreurs)
src/cloud.js      magasin de documents de l'hôte, et fusion des deux copies
src/remote.js     base de parties partagées (HTTP simple, sans bibliothèque)
src/config.js     l'adresse de cette base, à remplir pour activer le partage
tools/check-remote.js  vérifie que la base est correctement configurée
docs/DEPLOIEMENT.md    mise en ligne pas à pas
src/i18n.js       traductions fr / en
src/app.js        routeur, vues et interactions
tools/serve.js    serveur statique de développement
tools/bundle.js   construction du fichier unique autonome
dist/             le fichier unique, livré dans le dépôt
tests/            tests unitaires
```

### Ajouter un jeu

Un jeu est une entrée de `PRESETS` dans `src/games.js` — aucune modification de
l'interface n'est nécessaire :

```js
{
  id: 'president',
  name: 'Président',
  players: [3, 8],
  direction: 'low',        // 'low' = le plus petit total gagne
  endMode: 'threshold',    // 'threshold' | 'rounds' | 'manual'
  target: 20,              // requis pour 'threshold'
  rounds: null,            // requis pour 'rounds'
  roundSum: null,          // total attendu d'une manche, ou null
  allowNegative: false,
  entrantLabel: 'player',  // 'player' | 'team'
  meta: null,              // champ facultatif par manche (cf. Papayoo)
  helper: null,            // compteur de cartes facultatif (cf. src/helpers.js)
  notesKey: 'notes.president',
}
```

Ajoutez ensuite la clé `notes.president` dans les deux dictionnaires de
`src/i18n.js` — un test vérifie qu'aucune traduction ne manque.

## Données

L'appli enregistre ses parties à deux endroits selon l'hôte qui la sert :

- **Toujours** dans le `localStorage` du navigateur. C'est la seule copie pour
  le fichier autonome et pour le dossier servi en local : rien ne sort de
  l'appareil, et rien n'est partagé entre appareils.
- **En plus**, quand l'hôte propose un magasin de documents (`src/cloud.js`),
  les parties y sont écrites et relues. Elles survivent alors à un effacement
  des données du navigateur et suivent l'utilisateur d'un appareil à l'autre.

Le magasin arrive tard, ou jamais : l'appli s'affiche d'abord à partir de sa
copie locale, puis se branche dessus si elle le peut. À la connexion, les deux
listes sont fusionnées par identifiant, la version la plus récemment modifiée
l'emportant, et ce que le magasin n'avait pas lui est envoyé. La section
*Données* de l'accueil dit où les parties sont enregistrées.

La base partagée n'est **pas listable** — c'est ce qui empêche quiconque a la
clé publique d'énumérer les parties, et cela vaut aussi pour vous. Une partie
partagée se retrouve donc par son lien : *Données* → **Ouvrir par un lien**
accepte le lien complet ou le seul identifiant, récupère la partie et l'ajoute
à la liste de cet appareil.

Deux appareils, ou un navigateur et l'app installée sur l'écran d'accueil, ont
chacun leur propre stockage : une app installée ne voit pas les parties saisies
dans le navigateur. *Exporter* d'un côté et **Coller un export** de l'autre font
passer les parties de l'un à l'autre, sans fichier à manipuler.

Le bouton *Exporter* reste le filet de sécurité : il produit un JSON
réimportable (ou, là où l'hôte interdit les téléchargements, le même texte à
copier).

- **Et, si elle est configurée** (`src/config.js`), dans une base partagée que
  vous hébergez — mais **seulement pour les parties effectivement partagées**.
  Une partie reste sur l'appareil jusqu'à ce que quelqu'un appuie sur *Partager*,
  ce qui l'envoie et donne un lien qui l'ouvre ailleurs. Une case dans la section
  *Données* permet à un appareil d'envoyer toutes ses nouvelles parties
  d'emblée : c'est pratique pour qui héberge la base, et décoché par défaut pour
  tous les autres. *Partager l'app* avec des parties attachées les envoie de la
  même façon, et le dit avant de créer le lien — ce qui demande la clé de partage,
  décrite à l'étape 2 bis du guide. `src/config.js` laissée vide, l'appli n'envoie rien nulle
  part. La marche à suivre est dans
  [docs/DEPLOIEMENT.md](docs/DEPLOIEMENT.md), y compris ce que ce partage
  implique.

---

**In English** — a dependency-free score keeper for Papayoo and other card
games. Enter each round, it keeps totals, standings and end-of-game detection,
and it knows each game's scoring rules (including that a Papayoo deal hands out
exactly 250 penalty points). Open `dist/marque-points.html` — one self-contained
file, no server, works offline — or run `npm start` to serve the sources.
`npm test` runs the tests. The interface switches between French and English
from the top-right button.
