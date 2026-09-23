import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

/**
 * supabase/mise-a-jour.sql exists so that a base already in place can take the
 * latest changes in one paste, from the Raw view, rather than a hand-picked
 * slice of a thousand-line block. It is only worth anything if it says exactly
 * what the guide says: a function that drifted between the two would install,
 * on the bases that update, something no fresh base has ever run.
 */
async function sources() {
  const [guide, update] = await Promise.all([
    readFile(join(root, 'docs', 'DEPLOIEMENT.md'), 'utf8'),
    readFile(join(root, 'supabase', 'mise-a-jour.sql'), 'utf8'),
  ]);
  const fences = [...guide.matchAll(/^```sql\n([\s\S]*?)^```/gm)].map((match) => match[1]);
  return { schema: fences[1], update };
}

const functionsIn = (sql) =>
  new Map(
    [...sql.matchAll(/create or replace function public\.(\w+)\([\s\S]*?\n\$\$;\n/g)].map((match) => [
      match[1],
      match[0],
    ]),
  );

test('the update carries each of its functions exactly as the guide defines it', async () => {
  const { schema, update } = await sources();
  const inSchema = functionsIn(schema);
  const inUpdate = functionsIn(update);

  assert.ok(inUpdate.size > 0, 'the update installs functions');
  for (const [name, body] of inUpdate) {
    assert.ok(inSchema.has(name), `${name} is in the update but not in the guide`);
    assert.equal(body, inSchema.get(name), `${name} differs between the guide and the update`);
  }
});

test('the update brings what the app now relies on', async () => {
  const { update } = await sources();
  const inUpdate = functionsIn(update);

  // Two days for an invitation: without it the app asks and the base shortens.
  assert.match(inUpdate.get('marque_points_invite'), /least\(coalesce\(p_minutes, 30\), 2880\)/);

  // Link only: the column, set at the first write, and left out of both
  // listings a group reads — its tabs, and its calendar.
  assert.match(update, /add column if not exists listed boolean not null default true/);
  assert.match(inUpdate.get('marque_points_put'), /linkOnly/);
  assert.match(inUpdate.get('marque_points_group_docs'), /and g\.listed/);
  assert.match(inUpdate.get('marque_points_agenda'), /and g\.listed/);

  // The organiser: a column, a fourth parameter, and a delete that asks for it.
  assert.match(update, /add column if not exists owner_hash text/);
  assert.match(inUpdate.get('marque_points_put'), /p_owner text default null/);
  assert.match(inUpdate.get('marque_points_delete'), /reserve a l''organisateur/);

  // A poll is merged cell by cell, on both paths: a late copy must not erase
  // the votes that arrived in between — and the merge is not a door of its own.
  assert.equal((inUpdate.get('marque_points_put').match(/marque_points_merge_votes\(/g) || []).length, 2);
  assert.match(update, /revoke all on function public\.marque_points_merge_votes\(jsonb, jsonb\) from public, anon, authenticated;/);

  // What is deleted stays deleted: the delete leaves a trace, and a write
  // that would create the thing again is refused — in its own group or any
  // other. The trace is a table nobody outside reads: row security, no grant.
  assert.match(update, /create table if not exists public\.marque_points_gone \(/);
  assert.match(update, /alter table public\.marque_points_gone enable row level security;/);
  assert.doesNotMatch(update, /grant [^;]* on (table )?public\.marque_points_gone/);
  assert.match(inUpdate.get('marque_points_delete'), /insert into public\.marque_points_gone/);
  assert.match(inUpdate.get('marque_points_put'), /from public\.marque_points_gone where id = p_id/);
  assert.ok(
    update.indexOf('create table if not exists public.marque_points_gone') < update.indexOf('create or replace function public.marque_points_put('),
    'the table is there before the functions that use it',
  );

  // A closed poll takes no more votes, from a copy that missed the closing.
  assert.match(inUpdate.get('marque_points_put'), /closedAt/);

  // The schema says its version, so the app can tell when an update is due —
  // and anyone may ask: the app asks before it has any key.
  assert.match(inUpdate.get('marque_points_schema'), /select \d+;/);
  assert.match(update, /grant execute on function public\.marque_points_schema\(\) to anon, authenticated;/);
});

test('the update erases no data', async () => {
  const { update } = await sources();
  const statements = update.replace(/--.*$/gm, '');
  // The functions it installs clean up after themselves (expired invitations),
  // which is theirs to do when they run — not the update's, when it is pasted.
  const outside = statements.replace(/\$\$[\s\S]*?\$\$/g, '');
  assert.equal(/\b(delete|truncate)\b/i.test(outside), false, 'no delete or truncate at the top level');
  // Dropping a function replaces code, not data — and an older signature has
  // to go, or two functions of one name leave the database unable to choose.
  const drops = outside.match(/\bdrop\s+\w+/gi) || [];
  assert.ok(drops.every((drop) => /^drop\s+function$/i.test(drop)), `only functions are dropped: ${drops.join(', ')}`);
});

test('every function the update drops, it puts back', async () => {
  const { update } = await sources();
  const dropped = [...update.matchAll(/drop function if exists public\.(\w+)\(/g)].map((match) => match[1]);
  const installed = functionsIn(update);
  for (const name of dropped) assert.ok(installed.has(name), `${name} is dropped and never recreated`);
});
