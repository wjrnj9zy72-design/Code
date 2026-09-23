/**
 * A stand-in for the hosted database: the same functions, the same answers,
 * including the refusals — mirrors docs/DEPLOIEMENT.md.
 *
 *   node tests/navigateur/fausse-base.mjs              port 8123, la base à jour
 *   OLD=1 PORT=8124 node tests/navigateur/fausse-base.mjs   une base d'avant les groupes
 *   REPLACE=1 …                                          une base d'avant la fonte des votes
 *
 * Lancée par lancer.sh, une neuve pour chaque suite : elle garde tout en mémoire.
 */
import { createServer } from 'node:http';

const rows = new Map(); // id → { data, code, tries, group }
const INVITES = new Map(); // code → { group, at }
const MISSES = new Map(); // nom de groupe → essais ratés
const CALENDARS = new Map();
const GONE = new Set(); // marque_points_gone : ce qui a été supprimé ne revient pas
const KEY = 'test-anon-key';
// La clé fondatrice d'un groupe fait entrer ; celles distribuées ensuite non.
const GROUPS = new Map([
  ['la-cle-famille', { id: 'grp_famille', name: 'Mifa' }],
  ['la-cle-copains', { id: 'grp_copains', name: 'Copains du mardi' }],
]);
const ADMITS = new Set(['la-cle-famille', 'la-cle-copains']);
const KEYS = [
  { id: 'key_famille', group: 'grp_famille', label: 'première clé', admits: true, key: 'la-cle-famille', at: Date.now() - 86400000 },
  { id: 'key_copains', group: 'grp_copains', label: 'première clé', admits: true, key: 'la-cle-copains', at: Date.now() - 86400000 },
];
const REQUESTS = []; // { id, group, name, label, ticket, state, at }
const PERSONS = []; // { id, group, name, token }
const port = Number(process.env.PORT) || 8123;
const old = process.env.OLD === '1';

createServer(async (req, res) => {
  const send = (status, body) => {
    res.writeHead(status, {
      'content-type': 'application/json',
      'access-control-allow-origin': '*',
      'access-control-allow-headers': '*',
      'access-control-allow-methods': 'POST,OPTIONS',
    });
    res.end(body === undefined ? '' : JSON.stringify(body));
  };
  const raise = (message) => send(400, { code: 'P0001', message });
  if (req.method === 'OPTIONS') return send(204);
  if (req.headers.apikey !== KEY) return send(401, { message: 'Invalid API key' });

  let body = '';
  for await (const chunk of req) body += chunk;
  const at = body ? JSON.parse(body) : {};
  const fn = req.url.split('/').pop();
  const lot = (id) => { const row = rows.get(id); return row?.code ? row : null; };

  if (fn === 'marque_points_get') {
    const row = rows.get(at.p_id);
    return send(200, row && !row.code ? row.data : null); // a lot is invisible here
  }
  if (fn === 'marque_points_put') {
    if (lot(at.p_id)) return send(204); // never overwrites a lot
    const held = rows.get(at.p_id);
    if (!held) {
      if (process.env.REPLACE !== '1' && GONE.has(at.p_id)) return raise('document supprime');
      // Starting to share takes a group key; contributing takes none.
      const group = GROUPS.get(at.p_key);
      if (!group) return raise('cle de groupe invalide');
      // « Lien seulement » : fixé à la première écriture, comme dans le SQL.
      rows.set(at.p_id, {
        data: at.p_data, code: null, tries: 0, group: group.id, listed: !at.p_data?.linkOnly,
        // L'organisateur, comme dans le SQL : fixé à la première écriture.
        owner: typeof at.p_owner === 'string' && at.p_owner.length >= 16 ? at.p_owner : null,
      });
      return send(204);
    }
    // Les votes fondus case par case, comme marque_points_merge_votes.
    const mergeVotes = (stored = {}, incoming = {}) => {
      const out = { ...stored };
      for (const [key, vote] of Object.entries(incoming || {})) {
        const was = out[key];
        if (!was || (vote?.at || 0) >= (was?.at || 0)) out[key] = vote;
      }
      return out;
    };
    if (!held.owner || at.p_owner === held.owner) {
      let data = at.p_data;
      // REPLACE=1 : la base d'avant, qui remplace — pour vérifier que l'app seule suffit.
      if (process.env.REPLACE !== '1' && held.data?.kind === 'poll' && data?.kind === 'poll') {
        data = {
          ...data,
          votes: mergeVotes(held.data.votes, data.votes),
          people: (data.peopleAt || 0) >= (held.data.peopleAt || 0) ? (data.people || []) : (held.data.people || []),
          peopleAt: Math.max(held.data.peopleAt || 0, data.peopleAt || 0),
          updatedAt: Math.max(held.data.updatedAt || 0, data.updatedAt || 0),
        };
      }
      rows.set(at.p_id, { ...held, data });
      return send(204);
    }
    // Quelqu'un d'autre que l'organisateur : ses votes, et les personnes qu'il ajoute.
    if (held.data?.kind !== 'poll') return send(204);
    if (held.data.closedAt) return send(204); // clos : plus de votes
    const known = new Set((held.data.people || []).map((person) => person.id));
    rows.set(at.p_id, {
      ...held,
      data: {
        ...held.data,
        votes: mergeVotes(held.data.votes, at.p_data?.votes),
        people: [...(held.data.people || []), ...(at.p_data?.people || []).filter((person) => !known.has(person.id))],
        peopleAt: Math.max(held.data.peopleAt || 0, at.p_data?.peopleAt || 0),
        updatedAt: Math.max(held.data.updatedAt || 0, at.p_data?.updatedAt || 0),
      },
    });
    return send(204);
  }
  if (fn === 'marque_points_delete') {
    const held = rows.get(at.p_id);
    if (!held || held.code) return send(204);
    if (GROUPS.get(at.p_key)?.id !== held.group) return raise('cle de groupe invalide');
    if (held.owner && at.p_owner !== held.owner) return raise("reserve a l'organisateur");
    rows.delete(at.p_id);
    GONE.add(at.p_id);
    return send(204);
  }

  if (old) return send(404, { code: 'PGRST202', message: `Could not find the function public.${fn}` });

  if (fn === 'marque_points_group_of') {
    const group = GROUPS.get(at.p_key);
    return send(200, group ? { ...group, admits: ADMITS.has(at.p_key) } : null);
  }
  if (fn === 'marque_points_invite') {
    const group = GROUPS.get(at.p_key);
    if (!group) return raise('cle de groupe invalide');
    const code = String(Math.floor(Math.random() * 1000000)).padStart(6, '0');
    const uses = Math.max(1, Math.min(at.p_uses ?? 1, 200));
    INVITES.set(code, { group, at: Date.now(), uses });
    return send(200, { code, name: group.name, minutes: at.p_minutes ?? 30, uses });
  }
  if (fn === 'marque_points_ask') {
    const name = String(at.p_name ?? '').trim().toLowerCase();
    const misses = MISSES.get(name) ?? 0;
    if (misses >= 20) return send(200, { status: 'busy' });
    const invite = INVITES.get(String(at.p_code ?? ''));
    if (!invite || invite.group.name.toLowerCase() !== name) {
      MISSES.set(name, misses + 1);
      return send(200, { status: 'unknown' });
    }
    if (REQUESTS.filter((row) => row.group === invite.group.id && row.state === 'waiting').length >= 50) {
      return send(200, { status: 'busy' });
    }

    invite.uses -= 1;
    if (invite.uses <= 0) INVITES.delete(String(at.p_code));
    MISSES.delete(name);

    const ticket = `jeton-${Math.random().toString(36).slice(2, 12)}`;
    REQUESTS.push({
      id: `req_${Math.random().toString(36).slice(2, 10)}`,
      group: invite.group.id,
      name: String(at.p_who ?? '').trim().slice(0, 24),
      label: String(at.p_label ?? '').trim().slice(0, 80),
      ticket,
      state: 'waiting',
      at: Date.now(),
    });
    return send(200, { status: 'waiting', ticket, id: invite.group.id, name: invite.group.name });
  }
  if (fn === 'marque_points_claim') {
    const held = REQUESTS.find((row) => row.ticket === at.p_ticket);
    if (!held) {
      const group = GROUPS.get(at.p_ticket);
      // La demande a pu être effacée : si le jeton ouvre le groupe, c'est un oui.
      if (group) return send(200, { status: 'ok', id: group.id, name: group.name });
      return send(200, { status: 'unknown' });
    }
    const group = [...GROUPS.values()].find((row) => row.id === held.group);
    if (held.state === 'waiting') return send(200, { status: 'waiting', name: group?.name ?? '' });
    if (held.state === 'refused') return send(200, { status: 'refused' });
    return send(200, { status: 'ok', id: held.group, name: group?.name ?? '' });
  }
  if (fn === 'marque_points_requests') {
    const group = GROUPS.get(at.p_key);
    if (!group || !ADMITS.has(at.p_key)) return raise('cette cle ne fait pas entrer');
    return send(200, REQUESTS
      .filter((row) => row.group === group.id && row.state === 'waiting')
      .map((row) => ({ id: row.id, name: row.name, label: row.label, at: row.at })));
  }
  if (fn === 'marque_points_answer') {
    const group = GROUPS.get(at.p_key);
    if (!group || !ADMITS.has(at.p_key)) return raise('cette cle ne fait pas entrer');
    const held = REQUESTS.find((row) => row.id === at.p_id && row.group === group.id && row.state === 'waiting');
    if (!held) return send(200, { status: 'unknown' });
    if (!at.p_accept) {
      held.state = 'refused';
      return send(200, { status: 'refused' });
    }
    held.state = 'ok';
    // Accepter fait entrer une personne ; l'appareil lui est rattaché.
    const person = { id: `per_${Math.random().toString(36).slice(2, 10)}`, group: group.id, name: held.name, token: null };
    PERSONS.push(person);
    // Le jeton devient la clé de cet appareil, sans rien faire circuler.
    GROUPS.set(held.ticket, group);
    KEYS.push({
      id: `key_${Math.random().toString(36).slice(2, 10)}`,
      group: group.id,
      label: [held.name, held.label].filter(Boolean).join(' · ').slice(0, 80),
      admits: false,
      key: held.ticket,
      person: person.id,
      at: Date.now(),
    });
    return send(200, { status: 'ok' });
  }
  if (fn === 'marque_points_group_keys') {
    const group = GROUPS.get(at.p_key);
    if (!group || !ADMITS.has(at.p_key)) return raise('cette cle ne fait pas entrer');
    return send(200, KEYS
      .filter((row) => row.group === group.id)
      .map((row) => {
        const person = PERSONS.find((p) => p.id === row.person);
        return {
          id: row.id,
          label: row.label,
          admits: row.admits,
          mine: row.key === at.p_key,
          person: row.person ?? null,
          who: person?.name ?? null,
          link: Boolean(person?.token),
          at: row.at,
        };
      }));
  }
  if (fn === 'marque_points_my_link') {
    const row = KEYS.find((k) => k.key === at.p_key);
    const person = row && PERSONS.find((p) => p.id === row.person);
    if (!person) return send(200, { status: 'none' });
    person.token = Array.from({ length: 32 }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('');
    return send(200, { status: 'ok', token: person.token, name: person.name });
  }
  if (fn === 'marque_points_return') {
    const misses = MISSES.get('') ?? 0;
    if (misses >= 20) return send(200, { status: 'busy' });
    const person = PERSONS.find((p) => p.token && p.token === at.p_token);
    if (!person) {
      MISSES.set('', misses + 1);
      return send(200, { status: 'unknown' });
    }
    const group = [...GROUPS.values()].find((g) => g.id === person.group);
    const key = `cle-retour-${Math.random().toString(36).slice(2, 10)}`;
    GROUPS.set(key, group);
    KEYS.push({
      id: `key_${Math.random().toString(36).slice(2, 10)}`,
      group: person.group,
      label: [person.name, String(at.p_label ?? '')].filter(Boolean).join(' · ').slice(0, 80),
      admits: false,
      key,
      person: person.id,
      at: Date.now(),
    });
    return send(200, { status: 'ok', key, who: person.name, id: person.group, name: group?.name ?? '' });
  }
  if (fn === 'marque_points_forget_link') {
    const group = GROUPS.get(at.p_key);
    if (!group || !ADMITS.has(at.p_key)) return raise('cette cle ne fait pas entrer');
    const person = PERSONS.find((p) => p.id === at.p_person && p.group === group.id);
    if (!person) return send(200, { status: 'unknown' });
    person.token = null;
    return send(200, { status: 'ok' });
  }
  // L'agenda : un jeton par groupe, fabriqué à la demande et révocable.
  if (fn === 'marque_points_calendar') {
    const group = GROUPS.get(at.p_key);
    if (!group) return send(200, { status: 'unknown' });
    if (!CALENDARS.has(group.id)) {
      CALENDARS.set(group.id, Array.from({ length: 32 }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join(''));
    }
    return send(200, { status: 'ok', token: CALENDARS.get(group.id), name: group.name });
  }
  if (fn === 'marque_points_forget_calendar') {
    const group = GROUPS.get(at.p_key);
    if (!group) return send(200, { status: 'unknown' });
    CALENDARS.delete(group.id);
    return send(200, { status: 'ok' });
  }
  if (fn === 'marque_points_set_admits') {
    const group = GROUPS.get(at.p_key);
    if (!group || !ADMITS.has(at.p_key)) return raise('cette cle ne fait pas entrer');
    const row = KEYS.find((k) => k.id === at.p_id && k.group === group.id);
    if (!row) return send(200, { status: 'unknown' });
    const allow = Boolean(at.p_allow);
    if (row.admits === allow) return send(200, { status: 'ok' });
    if (!allow && KEYS.filter((k) => k.group === group.id && k.admits).length <= 1) {
      return send(200, { status: 'last' });
    }
    row.admits = allow;
    if (allow) ADMITS.add(row.key);
    else ADMITS.delete(row.key);
    return send(200, { status: 'ok' });
  }
  if (fn === 'marque_points_cut_key') {
    const group = GROUPS.get(at.p_key);
    if (!group || !ADMITS.has(at.p_key)) return raise('cette cle ne fait pas entrer');
    const index = KEYS.findIndex((row) => row.id === at.p_id && row.group === group.id);
    if (index < 0) return send(200, { status: 'unknown' });
    if (KEYS[index].admits && KEYS.filter((row) => row.group === group.id && row.admits).length <= 1) {
      return send(200, { status: 'last' });
    }
    const [cut] = KEYS.splice(index, 1);
    GROUPS.delete(cut.key);
    ADMITS.delete(cut.key);
    return send(200, { status: 'ok' });
  }
  if (fn === 'marque_points_group_docs') {
    const group = GROUPS.get(at.p_key);
    if (!group) return send(200, []);
    return send(200, [...rows.entries()]
      .filter(([, row]) => !row.code && row.group === group.id && row.listed !== false)
      .map(([id, row]) => ({ id, updatedAt: row.data?.updatedAt ?? null })));
  }

  if (fn === 'marque_points_put_set') {
    const group = GROUPS.get(at.p_key);
    if (!group) return raise('cle de groupe invalide');
    if (!/^[0-9]{6}$/.test(String(at.p_code ?? ''))) return raise('code invalide');
    if (rows.has(at.p_id)) return raise('duplicate key value violates unique constraint');
    rows.set(at.p_id, { data: at.p_data, code: at.p_code, tries: 0, group: group.id });
    return send(204);
  }
  if (fn === 'marque_points_open_set') {
    const row = lot(at.p_id);
    if (!row) return send(200, { status: 'unknown' });
    if (row.tries >= 10) return send(200, { status: 'locked' });
    if (row.code !== at.p_code) {
      row.tries += 1;
      return send(200, { status: 'wrong', left: 10 - row.tries });
    }
    row.tries = 0;
    return send(200, { status: 'ok', set: row.data });
  }
  if (fn === 'marque_points_forget_set') {
    if (!GROUPS.has(at.p_key)) return raise('cle de groupe invalide');
    if (!lot(at.p_id)) return send(200, { status: 'unknown' });
    rows.delete(at.p_id);
    return send(200, { status: 'ok' });
  }

  return send(404, { code: 'PGRST202', message: 'function not found' });
}).listen(port, () => console.log(`fake database on ${port}${old ? ' (not updated)' : ''}`));
