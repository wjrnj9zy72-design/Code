/**
 * Installing first, on a phone.
 *
 * On an iPhone, the app on the home screen and Safari keep separate data: a
 * group joined in Safari is not in the installed app, and Safari may wipe a
 * site not opened for weeks. So on an iPhone the invitation page leads with
 * installing — the steps, then the group's name and code to type in the app —
 * and joining in the browser is still there, below, not recommended.
 *
 * On Android, the installed app shares Chrome's data: joining here is safe,
 * and installing is one button when Chrome offers it.
 *
 * Wherever it runs, the app asks the browser to keep its data (a request
 * browsers grant or not, without asking anyone most of the time), and Home
 * reminds someone in a group, in a phone's browser and without an account,
 * how not to lose it.
 *
 * Calls back into app.js and the other views only from inside functions.
 */

import { escapeHtml, render, state, view } from './app.js';
import { groups, onHomeScreen } from './view-groups.js';
import { account } from './view-account.js';
import { inAppBrowser, phoneKind } from './helpers.js';
import { savePrefs } from './storage.js';
import { makeDialog } from './view-games.js';
import { t } from './i18n.js';

/** Chrome's offer to install, kept for when someone asks for it. */
let installOffer = null;

/** How long « Plus tard » quiets the reminder. */
const QUIET_MS = 30 * 24 * 60 * 60 * 1000;

/** This phone, if it is one — and not already the installed app, nor a messaging app's browser. */
export function phoneToInstall() {
  if (onHomeScreen() || inAppBrowser(navigator.userAgent)) return null;
  return phoneKind(navigator.userAgent, navigator.maxTouchPoints || 0);
}

/**
 * Once, on opening: listen for Chrome's offer to install, and ask the browser
 * to keep this app's data when there is something worth keeping.
 */
export function startInstall() {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    installOffer = event;
    if (view.querySelector('[data-install-slot]')) render();
  });
  window.addEventListener('appinstalled', () => {
    installOffer = null;
  });
  void keepData();
}

/**
 * Ask the browser not to clear this app's data on its own. Only once there is
 * something to lose — a group, an account — and only if not granted already:
 * some browsers ask the person, and a question about nothing is noise.
 */
export async function keepData() {
  try {
    if (!navigator.storage?.persist || !(groups().length || account())) return false;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

/** The steps that put the app on this phone's home screen. */
function stepsHtml(kind) {
  if (kind === 'android') {
    return installOffer
      ? `<div class="row"><button type="button" class="button button--primary" data-install-now>${escapeHtml(t('install.button'))}</button></div>`
      : `<ol class="steps small"><li>${escapeHtml(t('install.android1'))}</li><li>${escapeHtml(t('install.android2'))}</li></ol>`;
  }
  return `<ol class="steps small">
      <li>${escapeHtml(t('install.ios1'))}</li>
      <li>${escapeHtml(t('install.ios2'))}</li>
      <li>${escapeHtml(t('install.ios3'))}</li>
    </ol>`;
}

/**
 * The invitation page on an iPhone, in Safari: install, then join from the
 * app — with the group's name and code to type there.
 */
export function installFirstHtml(invitation) {
  const name = String(invitation.group || '').trim();
  const code = String(invitation.code || '').trim();
  return `
    <section class="card stack install-first" data-install-slot>
      <h2>${escapeHtml(t('install.firstTitle'))}</h2>
      <p class="small">${escapeHtml(t('install.firstWhy'))}</p>
      ${stepsHtml('ios')}
      <p class="small">${escapeHtml(t('install.thenJoin'))}</p>
      ${
        name && code
          ? `<p class="small"><strong>${escapeHtml(t('join.toHomeScreenWhat'))}</strong>
               ${escapeHtml(name)} · <span class="code-shown">${escapeHtml(code)}</span></p>
             <div class="row"><button type="button" class="button button--small" id="join-copy-code">${escapeHtml(t('join.toHomeScreenCopy'))}</button></div>`
          : ''
      }
      <p class="muted small">${escapeHtml(t('install.account'))}</p>
    </section>
    <div class="row">
      <button type="button" class="button button--small button--ghost" data-join-here>${escapeHtml(t('install.joinHere'))}</button>
    </div>`;
}

/** On Android, above the invitation's form: install, if Chrome offers it. */
export function installOfferHtml() {
  if (phoneToInstall() !== 'android' || !installOffer) return '<div data-install-slot></div>';
  return `
    <div class="card stack stack--tight" data-install-slot>
      <p class="small">${escapeHtml(t('install.androidWhy'))}</p>
      ${stepsHtml('android')}
    </div>`;
}

/**
 * On Home: someone in a group, in a phone's browser, with no account, can lose
 * the group when the browser clears its data. Said once a month at most.
 */
export function installReminderHtml() {
  const kind = phoneToInstall();
  if (!kind || !groups().length || account()) return '';
  if (Date.now() - (state.prefs.installQuietAt || 0) < QUIET_MS) return '';
  return `
    <section class="banner banner--warn stack stack--tight install-reminder" data-install-slot>
      <p class="small">${escapeHtml(t(kind === 'ios' ? 'install.reminderIos' : 'install.reminderAndroid'))}</p>
      <div class="row">
        <button type="button" class="button button--small" data-install-how="${kind}">${escapeHtml(t('install.how'))}</button>
        <button type="button" class="button button--small button--ghost" data-goto="#/settings">${escapeHtml(t('install.signIn'))}</button>
        <button type="button" class="button button--small button--ghost" data-install-later>${escapeHtml(t('install.later'))}</button>
      </div>
    </section>`;
}

/** Every install button on the page, bound. */
export function bindInstall(root = view) {
  root.querySelectorAll('[data-install-now]').forEach((node) => {
    node.addEventListener('click', async () => {
      if (!installOffer) return;
      const offer = installOffer;
      installOffer = null;
      offer.prompt();
      await offer.userChoice.catch(() => null);
      render();
    });
  });
  root.querySelectorAll('[data-join-here]').forEach((node) => {
    node.addEventListener('click', () => {
      state.joinHere = true;
      render();
    });
  });
  root.querySelectorAll('[data-install-later]').forEach((node) => {
    node.addEventListener('click', () => {
      state.prefs = { ...state.prefs, installQuietAt: Date.now() };
      savePrefs(state.prefs);
      render();
    });
  });
  root.querySelectorAll('[data-install-how]').forEach((node) => {
    node.addEventListener('click', () => {
      const dialog = makeDialog();
      dialog.innerHTML = `
        <div class="stack" data-install-slot>
          <h2>${escapeHtml(t('install.howTitle'))}</h2>
          ${stepsHtml(node.dataset.installHow)}
          <p class="muted small">${escapeHtml(t(node.dataset.installHow === 'ios' ? 'install.howIosAfter' : 'install.howAndroidAfter'))}</p>
          <div class="row"><button type="button" class="button button--ghost" data-install-close>${escapeHtml(t('action.close'))}</button></div>
        </div>`;
      dialog.querySelector('[data-install-close]').addEventListener('click', () => dialog.close());
      bindInstall(dialog);
      dialog.showModal();
    });
  });
}
