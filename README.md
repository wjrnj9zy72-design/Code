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
- **Correction** : on clique sur une ligne du tableau pour modifier ou supprimer
  une manche, et *Annuler la dernière manche* défait la saisie précédente.
- **Ça marche sur téléphone**, hors ligne, en français ou en anglais, en thème
  clair ou sombre. Les parties sont enregistrées dans le navigateur, et
  exportables en JSON pour sauvegarder ou changer d'appareil.

## Jeux fournis

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
| Yams / Yahtzee | plus grand score | à la demande | libre |
| Mille Bornes | plus grand score | 5000 points | libre |
| Jeu personnalisé | au choix | au choix | au choix |

Chaque réglage reste modifiable au moment de créer la partie : les variantes de
table sont la règle, pas l'exception. Un total de manche inattendu est un
**avertissement**, jamais un blocage.

## Lancer l'appli

```bash
npm start            # http://localhost:8080
PORT=3000 npm start  # autre port
```

`npm start` sert le dossier avec un petit serveur statique sans dépendance
(`tools/serve.js`). N'importe quel serveur statique fait l'affaire :

```bash
python3 -m http.server 8080
```

Passer par `http://` est nécessaire : les modules ES ne se chargent pas depuis
un fichier ouvert en `file://`.

## Tests

```bash
npm test
```

Les tests (`node --test`, sans dépendance) couvrent le moteur de score :
totaux, classement et ex æquo, fins de partie, validation d'une manche,
complétion automatique, et cohérence des presets et des traductions.

## Organisation du code

```
index.html        coquille de la page
styles.css        thème clair/sombre, mise en page mobile d'abord
src/games.js      définition des jeux (presets)
src/model.js      création et modification d'une partie (fonctions pures)
src/scoring.js    totaux, classement, état de la partie, validation
src/storage.js    persistance localStorage (tolérante aux erreurs)
src/i18n.js       traductions fr / en
src/app.js        routeur, vues et interactions
tools/serve.js    serveur statique de développement
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
  notesKey: 'notes.president',
}
```

Ajoutez ensuite la clé `notes.president` dans les deux dictionnaires de
`src/i18n.js` — un test vérifie qu'aucune traduction ne manque.

## Données

Tout est stocké dans le `localStorage` du navigateur : rien n'est envoyé nulle
part, et rien n'est partagé entre appareils. Le bouton *Exporter* produit un
fichier JSON réimportable.

---

**In English** — a dependency-free score keeper for Papayoo and other card
games. Enter each round, it keeps totals, standings and end-of-game detection,
and it knows each game's scoring rules (including that a Papayoo deal hands out
exactly 250 penalty points). `npm start` to run, `npm test` for the tests. The
interface switches between French and English from the top-right button.
