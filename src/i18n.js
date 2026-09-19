/** Tiny translation layer. `t('key', {count: 3})` interpolates {placeholders}. */

export const STRINGS = {
  fr: {
    'app.title': 'Marque-Points',
    'app.tagline': 'Compteur de points pour Papayoo & autres jeux',
    'action.newGame': 'Nouvelle partie',
    'action.back': 'Retour',
    'action.save': 'Enregistrer',
    'action.cancel': 'Annuler',
    'action.addRound': 'Ajouter la manche',
    'action.saveRound': 'Modifier la manche',
    'action.delete': 'Supprimer',
    'action.deleteRound': 'Supprimer la manche',
    'action.undo': 'Annuler la dernière manche',
    'action.finish': 'Terminer la partie',
    'action.reopen': 'Reprendre la partie',
    'action.complete': 'Compléter',
    'action.export': 'Exporter',
    'action.import': 'Importer',
    'action.addPlayer': 'Ajouter un joueur',
    'action.addTeam': 'Ajouter une équipe',
    'action.edit': 'Modifier',
    'action.rename': 'Renommer',

    'home.ongoing': 'Parties en cours',
    'home.finished': 'Parties terminées',
    'home.empty': 'Aucune partie pour le moment. Lancez-en une !',
    'home.emptyFinished': 'Aucune partie terminée.',
    'home.rounds': '{count} manche(s)',
    'home.leader': 'En tête : {name}',
    'home.winner': 'Vainqueur : {name}',
    'home.winners': 'Vainqueurs : {name}',
    'home.data': 'Données',
    'home.storedLocal':
      'Vos parties sont enregistrées dans ce navigateur uniquement. Exportez-les pour les sauvegarder ou changer d’appareil.',
    'home.storedCloud':
      'Vos parties sont enregistrées sur votre compte Claude : elles survivent à ce navigateur et vous suivent d’un appareil à l’autre.',
    'helper.open': 'Compter les cartes',
    'helper.title': '{name} — compter les cartes',
    'helper.total': 'Total : {total}',
    'helper.cards': '{count} carte(s)',
    'helper.undo': 'Annuler la dernière',
    'helper.clear': 'Tout effacer',
    'helper.apply': 'Reporter le score',
    'helper.papayoo.hint':
      'Touchez chaque Payoo ramassé dans vos plis. Le Papayoo est le 7 de la couleur tirée en début de manche.',
    'helper.papayoo.card': 'Papayoo (40)',
    'helper.hearts.hint': 'Touchez ♥ une fois par cœur ramassé.',
    'helper.hearts.queen': 'Dame de pique (13)',
    'helper.skyjo.hint':
      'Touchez chaque carte restante devant vous. Une colonne de trois cartes identiques est retirée du jeu : ne la comptez pas.',
    'helper.skyjo.doubled': 'Score doublé (a fermé sans être le plus bas)',
    'helper.sixquiprend.hint': 'Touchez la valeur en têtes de bœuf de chaque carte ramassée.',
    'action.copy': 'Copier',
    'action.close': 'Fermer',
    'export.title': 'Vos parties, en texte',
    'export.hint':
      'Copiez ce texte et gardez-le où vous voulez. Pour le remettre dans l’appli plus tard, enregistrez-le dans un fichier .json et utilisez Importer.',
    'export.copied': 'Copié !',
    'export.copyByHand': 'Texte sélectionné — copiez-le',
    'home.importDone': '{count} partie(s) importée(s).',
    'home.importFailed': 'Fichier illisible : aucune partie importée.',
    'home.storageWarning':
      'Impossible d’enregistrer dans ce navigateur : la partie sera perdue en fermant l’onglet.',

    'new.title': 'Nouvelle partie',
    'new.game': 'Jeu',
    'new.customName': 'Nom de la partie (facultatif)',
    'new.players': 'Joueurs',
    'new.teams': 'Équipes',
    'new.playerName': 'Joueur {n}',
    'new.teamName': 'Équipe {n}',
    'new.rules': 'Règles de comptage',
    'new.direction': 'Vainqueur',
    'new.directionLow': 'Le plus petit score',
    'new.directionHigh': 'Le plus grand score',
    'new.endMode': 'Fin de partie',
    'new.endThreshold': 'Score limite atteint',
    'new.endRounds': 'Nombre de manches fixe',
    'new.endManual': 'À la demande',
    'new.target': 'Score limite',
    'new.roundsCount': 'Nombre de manches',
    'new.roundSum': 'Total attendu par manche',
    'new.roundSumHint': 'Laisser vide si le total d’une manche est libre.',
    'new.allowNegative': 'Autoriser les scores négatifs',
    'new.start': 'Commencer',
    'new.errorPlayers': 'Ce jeu se joue de {min} à {max} {label}.',
    'new.errorNames': 'Deux participants ne peuvent pas avoir le même nom.',
    'new.customLabel': 'Jeu personnalisé',

    'game.round': 'Manche',
    'game.total': 'Total',
    'game.rank': 'Rang',
    'game.newRound': 'Manche {n}',
    'game.editRound': 'Modifier la manche {n}',
    'game.noRounds': 'Aucune manche enregistrée. Ajoutez la première ci-dessous.',
    'game.sum': 'Total saisi : {sum}',
    'game.sumExpected': 'Total saisi : {sum} / {expected}',
    'game.note': 'Note (facultatif)',
    'game.remainingThreshold': 'Encore {count} point(s) avant la fin de la partie.',
    'game.remainingRounds': 'Encore {count} manche(s).',
    'game.finished': 'Partie terminée',
    'game.confirmDeleteGame': 'Supprimer définitivement cette partie ?',
    'game.confirmDeleteRound': 'Supprimer cette manche ?',
    'game.confirmWarnings': 'Enregistrer quand même ?',
    'game.standings': 'Classement',
    'game.gap': '+{gap}',
    'game.perRound': 'Détail des manches',

    'meta.papayooSuit': 'Papayoo (le 7 de…)',
    'meta.none': '—',

    'error.notANumber': '{player} : score invalide.',
    'error.notAnInteger': '{player} : le score doit être un nombre entier.',
    'error.negative': '{player} : les scores négatifs ne sont pas autorisés pour ce jeu.',
    'warn.missing': 'Score non saisi pour : {players} (compté 0).',
    'warn.sum': 'Le total de la manche est {sum} au lieu de {expected}.',

    'notes.papayoo':
      'Les Payoos (1 à 20) valent leur valeur, soit 210 points, et le Papayoo — le 7 de la couleur tirée au début de la manche — en vaut 40 : une manche distribue donc 250 points de pénalité. Le plus petit total gagne.',
    'notes.hearts':
      'Chaque cœur vaut 1 point et la dame de pique 13, soit 26 points par manche. Si un joueur réalise le capot, le total de la manche change (avertissement seulement).',
    'notes.belote':
      '162 points sont distribués à chaque manche, hors annonces, belote et capot. Le total attendu n’est donc qu’un repère.',
    'notes.tarot':
      'Les scores du Tarot sont à somme nulle : ce que le preneur gagne, les défenseurs le perdent (et inversement).',
    'notes.skyjo': 'La partie s’arrête dès qu’un joueur atteint 100 points. Le plus petit total gagne.',
    'notes.sixquiprend': 'La partie s’arrête dès qu’un joueur atteint 66 têtes de bœuf.',
    'notes.uno': 'Le gagnant de la manche marque les cartes restantes des autres. Premier à 500 points.',
    'notes.rummy': 'Adaptez le score limite et les scores négatifs à votre variante.',
    'notes.yams': 'Une manche = une feuille de Yams. Le plus grand total gagne.',
    'notes.millebornes': 'Premier à 5000 points sur l’ensemble des manches.',
    'notes.custom': 'À vous de régler le sens du classement, la fin de partie et le total par manche.',

    'lang.switch': 'English',
    'theme.toggle': 'Thème clair / sombre',
  },

  en: {
    'app.title': 'Marque-Points',
    'app.tagline': 'Score keeper for Papayoo & other games',
    'action.newGame': 'New game',
    'action.back': 'Back',
    'action.save': 'Save',
    'action.cancel': 'Cancel',
    'action.addRound': 'Add round',
    'action.saveRound': 'Save round',
    'action.delete': 'Delete',
    'action.deleteRound': 'Delete round',
    'action.undo': 'Undo last round',
    'action.finish': 'Finish game',
    'action.reopen': 'Resume game',
    'action.complete': 'Fill the rest',
    'action.export': 'Export',
    'action.import': 'Import',
    'action.addPlayer': 'Add a player',
    'action.addTeam': 'Add a team',
    'action.edit': 'Edit',
    'action.rename': 'Rename',

    'home.ongoing': 'Games in progress',
    'home.finished': 'Finished games',
    'home.empty': 'No games yet. Start one!',
    'home.emptyFinished': 'No finished games.',
    'home.rounds': '{count} round(s)',
    'home.leader': 'Leading: {name}',
    'home.winner': 'Winner: {name}',
    'home.winners': 'Winners: {name}',
    'home.data': 'Data',
    'home.storedLocal':
      'Your games are stored in this browser only. Export them to back up or move to another device.',
    'home.storedCloud':
      'Your games are stored on your Claude account: they outlive this browser and follow you from one device to the next.',
    'helper.open': 'Count the cards',
    'helper.title': '{name} — count the cards',
    'helper.total': 'Total: {total}',
    'helper.cards': '{count} card(s)',
    'helper.undo': 'Undo last',
    'helper.clear': 'Clear all',
    'helper.apply': 'Use this score',
    'helper.papayoo.hint':
      'Tap each Payoo you took in your tricks. The Papayoo is the 7 of the suit drawn at the start of the round.',
    'helper.papayoo.card': 'Papayoo (40)',
    'helper.hearts.hint': 'Tap ♥ once per heart you took.',
    'helper.hearts.queen': 'Queen of spades (13)',
    'helper.skyjo.hint':
      'Tap each card still in front of you. A column of three identical cards is removed from play — do not count it.',
    'helper.skyjo.doubled': 'Score doubled (closed without being lowest)',
    'helper.sixquiprend.hint': 'Tap the bull-head value of each card you took.',
    'action.copy': 'Copy',
    'action.close': 'Close',
    'export.title': 'Your games, as text',
    'export.hint':
      'Copy this text and keep it wherever you like. To bring it back into the app later, save it as a .json file and use Import.',
    'export.copied': 'Copied!',
    'export.copyByHand': 'Text selected — copy it',
    'home.importDone': 'Imported {count} game(s).',
    'home.importFailed': 'Could not read that file: nothing was imported.',
    'home.storageWarning':
      'This browser refuses to store data: the game will be lost when the tab closes.',

    'new.title': 'New game',
    'new.game': 'Game',
    'new.customName': 'Game label (optional)',
    'new.players': 'Players',
    'new.teams': 'Teams',
    'new.playerName': 'Player {n}',
    'new.teamName': 'Team {n}',
    'new.rules': 'Scoring rules',
    'new.direction': 'Winner',
    'new.directionLow': 'Lowest score',
    'new.directionHigh': 'Highest score',
    'new.endMode': 'Game ends',
    'new.endThreshold': 'When a score limit is reached',
    'new.endRounds': 'After a fixed number of rounds',
    'new.endManual': 'Whenever you decide',
    'new.target': 'Score limit',
    'new.roundsCount': 'Number of rounds',
    'new.roundSum': 'Expected round total',
    'new.roundSumHint': 'Leave empty when a round total is free.',
    'new.allowNegative': 'Allow negative scores',
    'new.start': 'Start',
    'new.errorPlayers': 'This game takes {min} to {max} {label}.',
    'new.errorNames': 'Two participants cannot share the same name.',
    'new.customLabel': 'Custom game',

    'game.round': 'Round',
    'game.total': 'Total',
    'game.rank': 'Rank',
    'game.newRound': 'Round {n}',
    'game.editRound': 'Edit round {n}',
    'game.noRounds': 'No rounds yet. Add the first one below.',
    'game.sum': 'Entered total: {sum}',
    'game.sumExpected': 'Entered total: {sum} / {expected}',
    'game.note': 'Note (optional)',
    'game.remainingThreshold': '{count} point(s) left before the game ends.',
    'game.remainingRounds': '{count} round(s) left.',
    'game.finished': 'Game over',
    'game.confirmDeleteGame': 'Permanently delete this game?',
    'game.confirmDeleteRound': 'Delete this round?',
    'game.confirmWarnings': 'Save anyway?',
    'game.standings': 'Standings',
    'game.gap': '+{gap}',
    'game.perRound': 'Round by round',

    'meta.papayooSuit': 'Papayoo (the 7 of…)',
    'meta.none': '—',

    'error.notANumber': '{player}: invalid score.',
    'error.notAnInteger': '{player}: the score must be a whole number.',
    'error.negative': '{player}: negative scores are not allowed in this game.',
    'warn.missing': 'No score entered for: {players} (counted as 0).',
    'warn.sum': 'The round totals {sum} instead of {expected}.',

    'notes.papayoo':
      'Payoos (1 to 20) are worth their face value — 210 points — and the Papayoo, the 7 of the suit drawn at the start of the round, is worth 40: a round hands out 250 penalty points. Lowest total wins.',
    'notes.hearts':
      'Each heart is worth 1 point and the queen of spades 13, so 26 points per round. Shooting the moon changes the round total (warning only).',
    'notes.belote':
      '162 points are dealt out each round, before declarations, belote and capot — so the expected total is only a hint.',
    'notes.tarot':
      'Tarot scores are zero-sum: whatever the taker gains, the defenders lose, and the other way round.',
    'notes.skyjo': 'The game stops as soon as a player reaches 100 points. Lowest total wins.',
    'notes.sixquiprend': 'The game stops as soon as a player reaches 66 bull heads.',
    'notes.uno': 'The round winner scores the cards left in the other hands. First to 500 wins.',
    'notes.rummy': 'Adjust the score limit and negative scores to match your variant.',
    'notes.yams': 'One round = one Yams sheet. Highest total wins.',
    'notes.millebornes': 'First to 5000 points across all rounds.',
    'notes.custom': 'Set the ranking direction, the end condition and the round total yourself.',

    'lang.switch': 'Français',
    'theme.toggle': 'Light / dark theme',
  },
};

export const LANGUAGES = Object.keys(STRINGS);

let current = 'fr';

export function detectLanguage() {
  const candidates = typeof navigator === 'undefined' ? [] : navigator.languages || [navigator.language];
  for (const tag of candidates) {
    if (!tag) continue;
    const base = tag.toLowerCase().split('-')[0];
    if (LANGUAGES.includes(base)) return base;
  }
  return 'fr';
}

export function setLanguage(lang) {
  current = LANGUAGES.includes(lang) ? lang : 'fr';
  return current;
}

export function getLanguage() {
  return current;
}

export function t(key, params = {}) {
  const template = STRINGS[current]?.[key] ?? STRINGS.fr[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (match, name) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match,
  );
}
