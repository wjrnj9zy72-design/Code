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
});

test('the update erases nothing', async () => {
  const { update } = await sources();
  const statements = update.replace(/--.*$/gm, '');
  // The functions it installs clean up after themselves (expired invitations),
  // which is theirs to do when they run — not the update's, when it is pasted.
  const outside = statements.replace(/\$\$[\s\S]*?\$\$/g, '');
  assert.equal(/\b(drop|delete|truncate)\b/i.test(outside), false, 'no drop, delete or truncate at the top level');
});
