/**
 * Groups on screen: joining, inviting, admitting, sharing the app, and the
 * lots of games opened with a code.
 *
 * Split out of app.js, which it calls back into: only from inside functions,
 * so the two may import each other.
 */

import {
  appLink, documentTitle, escapeHtml, flash, formatDate, isBusy, knocking, lookForUpdate, navigate,
  pullAny, render, showsGate, state, view,
} from './app.js';
import {
  getPoll, getSpend, persistPoll, persistSpend, pullPoll, pushFailed, replacePoll, replaceSpend,
} from './view-polls.js';
import { getGame, getList, persist, persistList, replaceGame, replaceList } from './view-lists.js';
import { getBoard, persistBoard, replaceBoard } from './view-ideas.js';
import {
  ask, exportGames, importGames, makeDialog, newGameView, openLinkDialog, openPasteDialog,
  shareUrl, showCopyDialog,
} from './view-games.js';
import { uid } from './model.js';
import { inAppBrowser } from './helpers.js';
import { progress } from './lists.js';
import { withMeFirst } from './people.js';
import { inGroup } from './dashboard.js';
import { saveGames, saveLists, savePolls, saveSpends, saveBoards, savePrefs } from './storage.js';
import { bindSwipes } from './swipe.js';
import { setLink } from './remote.js';
import { canSeal, newCode, readCode, seal, unseal } from './lock.js';
import { t } from './i18n.js';

/* ----------------------------------------------------------------- groups --- */

/**
 * A group is a circle of people and a key: the family, the Tuesday card
 * players. Holding its key is what lets this device start sharing, and what
 * shows it everything the group shares — games, lists and polls together.
 *
 * The keys live on this device and nowhere else: not in the repository, not in
 * the page, not in an export.
 */
export function groups() {
  const value = state.prefs.groups;
  return Array.isArray(value)
    ? value.filter((group) => group && typeof group.key === 'string' && group.key)
    : [];
}

export function rememberGroup(group) {
  const others = groups().filter((held) => held.id !== group.id);
  state.prefs = { ...state.prefs, groups: [...others, group] };
  savePrefs(state.prefs);
}

export function forgetGroup(id) {
  state.prefs = { ...state.prefs, groups: groups().filter((group) => group.id !== id) };
  savePrefs(state.prefs);
}

/** The groups by name, so the pastilles keep their order from render to render. */
export function groupsByName() {
  return [...groups()].sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

/**
 * Which group the three tabs are showing, '' for all of them.
 *
 * Kept in the preferences rather than in memory: looking at one group means
 * looking at its lists *and* its polls *and* its games, so the choice has to
 * survive a tab change and a reload. A filter left on a group this device has
 * since left means nothing any more, and falls back to all of them.
 */
/**
 * The pastille for what is in none of this device's groups: kept to oneself,
 * sent by link only, or from a group this device is not in. Under "Tous" it
 * is mixed in with everything else; here it is on its own, said as such.
 */
export const OUTSIDE_GROUPS = 'outside';

export function outsideGroups(document_) {
  return !groups().some((group) => inGroup(document_, group.id));
}

export function groupFilter() {
  const wanted = state.prefs.groupFilter || '';
  if (wanted === OUTSIDE_GROUPS) return groups().length ? wanted : '';
  return groups().some((group) => group.id === wanted) ? wanted : '';
}

export function setGroupFilter(id) {
  state.prefs = { ...state.prefs, groupFilter: id || '' };
  savePrefs(state.prefs);
}

/** The documents a tab shows, once the chosen group has had its say. */
export function shownDocs(documents) {
  const wanted = groupFilter();
  if (wanted === OUTSIDE_GROUPS) return documents.filter(outsideGroups);
  return wanted ? documents.filter((document_) => inGroup(document_, wanted)) : documents;
}

/**
 * What the chosen group is keeping out of sight, when it is keeping anything.
 *
 * A filter that empties a tab tells the same story as having nothing: the page
 * reads "no polls yet" while the polls are right there, one chip away. Worse
 * for what was never shared — it belongs to no group, so *every* group hides
 * it. So wherever the filter can empty a screen, it says how much it is
 * holding back, and offers to stop.
 */
export function hiddenByGroupHtml(all) {
  const wanted = groupFilter();
  if (!wanted) return '';
  const hidden = all.length - shownDocs(all).length;
  if (hidden <= 0) return '';
  return `
    <p class="muted small">
      ${escapeHtml(t('filter.hidden', { count: hidden }))}
      <button type="button" class="button button--small button--ghost" data-group-filter="">
        ${escapeHtml(t('filter.all'))}
      </button>
    </p>`;
}

/**
 * The group a device sends its new things to on its own, when it was asked to.
 * Only when there is exactly one: with several, the app asks each time rather
 * than choosing for you.
 */
function autoGroup() {
  if (!state.prefs.autoShare || !state.remote) return null;
  const held = groups();
  return held.length === 1 ? held[0] : null;
}

/**
 * The group a new thing goes into: the one being looked at, or the only one
 * this device sends to on its own.
 *
 * Looking at Mifa and writing a list means writing a list for Mifa. Choosing
 * the group again, in a dialog, for something that was made inside that very
 * filter, is a question whose answer is already on the screen — and one that,
 * unasked, left the list in no group at all.
 */
function groupForNew() {
  const chosen = groupFilter();
  if (chosen) return groups().find((group) => group.id === chosen) || null;
  return autoGroup();
}

export function resetGroupChoice() {
  state.newGroupChoice = { touched: false, id: null };
}

/** The group a new thing goes into, chip or no chip. */
/** The chip that means "only those who get the link". */
export const LINK_ONLY = '@lien';

/**
 * Where a new thing lands: a group, nowhere, or "link only".
 *
 * Link only still needs a group behind it. Creating anything in the database
 * takes a group's key — that is what keeps strangers from filling it — and the
 * key that created a thing is the one that may delete it. So a link-only thing
 * is written with a key of this device's, and the database is told the group
 * must not list it: not in its tabs, not in its calendar. Which group lends
 * the key matters to nobody but the one deleting, so it is the one being
 * looked at, or the first by name.
 */
export function destinationForNew() {
  const held = groups();
  if (!state.remote || !held.length) return { group: null, linkOnly: false };
  if (state.newGroupChoice.touched) {
    if (state.newGroupChoice.id === LINK_ONLY) {
      return { group: groupForNew() || groupsByName()[0], linkOnly: true };
    }
    const group = state.newGroupChoice.id ? held.find((item) => item.id === state.newGroupChoice.id) || null : null;
    return { group, linkOnly: false };
  }
  // Nobody has touched anything: the group being looked at, the only one there
  // is, or — with several and none chosen — none, said plainly on the form.
  return { group: groupForNew() || (held.length === 1 ? held[0] : null), linkOnly: false };
}

/** What a new document carries about where it went. */
export function landing(document_) {
  const { group, linkOnly } = destinationForNew();
  return {
    ...document_,
    shared: Boolean(group),
    groupId: group?.id || null,
    ...(linkOnly ? { linkOnly: true } : {}),
  };
}

/** The chips that say where it will land, and change it. */
export function willBeInHtml() {
  const held = groups();
  if (!state.remote || !held.length) return '';
  const { group, linkOnly } = destinationForNew();
  const on = linkOnly ? LINK_ONLY : group?.id || '';
  const chip = (id, label) => `
    <button type="button" class="chip ${on === id ? 'chip--on' : ''}"
            data-new-group="${escapeHtml(id)}" aria-pressed="${on === id ? 'true' : 'false'}">
      ${escapeHtml(label)}
    </button>`;
  const note = linkOnly ? t('groups.linkOnlyHint') : group ? '' : t('groups.willBeInNone');
  return `
    <div class="stack stack--tight">
      <span class="muted small">${escapeHtml(t('groups.willGoIn'))}</span>
      <div class="row row--tight" role="group" aria-label="${escapeHtml(t('groups.willGoIn'))}">
        ${groupsByName().map((item) => chip(item.id, item.name)).join('')}
        ${chip(LINK_ONLY, t('groups.linkOnly'))}
        ${chip('', t('groups.keepToMyself'))}
      </div>
      ${note ? `<p class="muted small">${escapeHtml(note)}</p>` : ''}
    </div>`;
}

/** The group a document belongs to, when it belongs to one this device knows. */
function groupOf(document_) {
  return document_?.groupId ? groups().find((group) => group.id === document_.groupId) || null : null;
}

/**
 * Which group a thing is in, said on the thing itself — and the way to put it
 * in one.
 *
 * Until now the only way to attach a list or a poll to a group was the Share
 * button, which reads as "give me a link", not as "put this in Mifa". With a
 * single group the app did it silently and nobody had to know; with two, it
 * stopped doing it and still nobody was told. So a document sat in no group,
 * invisible to everyone else and hidden by every filter, with nothing on the
 * page to say so or to fix it.
 */
export function inGroupHtml(document_) {
  if (!state.remote || !groups().length) return '';
  if (document_.linkOnly) {
    // No group to name, and none to put it in: the database fixed that at
    // its first write. What it is, and how it travels, is all there is to say.
    return `
      <div class="row row--tight">
        <span class="muted small">${escapeHtml(t('groups.inLinkOnly'))}</span>
      </div>`;
  }
  const group = groupOf(document_);
  return `
    <div class="row row--tight">
      <span class="muted small">
        ${escapeHtml(group ? t('groups.inGroup', { name: group.name }) : t('groups.inNone'))}
      </span>
      ${
        group
          ? groups().length > 1
            ? `<button type="button" class="button button--small button--ghost" data-copy-to-group="${escapeHtml(document_.id)}">
                 ${escapeHtml(t('groups.copyTo'))}
               </button>`
            : ''
          : `<button type="button" class="button button--small" data-put-in-group="${escapeHtml(document_.id)}">
               ${escapeHtml(t('groups.putIn'))}
             </button>`
      }
    </div>`;
}

/**
 * Put a document in a group, whichever kind it is. The document travels from
 * here on, and stops being hidden by the group pastilles.
 */
export async function putInGroup(id) {
  const poll = getPoll(id);
  const list = getList(id);
  const game = getGame(id);
  const spend = getSpend(id);
  const board = getBoard(id);
  const document_ = poll || list || game || spend || board;
  if (!document_ || !state.remote) return;

  const group = await askGroup();
  if (!group) {
    render();
    return;
  }

  const next = { ...document_, shared: true, groupId: group.id, updatedAt: Date.now() };
  try {
    await state.remote.put(next, group.key, organiserSecret(next.id));
  } catch (error) {
    pushFailed(next)(error);
    render();
    return;
  }

  flash(t('groups.putInDone', { name: group.name }));
  if (poll) replacePoll(next);
  else if (list) replaceList(next);
  else if (spend) replaceSpend(next);
  else if (board) replaceBoard(next);
  else replaceGame(next);
}

/**
 * Delete a whole document from its tab, whichever kind it is — what sliding
 * its card left leads to. Asked first, as on its own page: a list or an
 * account is usually everyone's, and deleting it deletes it for them too.
 */
export async function deleteDocument(id) {
  const poll = getPoll(id);
  const list = getList(id);
  const spend = getSpend(id);
  const board = getBoard(id);
  const game = getGame(id);
  const document_ = poll || list || spend || board || game;
  if (!document_) return;
  const question = poll
    ? 'polls.confirmDelete'
    : list
      ? 'lists.confirmDelete'
      : spend
        ? 'spends.confirmDelete'
        : board
          ? 'ideas.confirmDelete'
          : 'game.confirmDeleteGame';
  if (!(await ask(t(question), { confirmLabel: t('action.delete'), danger: true }))) {
    render();
    return;
  }

  if (poll) {
    state.polls = state.polls.filter((item) => item.id !== id);
    savePolls(state.polls);
  } else if (list) {
    state.lists = state.lists.filter((item) => item.id !== id);
    saveLists(state.lists);
  } else if (spend) {
    state.spends = state.spends.filter((item) => item.id !== id);
    saveSpends(state.spends);
  } else if (board) {
    state.boards = state.boards.filter((item) => item.id !== id);
    saveBoards(state.boards);
  } else {
    state.games = state.games.filter((item) => item.id !== id);
    saveGames(state.games);
  }
  if (state.store) void state.store.remove(id);
  if (state.remote) state.remote.remove(id, keyFor(document_), organiserSecret(id)).catch(() => {});
  flash(t('swipe.deleted', { name: documentTitle(document_) }));
  render();
}

/** The cards of a tab slide left to be deleted. */
export function bindDocSwipes() {
  bindSwipes('doc', (id) => void deleteDocument(id));
}

/**
 * Copy a thing into another group.
 *
 * A copy and not a move, and deliberately so: what is shared travels by its
 * own identifier, and the database fixes a document's group when it is first
 * written — a later write never moves it. Worse, a move that only happened
 * here would be undone by anyone else's device, which still holds the thing
 * under the old group and would write it back there at their next change. A
 * copy owes nothing to the old group: a new identifier, a new row, and the
 * original left exactly where it was.
 */
export async function copyToGroup(id) {
  const poll = getPoll(id);
  const list = getList(id);
  const game = getGame(id);
  const spend = getSpend(id);
  const board = getBoard(id);
  const document_ = poll || list || game || spend || board;
  if (!document_ || !state.remote) return;

  const group = await askGroup({ title: t('groups.copyWhere'), except: document_.groupId, always: true });
  if (!group) {
    render();
    return;
  }

  const now = Date.now();
  const fresh = {
    ...document_,
    id: uid(document_.id.split('_')[0] || 'id'),
    shared: true,
    groupId: group.id,
    // Copied into a group, it is the group's: a link-only original makes a
    // copy the group can see, which is the point of copying it there.
    linkOnly: false,
    // The event it was made for stays in the other group, with the original.
    event: null,
    // A copy is its own thing from here on: it is new to the group receiving
    // it, whatever age the original had reached.
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
  };
  // A copied poll is a new poll, and whoever copies it organises it.
  const copy = poll ? organise(fresh) : fresh;

  try {
    await state.remote.put(copy, group.key, organiserSecret(copy.id));
  } catch {
    flash(t('share.pushFailed'), 'error');
    render();
    return;
  }

  flash(t('groups.copiedTo', { name: group.name }));
  if (poll) {
    state.polls = [...state.polls, copy];
    persistPoll(copy);
    navigate(`#/poll/${copy.id}`);
  } else if (list) {
    state.lists = [...state.lists, copy];
    persistList(copy);
    navigate(`#/list/${copy.id}`);
  } else if (spend) {
    state.spends = [...state.spends, copy];
    persistSpend(copy);
    navigate(`#/spend/${copy.id}`);
  } else if (board) {
    state.boards = [...state.boards, copy];
    persistBoard(copy);
    navigate(`#/idea/${copy.id}`);
  } else {
    state.games = [...state.games, copy];
    persist(copy);
    navigate(`#/game/${copy.id}`);
  }
}

/**
 * The organiser of a poll: the device that created it, holding a secret the
 * database knows only by its fingerprint.
 *
 * Everyone else — the other members of the group as much as a visitor from a
 * link — ticks their evenings and adds their own name, and that is all: the
 * day, the closing, the question, the choices, the list of people and the
 * poll itself are the organiser's. The screen hides what is not theirs, and
 * the database, told nothing it can check, keeps what the organiser set.
 *
 * The secret lives on this device only. A poll made before the organiser
 * existed has none, and stays open to all, as it always was.
 */
export function organiserSecret(id) {
  return state.prefs.organiser?.[id] || null;
}

/** The organiser's secrets for the polls this device still holds. */
export function heldOrganiserSecrets() {
  const held = state.prefs.organiser || {};
  return Object.fromEntries(state.polls.filter((poll) => held[poll.id]).map((poll) => [poll.id, held[poll.id]]));
}

/**
 * Take back the organiser's secrets from an export. Only well-formed ones, and
 * never over a secret already here: the one this device holds is the one the
 * database knows. Returns how many polls this device organises again.
 */
export function restoreOrganiserSecrets(found) {
  if (!found || typeof found !== 'object' || Array.isArray(found)) return 0;
  const held = { ...state.prefs.organiser };
  let restored = 0;
  for (const [id, secret] of Object.entries(found)) {
    if (typeof secret !== 'string' || !/^[0-9a-f]{16,128}$/.test(secret) || held[id]) continue;
    held[id] = secret;
    restored += 1;
  }
  if (restored) {
    state.prefs = { ...state.prefs, organiser: held };
    savePrefs(state.prefs);
  }
  return restored;
}

export function isOrganiser(poll) {
  return !poll?.owned || Boolean(organiserSecret(poll.id));
}

/** Make this device the organiser of a new poll: a secret, kept here. */
export function organise(poll) {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const secret = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  state.prefs = { ...state.prefs, organiser: { ...state.prefs.organiser, [poll.id]: secret } };
  savePrefs(state.prefs);
  return { ...poll, owned: true };
}

/** The key a document was shared with, or the only group's, or none. */
export function keyFor(document_) {
  const held = groups();
  if (document_?.groupId) {
    const group = held.find((item) => item.id === document_.groupId);
    if (group) return group.key;
  }
  return held.length === 1 ? held[0].key : null;
}

/**
 * Which group to share this in. Answers straight away when there is only one
 * — the usual case — and asks when there are several.
 */
export async function askGroup({ title = null, except = null, keepToMyself = false, always = false } = {}) {
  const held = groups().filter((group) => group.id !== except);
  if (!held.length) return null;
  // One group and nothing to weigh it against: asking would be a question with
  // a single answer. With "keep it to myself" on the table there are two — and
  // an action worth a second look asks whatever the count.
  if (held.length === 1 && !keepToMyself && !always) return held[0];

  return new Promise((resolve) => {
    const dialog = makeDialog('dialog dialog--ask');
    dialog.innerHTML = `
      <div class="stack">
        <h2>${escapeHtml(title || t('groups.which'))}</h2>
        <div class="stack stack--tight">
          ${held
            .map(
              (group) => `<button type="button" class="button button--block" data-group="${escapeHtml(group.id)}">${escapeHtml(group.name)}</button>`,
            )
            .join('')}
        </div>
        ${
          keepToMyself
            ? `<button type="button" class="button button--block button--ghost" id="group-none">
                 ${escapeHtml(t('groups.keepToMyself'))}
               </button>
               <p class="muted small">${escapeHtml(t('groups.keepToMyselfHint'))}</p>`
            : ''
        }
        <div class="row">
          <button type="button" class="button" id="group-cancel">${escapeHtml(t('action.cancel'))}</button>
        </div>
      </div>`;

    let answered = false;
    const done = (group) => {
      if (answered) return;
      answered = true;
      resolve(group);
      dialog.close();
    };
    dialog.addEventListener('close', () => done(null));
    dialog.querySelector('#group-cancel').addEventListener('click', () => done(null));
    dialog.querySelector('#group-none')?.addEventListener('click', () => done(null));
    dialog.querySelectorAll('[data-group]').forEach((button) => {
      button.addEventListener('click', () => done(held.find((group) => group.id === button.dataset.group)));
    });
    dialog.showModal();
  });
}

/**
 * Share a document for the first time: pick the group, send it, and remember
 * which group it went to. Returns the shared document, or null when there was
 * no group to share it in or the database refused.
 */
export async function startSharing(document_) {
  if (document_.shared) return document_;
  const group = await askGroup();
  if (!group) {
    flash(t('groups.needOne'), 'error');
    render();
    return null;
  }

  const shared = { ...document_, shared: true, groupId: group.id, updatedAt: Date.now() };
  try {
    await state.remote.put(shared, group.key, organiserSecret(shared.id));
  } catch (error) {
    flash(remoteReason(error), 'error');
    render();
    return null;
  }
  return shared;
}

/** Long enough for any first name, short enough to leave room on a key's label. */
export const NAME_KEPT = 24;

/**
 * Who is holding this device — a first name, nothing more.
 *
 * It is asked once, when joining a group, because that is the moment it is
 * actually wanted: the group needs to know who has just come in, and the
 * person is going to type their name into the first list anyway.
 *
 * Where it goes: the label on this device's key, so the group can tell whose
 * device is whose — and, like any name typed into a list, into that list,
 * which travels to the group when the list is shared. Nowhere else.
 */
export function myName() {
  const value = state.prefs.me;
  return typeof value === 'string' ? value.trim().slice(0, NAME_KEPT) : '';
}

export function setMyName(name) {
  const clean = String(name || '').trim().slice(0, NAME_KEPT);
  if (clean === myName()) return clean;
  state.prefs = { ...state.prefs, me: clean };
  savePrefs(state.prefs);
  // A name given just now — on joining a group, most of the time — belongs in
  // the forms that are still empty, without waiting for the app to be reopened.
  offerMeInForms();
  return clean;
}

/**
 * Offer me as the first person of each form that is currently empty. Called
 * when the app starts and each time a form is emptied after creating
 * something — never on a redraw, so a name deleted by hand stays deleted.
 */
export function offerMeInForms() {
  state.newListPeople = withMeFirst(state.newListPeople, myName());
  state.newPollPeople = withMeFirst(state.newPollPeople, myName());
  state.newEventPeople = withMeFirst(state.newEventPeople, myName());
  state.newSpendPeople = withMeFirst(state.newSpendPeople, myName());
  // Games are left to newGameView: only there is it known whether this preset
  // is played by people or by teams.
  state.newGameTouched = false;
}

/**
 * Where this device is, and when it knocked — enough to tell one line from
 * another in the group's list of devices. The first name is *not* in here: it
 * travels beside it, and the database puts the two together, so a line reads
 * "Alice · écran d'accueil · 20 sept. 2026" and never "Alice · Alice · …".
 */
/**
 * The warning to show someone reading this inside Messenger, Instagram or the
 * like: what they do here stays here. It is the most likely way to arrive, since
 * the invitation travels by message — and the least durable place to land.
 */
export function inAppWarningHtml() {
  const app = inAppBrowser(navigator.userAgent);
  if (!app) return '';
  return `
    <p class="banner banner--warn">
      ${escapeHtml(t('browser.inApp', { app }))}
      <button type="button" class="button button--small" id="copy-here">
        ${escapeHtml(t('browser.copyLink'))}
      </button>
    </p>`;
}

export function bindInAppWarning() {
  view.querySelector('#copy-here')?.addEventListener('click', () => {
    showCopyDialog({
      title: t('browser.copyTitle'),
      hint: t('browser.copyHint'),
      text: location.href,
    });
  });
}

/** Whether this is the app added to a home screen rather than a browser tab. */
export function onHomeScreen() {
  return Boolean(matchMedia?.('(display-mode: standalone)')?.matches || navigator.standalone);
}

export function deviceLabel() {
  const standalone = onHomeScreen();
  const where = standalone ? t('groups.onHomeScreen') : t('groups.inBrowser');
  return `${where} · ${formatDate(Date.now())}`;
}

/**
 * Take in a key: the database says which group it opens, or refuses it. This is
 * the very first device of a group — the one nobody can invite, which starts
 * from the key the SQL editor printed.
 */
export async function joinGroup(key) {
  const clean = String(key || '').trim();
  if (!clean || !state.remote) return null;
  const group = await state.remote.groupOf(clean);
  if (!group) return null;
  rememberGroup({ id: group.id, name: group.name, key: clean, admits: Boolean(group.admits) });
  return group;
}

/**
 * Check every group this device believes it is in.
 *
 * A key can be cut off from the other side — a phone lost, someone who left.
 * Without this the group would sit in the list for ever, refusing everything
 * with no explanation. Asked once, on opening the app.
 */
export async function verifyGroups() {
  if (!state.remote) return false;
  let learnt = false;
  for (const group of groups()) {
    let found = null;
    try {
      found = await state.remote.groupOf(group.key);
    } catch {
      continue; // No answer is not an answer: the group stays.
    }
    if (!found) {
      forgetGroup(group.id);
      flash(t('gate.cutMe', { name: group.name }), 'error');
      learnt = true;
      continue;
    }
    if (found.name !== group.name || Boolean(found.admits) !== group.admits) {
      rememberGroup({ ...group, name: found.name || group.name, admits: Boolean(found.admits) });
      learnt = true;
    }
  }
  return learnt;
}

/* ------------------------------------------------- knocking, and admitting --- */

/**
 * A device does not let itself into a group: it knocks, and waits.
 *
 * What it keeps while it waits is a ticket — a secret the database handed it
 * once. Accepted, that very ticket becomes its key; refused, it never opened
 * anything. So the wait costs nothing and shows nothing, and an invitation that
 * goes astray is a knock at the door rather than a stranger in the house.
 */
export function pendings() {
  const value = state.prefs.pendings;
  return Array.isArray(value)
    ? value.filter((knock) => knock && typeof knock.ticket === 'string' && knock.ticket)
    : [];
}

/**
 * Knocks are kept generously — a ticket is handed over once and stored nowhere
 * else — but not without end: a device that knocks at door after door without
 * ever being let in would grow a list nobody reads, and claim every one of them
 * at each start.
 */
const KNOCKS_KEPT = 20;

export function rememberPending(knock) {
  const others = pendings().filter((held) => held.ticket !== knock.ticket);
  state.prefs = { ...state.prefs, pendings: [...others, knock].slice(-KNOCKS_KEPT) };
  savePrefs(state.prefs);
}

export function forgetPending(ticket) {
  state.prefs = { ...state.prefs, pendings: pendings().filter((knock) => knock.ticket !== ticket) };
  savePrefs(state.prefs);
}

/** The knock this device is still waiting on for that group, if any. */
export function pendingFor(name) {
  const wanted = String(name || '').trim().toLowerCase();
  if (!wanted) return null;
  return pendings().find((knock) => String(knock.groupName || '').trim().toLowerCase() === wanted) || null;
}

/**
 * Ask the database where a knock stands. Accepted, the group is remembered with
 * the ticket as its key and everything it shares comes in; refused, the knock
 * is forgotten. Returns the answer's status, or null when nothing was learnt.
 */
export async function checkPending(knock) {
  if (!state.remote) return null;
  let answer = null;
  try {
    answer = await state.remote.claim(knock.ticket);
  } catch {
    return null;
  }

  if (answer.status === 'ok') {
    // A device that is somehow already in this group keeps the key it has: the
    // ticket it was just handed is an ordinary key, and the one it holds may be
    // the only one in the group that lets anyone in.
    const alreadyIn = groups().find((item) => item.id === answer.id);
    const group = alreadyIn || { id: answer.id, name: answer.name || knock.groupName, key: knock.ticket, admits: false };
    rememberGroup(group);
    forgetPending(knock.ticket);
    let taken = 0;
    try {
      taken = await catchUpWith(group);
    } catch {
      // In the group either way; what it shares can be fetched later.
    }
    // Just let in: the one moment they will listen to "keep your return link".
    // Said in the line that greets them rather than in a dialog — a question
    // that blocks the screen on the way in is a question in the wrong place.
    flash(taken
      ? t('groups.joinedWithKeepLink', { name: group.name, count: taken })
      : t('groups.joinedKeepLink', { name: group.name }));
    return 'ok';
  }

  if (answer.status === 'refused') {
    forgetPending(knock.ticket);
    flash(t('gate.refusedMe', { name: knock.groupName }), 'error');
    return 'refused';
  }

  // 'unknown' means the knock is gone — expired, or the group was deleted.
  if (answer.status === 'unknown') {
    forgetPending(knock.ticket);
    flash(t('gate.lostMe', { name: knock.groupName }), 'error');
    return 'unknown';
  }

  return 'waiting';
}

/** Look in on every knock at once — on opening the app, or on demand. */
export async function checkAllPendings() {
  let learnt = false;
  for (const knock of pendings()) {
    const status = await checkPending(knock);
    if (status && status !== 'waiting') learnt = true;
  }
  return learnt;
}

/**
 * What the group's gatekeeper sees: who is knocking, and which devices are in.
 * Both are asked of the database and kept until something changes them, so a
 * redraw does not knock again.
 */
export function gate() {
  if (!state.gate) state.gate = { requests: {}, devices: {}, asked: {}, at: {} };
  return state.gate;
}

export function forgetGate(groupId) {
  const held = gate();
  delete held.requests[groupId];
  delete held.devices[groupId];
  delete held.asked[groupId];
  delete held.at[groupId];
}

/**
 * Ask again for what the gatekeeper is looking at, quietly, while the overview
 * is open — someone knocking on the other side of the room must not stay
 * invisible until the app is closed and opened again.
 */
export async function refreshGate() {
  let changed = false;
  for (const group of groups()) {
    if (group.admits === false) continue;
    const before = JSON.stringify(gate().requests[group.id] ?? null)
      + JSON.stringify(gate().devices[group.id] ?? null);
    gate().asked[group.id] = false;
    await loadGate(group);
    const after = JSON.stringify(gate().requests[group.id] ?? null)
      + JSON.stringify(gate().devices[group.id] ?? null);
    if (before !== after) changed = true;
  }
  return changed;
}

/**
 * Load a group's knocks and devices, once — and never draw over a message
 * nobody has read yet: a redraw consumes it, and a second one would wipe it.
 */
export async function loadGate(group) {
  const held = gate();
  if (held.asked[group.id]) return false;
  held.asked[group.id] = true;
  if (!state.remote) return false;

  try {
    const [requests, devices] = await Promise.all([
      state.remote.requests(group.key),
      state.remote.groupKeys(group.key),
    ]);
    held.requests[group.id] = requests;
    held.devices[group.id] = devices;
    held.at[group.id] = Date.now();
    return true;
  } catch (error) {
    // Two very different refusals, and taking one for the other used to cost
    // the gatekeeper their own door: the database saying "this key does not let
    // people in" is settled, while a network that failed says nothing at all.
    if (/ne fait pas entrer/i.test(String(error?.message || ''))) {
      rememberGroup({ ...group, admits: false });
      return true;
    }
    held.asked[group.id] = false;
    return false;
  }
}

/**
 * Whether this device's key lets people in. Groups remembered before the
 * question existed do not say, so the database is asked once.
 */
export async function refreshGroup(group) {
  if (!state.remote) return false;
  let found = null;
  try {
    found = await state.remote.groupOf(group.key);
  } catch {
    return false;
  }
  if (!found) return false;
  rememberGroup({ ...group, name: found.name || group.name, admits: Boolean(found.admits) });
  return true;
}

/**
 * Fetch what every group shares, for all of them at once.
 *
 * This is what "the other phone pushed something" needs: a game played in
 * Safari and a list ticked off in the app on the home screen are two devices as
 * far as the database is concerned, and nothing but this brings one's work to
 * the other when neither has the document open.
 */
export async function catchUpAll() {
  let taken = 0;
  for (const group of groups()) {
    try {
      taken += await catchUpWith(group);
    } catch {
      // One group out of reach is not a reason to skip the others.
    }
  }
  // A link-only poll is listed for no group, on purpose — so no group's
  // catch-up brings its answers. The devices that hold one ask for it by
  // name instead: few of them, and the only way anyone would hear back.
  for (const poll of state.polls.filter((held) => held.shared && held.linkOnly && !held.archivedAt)) {
    try {
      if (await pullPoll(poll.id)) taken += 1;
    } catch {
      // Out of reach now; the next catch-up asks again.
    }
  }
  state.syncedAt = Date.now();
  return taken;
}

/** Not more often than this, when it happens on its own. */
const SYNC_EVERY = 20000;

/**
 * Catch up by itself: when the app opens, and each time it comes back to the
 * front — which on a phone is what "I switched from Safari to the app" means.
 */
export async function catchUpQuietly() {
  if (!state.remote || !groups().length) return;
  if (state.syncedAt && Date.now() - state.syncedAt < SYNC_EVERY) return;
  const taken = await catchUpAll();
  const changed = showsGate() ? await refreshGate() : false;
  if ((taken || changed) && !isBusy()) render();
}

/**
 * Fetch everything the group shares that this device is missing or behind on.
 * The database hands over ids and their dates, so a device that is up to date
 * asks for nothing more.
 */
export async function catchUpWith(group) {
  if (!state.remote) return 0;
  const rows = await state.remote.groupDocs(group.key);
  let taken = 0;
  for (const row of rows) {
    const held = getGame(row.id) || getList(row.id) || getPoll(row.id);
    if (held && (row.updatedAt || 0) <= (held.updatedAt || 0)) continue;
    if (await pullAny(row.id)) taken += 1;
  }
  return taken;
}

/* ------------------------------------------------------------------- lots --- */

/**
 * The lots shared from this device, newest first. Their codes are kept so a
 * code can be read again later, and so a lot can be revoked — both of which
 * are the point of the sharing key: the shares stay in one pair of hands.
 */
export function lots() {
  const value = state.prefs.lots;
  return Array.isArray(value) ? value.filter((lot) => lot && typeof lot.id === 'string') : [];
}

/**
 * Remembered shares are kept generously: the entry is the only record of a
 * lot's id and its code, so dropping one leaves a live share that can never be
 * read again nor revoked. Two hundred of them weigh some twenty kilobytes, and
 * nobody shares two hundred times.
 */
const LOTS_KEPT = 200;

function rememberLot(lot) {
  state.prefs = { ...state.prefs, lots: [lot, ...lots()].slice(0, LOTS_KEPT) };
  savePrefs(state.prefs);
}

function forgetLot(id) {
  state.prefs = { ...state.prefs, lots: lots().filter((lot) => lot.id !== id) };
  savePrefs(state.prefs);
}

/** Why the database refused, in words that say what to do about it. */
export function remoteReason(error) {
  const text = String(error?.message || '');
  // "That function does not exist" has two causes, and they call for opposite
  // things: the database has not been brought up to date, or this copy of the app
  // has not. Only whoever set the database up can do the first, so the message
  // names both and points at the update button rather than at the SQL guide.
  if (error?.status === 404 || /PGRST202/.test(text)) {
    return t(groups().some((group) => group.admits) ? 'shareApp.needsSql' : 'shareApp.needsUpdate');
  }
  if (/cle de (partage|groupe)/i.test(text)) return t('groups.refused');
  return t('shareApp.failed');
}

/* --------------------------------------------------------- sharing the app --- */

/**
 * Share the app, on its own or carrying games.
 *
 * A link cannot carry the games themselves: ten of them would make an address
 * no one could paste and no QR code could hold. So the games are sent to the
 * shared database — which is what makes them openable elsewhere anyway — and
 * the link carries one short identifier standing for the lot.
 *
 * A lot is not something anyone may create: the database asks for the sharing
 * key first, and that key lives only on the devices its holder typed it into.
 * Opening one asks the receiver for a six-digit code, drawn afresh for every
 * share — so a link passed on to someone else is worth nothing on its own.
 */
function openShareAppDialog() {
  // Games and lists travel together: they are documents of the same kind to
  // the database, and "everything I have" is what the link is asked for.
  const games = [...state.games, ...state.lists, ...state.polls, ...state.spends, ...state.boards].sort((a, b) => b.updatedAt - a.updatedAt);
  const held = groups();
  // Without a shared database there is nothing to attach: the app alone, then.
  if (!state.remote || !games.length) {
    void shareUrl({
      url: appLink(),
      title: t('shareApp.title'),
      hint: t('shareApp.hint'),
      text: t('shareApp.text'),
    });
    return;
  }

  const off = held.length ? '' : ' disabled';
  const dialog = makeDialog();
  dialog.innerHTML = `
    <div class="stack">
      <h2>${escapeHtml(t('shareApp.title'))}</h2>
      <div class="stack stack--tight" role="radiogroup" aria-label="${escapeHtml(t('shareApp.title'))}">
        <label class="choice">
          <input type="radio" name="share-kind" value="app" checked />
          <span>${escapeHtml(t('shareApp.kindApp'))}<span class="muted small"> — ${escapeHtml(t('shareApp.kindAppHint'))}</span></span>
        </label>
        <label class="choice${held.length ? '' : ' choice--off'}">
          <input type="radio" name="share-kind" value="all"${off} />
          <span>${escapeHtml(t('shareApp.kindAll', { count: games.length }))}</span>
        </label>
        <label class="choice${held.length ? '' : ' choice--off'}">
          <input type="radio" name="share-kind" value="some"${off} />
          <span>${escapeHtml(t('shareApp.kindSome'))}</span>
        </label>
      </div>

      ${held.length ? '' : `<p class="banner">${escapeHtml(t('groups.needOne'))}</p>`}

      <div class="stack stack--tight" id="share-pick" hidden>
        <p class="muted small">${escapeHtml(t('shareApp.pickHint'))}</p>
        ${games
          .map(
            (game) => `
              <label class="choice">
                <input type="checkbox" data-share-id="${escapeHtml(game.id)}" />
                <span>${escapeHtml(documentTitle(game))}<span class="muted small"> — ${escapeHtml(formatDate(game.updatedAt))}</span></span>
              </label>`,
          )
          .join('')}
      </div>

      <p class="muted small" id="share-note" hidden>${escapeHtml(t('shareApp.note'))}</p>
      <p class="banner banner--warn" id="share-error" hidden></p>
      <div class="row">
        <button type="button" class="button button--primary" id="share-make">${escapeHtml(t('shareApp.make'))}</button>
        <button type="button" class="button" id="share-cancel">${escapeHtml(t('action.cancel'))}</button>
      </div>
    </div>`;

  const close = () => dialog.close();
  const button = dialog.querySelector('#share-make');
  const error = dialog.querySelector('#share-error');
  const kind = () => dialog.querySelector('input[name="share-kind"]:checked').value;

  const refresh = () => {
    dialog.querySelector('#share-pick').hidden = kind() !== 'some';
    dialog.querySelector('#share-note').hidden = kind() === 'app';
    error.hidden = true;
  };
  dialog.querySelectorAll('input[name="share-kind"]').forEach((input) => {
    input.addEventListener('change', refresh);
  });

  const fail = (message) => {
    error.textContent = message;
    error.hidden = false;
    button.disabled = false;
    button.textContent = t('shareApp.make');
  };

  dialog.querySelector('#share-cancel').addEventListener('click', close);
  button.addEventListener('click', async () => {
    const choice = kind();
    if (choice === 'app') {
      close();
      void shareUrl({
        url: appLink(),
        title: t('shareApp.title'),
        hint: t('shareApp.hint'),
        text: t('shareApp.text'),
      });
      return;
    }

    const chosen =
      choice === 'all'
        ? games
        : [...dialog.querySelectorAll('input[data-share-id]:checked')]
            .map((input) =>
              getGame(input.dataset.shareId) || getList(input.dataset.shareId) || getPoll(input.dataset.shareId))
            .filter(Boolean);
    if (!chosen.length) return fail(t('shareApp.pickNone'));

    button.disabled = true;
    button.textContent = t('share.sending');

    const setId = uid('lot');
    const code = newCode();
    const ids = chosen.map((game) => game.id);
    const group = await askGroup();
    if (!group) return fail(t('groups.needOne'));

    try {
      // The key first, and only then the documents: a key the database no
      // longer recognises must not cost an evening its privacy on the way to
      // being told so.
      if (!(await state.remote.groupOf(group.key))) return fail(t('groups.refused'));
      // Sealed where the browser can: then the stored lot holds no identifier
      // at all, only their encrypted form.
      const contents = canSeal() ? { sealed: await seal(ids, code) } : { ids };
      await shareGames(chosen, group);
      await state.remote.putSet(setId, contents, code, group.key);
    } catch (error_) {
      return fail(remoteReason(error_));
    }

    rememberLot({ id: setId, code, count: chosen.length, createdAt: Date.now() });
    close();
    // The games are shared now, and the share is remembered: the list shows it.
    render();
    showLotLink(setId, code, chosen.length);
  });

  dialog.showModal();
}

/**
 * The link and its code, side by side but never in the same message: the link
 * is what gets sent, the code is what is said out loud. Copying the link alone
 * is what the button does, on purpose.
 */
function showLotLink(setId, code, count) {
  showCopyDialog({
    title: t('shareSet.title'),
    hint: t('shareSet.hint', { count }),
    text: setLink(location, setId),
    qr: true,
    code,
    send: true,
  });
}

/**
 * Put every one of these games in the shared database, marking as shared those
 * that were not — a link that hands over a game no one sent would open nothing.
 */
async function shareGames(games, group) {
  try {
    for (const document_ of games) {
      const next = document_.shared
        ? document_
        : { ...document_, shared: true, groupId: group.id, updatedAt: Date.now() };
      await state.remote.put(next, group.key, organiserSecret(next.id));
      if (next === document_) continue;
      state.games = state.games.map((item) => (item.id === next.id ? next : item));
      state.lists = state.lists.map((item) => (item.id === next.id ? next : item));
      state.polls = state.polls.map((item) => (item.id === next.id ? next : item));
      if (state.store) void state.store.save(next);
    }
  } finally {
    // Whatever went through is written down, so a failure halfway is not lost.
    saveGames(state.games);
    saveLists(state.lists);
    savePolls(state.polls);
  }
}

/* --------------------------------------------------------- my own shares --- */

/**
 * The shares made from this device: their code, to read again, and a way to
 * revoke them. Revoking takes the sharing key, so a link handed out can be
 * taken back — by its author, and by nobody else.
 */
function openMySharesDialog() {
  const dialog = makeDialog();
  const close = () => dialog.close();

  const draw = () => {
    const mine = lots();
    dialog.innerHTML = `
      <div class="stack">
        <h2>${escapeHtml(t('lots.title', { count: mine.length }))}</h2>
        <p class="muted small">${escapeHtml(t('lots.hint'))}</p>
        <p class="banner banner--warn" id="lots-error" hidden></p>
        ${
          mine.length
            ? `<div class="stack stack--tight">${mine
                .map(
                  (lot) => `
                    <div class="lot">
                      <div>
                        <span class="lot__code">${escapeHtml(lot.code || '······')}</span>
                        <span class="muted small">${escapeHtml(t('lots.line', {
                          count: lot.count || 0,
                          date: formatDate(lot.createdAt || Date.now()),
                        }))}</span>
                      </div>
                      <div class="row">
                        <button type="button" class="button button--small" data-lot-link="${escapeHtml(lot.id)}">${escapeHtml(t('lots.link'))}</button>
                        <button type="button" class="button button--small button--ghost" data-lot-revoke="${escapeHtml(lot.id)}">${escapeHtml(t('lots.revoke'))}</button>
                      </div>
                    </div>`,
                )
                .join('')}</div>`
            : `<p class="muted small">${escapeHtml(t('lots.empty'))}</p>`
        }
        <div class="row">
          <button type="button" class="button" id="lots-close">${escapeHtml(t('action.close'))}</button>
        </div>
      </div>`;

    dialog.querySelector('#lots-close').addEventListener('click', close);

    dialog.querySelectorAll('[data-lot-link]').forEach((node) => {
      node.addEventListener('click', () => {
        const lot = lots().find((item) => item.id === node.dataset.lotLink);
        if (lot) showLotLink(lot.id, lot.code, lot.count || 0);
      });
    });

    dialog.querySelectorAll('[data-lot-revoke]').forEach((node) => {
      node.addEventListener('click', async () => {
        const id = node.dataset.lotRevoke;
        if (!(await ask(t('lots.confirmRevoke'), { confirmLabel: t('lots.revoke'), danger: true }))) return;
        node.disabled = true;
        node.textContent = t('share.sending');
        let gone = false;
        try {
          gone = await state.remote.forgetSet(id, groups()[0]?.key || '');
        } catch (error) {
          const line = dialog.querySelector('#lots-error');
          line.textContent = remoteReason(error);
          line.hidden = false;
          node.disabled = false;
          node.textContent = t('lots.revoke');
          return;
        }
        // Not there any more either way: stop remembering it.
        forgetLot(id);
        draw();
        if (!gone) {
          const line = dialog.querySelector('#lots-error');
          line.textContent = t('lots.alreadyGone');
          line.hidden = false;
        }
        render();
      });
    });
  };

  draw();
  dialog.showModal();
}

/* ------------------------------------------------- opening a shared lot --- */

/**
 * Ask for the six-digit code, and give back the game ids it unlocks.
 *
 * The database allows ten wrong answers, then closes that lot for good — which
 * is what makes six digits enough to be worth typing. Resolves null when the
 * person gives up, or when the answer leaves nothing to try again with.
 */
function askLotCode(id) {
  return new Promise((resolve) => {
    const dialog = makeDialog('dialog dialog--ask');
    dialog.innerHTML = `
      <div class="stack">
        <h2>${escapeHtml(t('shareSet.codeTitle'))}</h2>
        <p class="muted small">${escapeHtml(t('shareSet.codeHint'))}</p>
        <input type="text" id="lot-code" class="code-input" inputmode="numeric" autocomplete="one-time-code"
               maxlength="7" aria-label="${escapeHtml(t('shareSet.codeTitle'))}" />
        <p class="banner banner--warn" id="lot-error" hidden></p>
        <div class="row">
          <button type="button" class="button button--primary" id="lot-open">${escapeHtml(t('openLink.open'))}</button>
          <button type="button" class="button" id="lot-cancel">${escapeHtml(t('action.cancel'))}</button>
        </div>
      </div>`;

    const button = dialog.querySelector('#lot-open');
    const error = dialog.querySelector('#lot-error');
    const done = (value) => { resolve(value); dialog.close(); };
    // Escape closes a dialog without asking anyone: whoever is waiting on this
    // promise must be told, or the view stays on "fetching" for good.
    dialog.addEventListener('close', () => resolve(null));
    const fail = (message) => {
      error.textContent = message;
      error.hidden = false;
      button.disabled = false;
      button.textContent = t('openLink.open');
      dialog.querySelector('#lot-code').select();
    };

    dialog.querySelector('#lot-cancel').addEventListener('click', () => done(null));
    button.addEventListener('click', async () => {
      const code = readCode(dialog.querySelector('#lot-code').value);
      if (!code) return fail(t('shareSet.badCode'));

      button.disabled = true;
      button.textContent = t('share.sending');

      let answer = null;
      try {
        answer = await state.remote.openSet(id, code);
      } catch (error_) {
        return fail(remoteReason(error_));
      }

      if (answer.status === 'wrong') return fail(t('shareSet.wrongCode', { left: answer.left }));
      if (answer.status === 'locked') {
        flash(t('shareSet.locked'), 'error');
        return done(null);
      }
      if (answer.status !== 'ok') {
        flash(t('shareSet.notFound'), 'error');
        return done(null);
      }

      const ids = answer.contents?.sealed
        ? await unseal(answer.contents.sealed, code)
        : answer.contents?.ids;
      const clean = Array.isArray(ids) ? ids.filter((value) => typeof value === 'string') : [];
      // The code was right, so a lot that will not open is a lot this browser
      // cannot unseal — over http, where Web Crypto is not offered.
      if (!clean.length) return fail(t('shareSet.cannotUnseal'));
      done(clean);
    });

    dialog.showModal();
    dialog.querySelector('#lot-code').focus();
  });
}

/**
 * Take in a lot of games from its link: the code, then the list, then each
 * game.
 *
 * A game already here is merged rather than replaced, exactly as a single
 * shared game is, so opening the link twice costs nothing and opening it while
 * a game is in progress loses no round.
 */
export async function openSet(id) {
  if (!state.remote) {
    flash(t('shareSet.noDatabase'), 'error');
    return;
  }

  const ids = await askLotCode(id);
  if (!ids) return;

  // Everything, even what is already here: the point of a lot shared again is
  // to bring what has happened since, and pulling merges rather than replaces.
  for (const id_ of ids) await pullAny(id_);

  const held = ids.filter((id_) => getGame(id_) || getList(id_) || getPoll(id_)).length;
  if (!held) {
    flash(t('shareSet.notFound'), 'error');
    return;
  }
  flash(
    held === ids.length
      ? t('shareSet.opened', { count: held })
      : t('shareSet.openedSome', { count: held, total: ids.length }),
  );
}

export function bindHome() {
  const search = view.querySelector('#search');
  search?.addEventListener('input', (event) => {
    state.search = event.target.value;
    const at = event.target.selectionStart;
    render();
    const again = view.querySelector('#search');
    if (again) {
      again.focus();
      try { again.setSelectionRange(at, at); } catch { /* not a text field */ }
    }
  });
}

/**
 * The data section, which belongs to the app rather than to any one tab: the
 * app's own link, what leaves the device and what comes back.
 */
export function bindData() {
  view.querySelector('#look-update')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    const answer = await lookForUpdate();
    button.disabled = false;
    if (answer === 'coming') flash(t('data.updateComing'));
    else if (answer === 'current') flash(t('data.updateNone'));
    else flash(t('data.updateUnknown'), 'error');
    render();
  });

  view.querySelector('#share-app')?.addEventListener('click', openShareAppDialog);
  view.querySelector('#my-shares')?.addEventListener('click', openMySharesDialog);

  view.querySelector('#auto-share')?.addEventListener('change', (event) => {
    state.prefs = { ...state.prefs, autoShare: event.target.checked };
    savePrefs(state.prefs);
  });

  view.querySelector('#export')?.addEventListener('click', exportGames);
  view.querySelector('#import-paste')?.addEventListener('click', openPasteDialog);
  view.querySelector('#open-link')?.addEventListener('click', openLinkDialog);

  const fileInput = view.querySelector('#import-file');
  view.querySelector('#import')?.addEventListener('click', () => fileInput?.click());
  fileInput?.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    try {
      importGames(await file.text());
    } catch {
      flash(t('home.importFailed'), 'error');
    }
    render();
  });
}
