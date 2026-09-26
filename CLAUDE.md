# Together — ce qu'une nouvelle session doit savoir

Lu au début de chaque session. Court exprès : relu à chaque réponse, chaque
ligne coûte. Le détail est dans README.md (l'app) et docs/DEPLOIEMENT.md (la
base).

## Avec qui l'on travaille

- **Répondre en français**, court et direct. L'utilisateur n'est pas développeur :
  pour ce qu'il doit faire, donner les gestes exacts (« Aperçu → Données → … »).
- Il fusionne lui-même les PR, vite. **Ouvrir une PR après chaque push.** Si la
  PR de la branche a déjà été fusionnée, repartir de `origin/main` (même nom de
  branche) et ouvrir une nouvelle PR.
- **Le SQL à passer dans Supabase se donne dans la conversation, en un seul
  bloc** ```sql prêt à copier, obtenu par `python3 tools/mise-a-jour.py
  --coller` (sans commentaires). Avec : « SQL Editor → New query → coller → Run
  → attendu : Success. No rows returned ». Pas d'encadré dans l'app pour ça : il
  a été essayé et retiré.
- Si la fonction d'agenda change (`supabase/functions/agenda/index.ts`), le dire :
  elle se recolle dans Supabase → Edge Functions (JWT désactivé).
- Sobriété : sessions courtes, une par chantier ; ne pas relire en entier
  `src/app.js` ni les `src/view-*.js` (≈ 1 000 à 3 000 lignes chacun) —
  chercher avec grep et lire des extraits.

## Le projet

App web installable (PWA), sans dépendance ni framework : modules ES dans
`src/`, un seul fichier livré dans `dist/`, publiée sur GitHub Pages par
`.github/workflows/pages.yml` à chaque fusion sur main. Base partagée
facultative : Supabase (supabase.com), appelée uniquement par des fonctions
RPC `security definer` ; la table n'est jamais exposée.

- `src/app.js` : routeur, accueil, agenda, personnes ; `src/view-*.js` : un
  écran chacun (sondages, listes, comptes, idées, parties, groupes), qui rappellent
  `app.js` depuis leurs fonctions seulement ; `src/i18n.js` : tous les textes
  (FR et EN, ajouter les deux ; pluriel : `{count|ligne|lignes}`) ; `src/remote.js` : appels à la base ; `polls.js`,
  `lists.js`, `spends.js`, `ideas.js`, `model.js` (parties) : la logique pure, testée.
- `tools/bundle.js` construit `dist/*.html` et `supabase/functions/agenda/index.ts`,
  et tamponne `sw.js`/`index.html`. Liste explicite `MODULES` : un nouveau module
  s'y ajoute, et dans `SHELL` de `sw.js`. Pas d'import renommé (`as`), pas deux
  noms identiques au niveau supérieur de deux modules (tout finit dans une portée).
- Le schéma SQL vit dans `docs/DEPLOIEMENT.md` : bloc ```sql n°1 = étape 2,
  n°2 = étape 2 bis. `supabase/mise-a-jour.sql` en est extrait par
  `tools/mise-a-jour.py` (y ajouter ce qui change) ; `tests/migration.test.js`
  vérifie qu'ils concordent et que la mise à jour n'efface aucune donnée.

## Avant chaque commit

1. `node tools/bundle.js` — sinon les tests « committed build is up to date » échouent.
2. `npm test` (node --test, ~280 tests, quelques secondes).
3. Si l'écran change : `tests/navigateur/lancer.sh audit <suites>` (Playwright
   contre une fausse base, `tests/navigateur/fausse-base.mjs`, à tenir à jour
   avec le SQL). `audit` vérifie les règles communes à tous les écrans (voir
   README → Tests) ; un nouvel écran s'ajoute à ses routes. Toutes : ~15 min.
4. Si le SQL change : `tests/sql/verifier.sh` (base neuve) et
   `tests/sql/verifier.sh --depuis <commit d'avant>` (mise à jour d'une base
   existante, passée deux fois). Il faut PostgreSQL (`apt-get install -y postgresql`).

Messages de commit et commentaires de code en anglais ; textes de l'app et
guide en français.

## Décisions déjà prises (ne pas rediscuter sans qu'on le demande)

- **Pas de comptes.** Un appareil entre dans un groupe par nom + code à 6 chiffres
  (invitation valable 2 jours) ; il reçoit une clé de groupe, gardée sur
  l'appareil, jamais exportée. Seules les clés qui « font entrer » gèrent le groupe.
- **Un prénom n'est pas un compte** : dans un sondage, on peut répondre pour
  n'importe quel prénom. Accepté (alourdirait tout) ; option légère si un jour
  besoin : « voir et annuler » (journal des modifications, l'organisateur annule).
- **Tout document appartient à un groupe** (choisi à la création), fixé à la
  première écriture ; « copier vers un groupe » crée une copie (nouvel id).
  **« Lien seulement »** : dans aucun onglet ni agenda de groupe, seulement par lien.
- **Organisateur d'un sondage** : secret aléatoire sur l'appareil créateur
  (`prefs.organiser`), empreinte dans la base (`owner_hash`). Lui seul règle
  date, clôture, question, choix, suppression ; les autres votent et
  s'ajoutent. Le secret voyage dans l'export et revient par l'import.
- **Sondages** : on coche seulement « dispo » (pas de non/peut-être), jauge
  horizontale ; votes fusionnés case par case (`{v, at}`), dans l'app et dans la
  base ; un sondage clos ne prend plus de votes. Visiteurs : vue seule
  (`#/poll/<id>/solo`), sans navigation.
- **Ce qui est supprimé ne revient pas** : table `marque_points_gone` ; l'app
  retire sa copie quand la base répond « document supprime ».

## Pièges connus

- L'éditeur de Supabase tronque parfois un collage : le SQL se donne sans
  commentaires, et l'agenda annonce son nombre de lignes en tête.
- Dans PL/pgSQL, tester `FOUND` après `SELECT … INTO`, pas une variable.
- Safari peut effacer les données d'une app non ouverte depuis des semaines :
  d'où l'export (qui porte aussi les droits d'organisateur).
- Le navigateur intégré de Messenger n'installe pas l'app : ouvrir dans Safari/Chrome.
- Sans `viewport-fit=cover` dans la balise `viewport` (index.html), iOS ne
  remplit jamais `env(safe-area-inset-*)` : la barre du bas colle à la zone de
  la barre d'accueil au lieu de s'arrêter au-dessus (repéré sur iPhone 16 Pro Max).
- Un push arrivé juste après que la PR de la branche a été fusionnée ne rentre
  pas dans `main` (la PR est déjà fermée). Après un « c'est fusionné », vérifier
  `git log origin/main` avant de dire qu'un changement est en ligne.
