/**
 * Accounts, optional: sign in with an e-mail address and a code, no password.
 *
 * What an account keeps is what a device alone would lose: which groups it is
 * in — by marking the device's own keys as the account's, never a key in
 * clear — and the organiser's secrets of its polls. On a new device, or in a
 * browser that forgot everything, signing in gives a fresh key for each group
 * and the secrets back.
 *
 * Nobody has to: without an account, the app works as it always has. A poll's
 * visitor from a link never sees any of this.
 *
 * Calls back into app.js and the other views only from inside functions.
 */

import { escapeHtml, flash, render, state, view } from './app.js';
import {
  catchUpQuietly, deviceLabel, groups, myName, rememberGroup, setMyName,
} from './view-groups.js';
import { t } from './i18n.js';
import { loadAccount, saveAccount, savePrefs } from './storage.js';

/** The address a code was sent to, while the code is awaited. */
let awaiting = '';
/** When this device last told the account what it holds. */
let lastSync = 0;
/** One sync at a time. */
let syncing = null;

const RESYNC_MS = 10 * 60 * 1000;

/** The session of the signed-in account on this device, or null. */
export function account() {
  return loadAccount();
}

/**
 * A token that is still good: refreshed when it is about to end. Null when
 * signed out — or when the account can no longer be refreshed, which signs
 * this device out rather than fail at every call.
 */
export async function accountToken() {
  const session = account();
  if (!session || !state.remote) return null;
  if (session.expires - Date.now() > 60 * 1000) return session.access;
  try {
    const fresh = await state.remote.refreshSession(session.refresh);
    if (!fresh) throw new Error('no session');
    saveAccount({ ...fresh, email: fresh.email || session.email });
    return fresh.access;
  } catch (error) {
    // Refused (the account was removed, the refresh token spent): out. No
    // answer at all (offline): keep the session, and try again later.
    if (error?.status >= 400 && error?.status < 500) saveAccount(null);
    return null;
  }
}

/**
 * Tell the account what this device holds, and take what it holds that this
 * device does not. `restore` asks for the groups and secrets; without it, only
 * what is here goes up. Quiet: a failure is tried again at the next sync.
 */
export function syncAccount({ restore = true, force = false } = {}) {
  if (!account() || !state.remote) return Promise.resolve(false);
  if (!force && Date.now() - lastSync < RESYNC_MS) return Promise.resolve(false);
  if (syncing) return syncing;
  syncing = (async () => {
    let learnt = false;
    try {
      const token = await accountToken();
      if (!token) return false;
      if (restore) {
        const answer = await state.remote.accountRestore(token, groups().map((group) => group.id), deviceLabel());
        for (const group of answer?.groups || []) {
          if (!group?.id || !group?.key) continue;
          rememberGroup({ id: group.id, name: group.name, key: group.key, admits: Boolean(group.admits) });
          learnt = true;
        }
        const secrets = answer?.owners && typeof answer.owners === 'object' ? answer.owners : {};
        const held = state.prefs.organiser || {};
        const missing = Object.entries(secrets).filter(([id, secret]) => typeof secret === 'string' && !held[id]);
        if (missing.length) {
          state.prefs = { ...state.prefs, organiser: { ...held, ...Object.fromEntries(missing) } };
          savePrefs(state.prefs);
          learnt = true;
        }
        if (!myName() && answer?.name) setMyName(answer.name);
      }
      for (const group of groups()) {
        await state.remote.accountLink(token, group.key, myName()).catch(() => null);
      }
      for (const [id, secret] of Object.entries(state.prefs.organiser || {})) {
        await state.remote.accountOwner(token, id, secret).catch(() => null);
      }
      lastSync = Date.now();
    } catch {
      return false;
    } finally {
      syncing = null;
    }
    if (learnt) {
      await catchUpQuietly();
      render();
    }
    return learnt;
  })();
  return syncing;
}

/** Leave a group for good while signed in: no device of the account keeps it. */
export async function leaveWithAccount(group) {
  const token = await accountToken();
  if (!token || !group?.key) return;
  await state.remote.accountLeave(token, group.key).catch(() => null);
}

/* ---------------------------------------------------------------- screen --- */

/** The account section of the settings. */
export function accountHtml() {
  if (!state.remote) return '';
  const session = account();
  if (session) {
    return `
      <section class="section" id="account">
        <div class="section__head"><h2>${escapeHtml(t('account.title'))}</h2></div>
        <p class="small">${escapeHtml(t('account.signedIn', { email: session.email }))}</p>
        <p class="muted small">${escapeHtml(t('account.keeps'))}</p>
        <div class="row">
          <button type="button" class="button button--small" id="account-sync">${escapeHtml(t('account.sync'))}</button>
          <button type="button" class="button button--small button--ghost" id="account-out">${escapeHtml(t('account.signOut'))}</button>
        </div>
      </section>`;
  }
  return `
    <section class="section" id="account">
      <div class="section__head"><h2>${escapeHtml(t('account.title'))}</h2></div>
      <p class="muted small">${escapeHtml(t('account.why'))}</p>
      ${
        awaiting
          ? `<form id="account-code-form" class="card stack stack--tight">
               <label class="stack stack--tight">
                 <span class="small">${escapeHtml(t('account.codeSent', { email: awaiting }))}</span>
                 <input type="text" id="account-code" inputmode="numeric" autocomplete="one-time-code" maxlength="10"
                        placeholder="${escapeHtml(t('account.codePlaceholder'))}" />
               </label>
               <div class="row">
                 <button type="submit" class="button button--primary">${escapeHtml(t('account.signIn'))}</button>
                 <button type="button" class="button button--ghost" id="account-other">${escapeHtml(t('account.otherEmail'))}</button>
               </div>
             </form>`
          : `<form id="account-email-form" class="card stack stack--tight">
               <label class="stack stack--tight">
                 <span class="small">${escapeHtml(t('account.email'))}</span>
                 <input type="email" id="account-email" autocomplete="email" inputmode="email"
                        placeholder="${escapeHtml(t('account.emailPlaceholder'))}" />
               </label>
               <div class="row"><button type="submit" class="button button--primary">${escapeHtml(t('account.sendCode'))}</button></div>
               <p class="muted small">${escapeHtml(t('account.privacy'))}</p>
             </form>`
      }
    </section>`;
}

export function bindAccount() {
  view.querySelector('#account-email-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const field = view.querySelector('#account-email');
    const email = field.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      field.focus();
      return;
    }
    const button = event.currentTarget.querySelector('button[type=submit]');
    button.disabled = true;
    try {
      await state.remote.sendCode(email);
      awaiting = email;
    } catch (error) {
      flash(t(error?.status === 429 ? 'account.tooMany' : 'account.sendFailed'), 'error');
    }
    render();
  });
  view.querySelector('#account-code-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const code = view.querySelector('#account-code').value.replace(/\s+/g, '');
    if (!code) return;
    const button = event.currentTarget.querySelector('button[type=submit]');
    button.disabled = true;
    let session = null;
    try {
      session = await state.remote.verifyCode(awaiting, code);
    } catch {
      session = null;
    }
    if (!session) {
      flash(t('account.badCode'), 'error');
      render();
      return;
    }
    saveAccount({ ...session, email: session.email || awaiting });
    awaiting = '';
    flash(t('account.welcome'));
    render();
    await syncAccount({ force: true });
    render();
  });
  view.querySelector('#account-other')?.addEventListener('click', () => {
    awaiting = '';
    render();
  });
  view.querySelector('#account-sync')?.addEventListener('click', async (event) => {
    event.currentTarget.disabled = true;
    const learnt = await syncAccount({ force: true });
    flash(t(learnt ? 'account.synced' : 'account.upToDate'));
    render();
  });
  view.querySelector('#account-out')?.addEventListener('click', () => {
    saveAccount(null);
    flash(t('account.signedOut'));
    render();
  });
}
