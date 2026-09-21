import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');

/**
 * The calendar function is deployed as one pasted file, so it is tested as one
 * pasted file: the very bytes that go into Supabase, run here with Deno's two
 * globals stood in for. Anything else would be testing a different program
 * from the one being shipped.
 */
async function serve({ answer, status = 200, url = 'https://x.supabase.co/functions/v1/agenda?c=' + 'a'.repeat(32), method = 'GET' }) {
  const source = await readFile(join(root, 'supabase', 'functions', 'agenda', 'index.ts'), 'utf8');

  let handler = null;
  const calls = [];
  const Deno = {
    env: {
      get: (name) => ({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_ANON_KEY: 'anon-key' })[name],
    },
    serve: (fn) => {
      handler = fn;
    },
  };
  const fetchImpl = async (target, options) => {
    calls.push({ target, options });
    if (answer instanceof Error) throw answer;
    return new Response(JSON.stringify(answer), { status });
  };

  // eslint-disable-next-line no-new-func
  new Function('Deno', 'fetch', source)(Deno, fetchImpl);
  assert.ok(handler, 'the function registers a handler');

  return { response: await handler(new Request(url, { method })), calls };
}

test('the calendar function answers a subscription with a calendar', async () => {
  const { response, calls } = await serve({
    answer: {
      status: 'ok',
      name: 'Mifa',
      docs: [
        { kind: 'poll', id: 'v_1', question: 'Quel soir pour la raclette ?', date: '2026-09-24', at: '20:00', people: [] },
        { kind: 'list', id: 'l_1', name: 'Courses', items: [{ id: 'i_1', text: 'Pain', due: '2026-09-25', done: false }], people: [] },
      ],
    },
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'text/calendar; charset=utf-8');

  const body = await response.text();
  assert.ok(body.startsWith('BEGIN:VCALENDAR\r\n'));
  assert.ok(body.includes('X-WR-CALNAME:Mifa'));
  assert.ok(body.includes('SUMMARY:Raclette\r\n'), 'the settled poll, named as an event rather than asked as a question');
  assert.ok(body.includes('DTSTART:20260924T200000'));
  assert.ok(body.includes('SUMMARY:Pain'), 'and the dated line');
  assert.ok(body.includes('DTSTART;VALUE=DATE:20260925'));

  assert.equal(calls.length, 1, 'one call to the database, no more');
  assert.match(calls[0].target, /\/rest\/v1\/rpc\/marque_points_agenda$/);
  assert.equal(JSON.parse(calls[0].options.body).p_token, 'a'.repeat(32));
  assert.equal(calls[0].options.headers.apikey, 'anon-key');
});

test('the token is read from the path as well, with or without .ics', async () => {
  const token = 'a'.repeat(32);
  for (const url of [
    `https://x.supabase.co/functions/v1/agenda/${token}.ics`,
    `https://x.supabase.co/functions/v1/agenda/${token}`,
    `https://x.supabase.co/functions/v1/agenda?c=${token}`,
  ]) {
    const { response, calls } = await serve({ answer: { status: 'ok', name: 'Mifa', docs: [] }, url });
    assert.equal(response.status, 200, url);
    assert.equal(response.headers.get('content-type'), 'text/calendar; charset=utf-8');
    assert.equal(JSON.parse(calls[0].options.body).p_token, token, url);
  }
});

test('hexadecimal copied in capitals is the same token', async () => {
  // The database stores it in lower case; a calendar that upper-cased the
  // address on the way would otherwise be told it leads nowhere.
  const { response, calls } = await serve({
    answer: { status: 'ok', name: 'Mifa', docs: [] },
    url: `https://x.supabase.co/functions/v1/agenda/${'AB12'.repeat(8)}.ics`,
  });
  assert.equal(response.status, 200);
  assert.equal(JSON.parse(calls[0].options.body).p_token, 'ab12'.repeat(8));
});

test('an address with no token, or a mangled one, never reaches the database', async () => {
  for (const url of [
    'https://x.supabase.co/functions/v1/agenda',
    'https://x.supabase.co/functions/v1/agenda?c=',
    'https://x.supabase.co/functions/v1/agenda?c=trop-court',
    'https://x.supabase.co/functions/v1/agenda/trop-court.ics',
    `https://x.supabase.co/functions/v1/agenda/${'a'.repeat(31)}.ics`,
    `https://x.supabase.co/functions/v1/agenda/${'a'.repeat(32)}.txt`,

  ]) {
    const { response, calls } = await serve({ answer: { status: 'ok', docs: [] }, url });
    assert.equal(response.status, 400, url);
    assert.equal(calls.length, 0, 'a mistyped address must not count as a failed attempt');
  }
});

test('an address that leads nowhere says so, without saying more', async () => {
  const { response } = await serve({ answer: { status: 'unknown' } });
  assert.equal(response.status, 404);
  const body = await response.text();
  assert.ok(!body.includes('BEGIN:VCALENDAR'));
});

test('a throttled database is passed on as a throttled answer', async () => {
  const { response } = await serve({ answer: { status: 'busy' } });
  assert.equal(response.status, 429);
});

test('a database that does not answer is not a broken calendar', async () => {
  const silent = await serve({ answer: new Error('network') });
  assert.equal(silent.response.status, 502);

  const refused = await serve({ answer: { message: 'nope' }, status: 500 });
  assert.equal(refused.response.status, 502);
});

test('only GET and HEAD are served, and HEAD carries no body', async () => {
  const posted = await serve({ answer: { status: 'ok', docs: [] }, method: 'POST' });
  assert.equal(posted.response.status, 405);
  assert.equal(posted.calls.length, 0);

  const head = await serve({ answer: { status: 'ok', name: 'Mifa', docs: [] }, method: 'HEAD' });
  assert.equal(head.response.status, 200);
  assert.equal(await head.response.text(), '', 'a HEAD answers with headers only');
});

test('an empty group still serves a calendar, rather than an error', async () => {
  const { response } = await serve({ answer: { status: 'ok', name: 'Mifa', docs: [] } });
  assert.equal(response.status, 200);
  const body = await response.text();
  assert.ok(body.startsWith('BEGIN:VCALENDAR'));
  assert.ok(!body.includes('BEGIN:VEVENT'));
});

test('what the database sends is never trusted to be what was asked for', async () => {
  // A row that is neither a list nor a poll, and a docs field that is not a
  // list at all: both come back as an empty calendar, not as a crash.
  const odd = await serve({ answer: { status: 'ok', name: 'Mifa', docs: [{ kind: 'game', id: 'g_1' }, null] } });
  assert.equal(odd.response.status, 200);
  assert.ok(!(await odd.response.text()).includes('BEGIN:VEVENT'));

  const broken = await serve({ answer: { status: 'ok', name: 'Mifa', docs: 'pas une liste' } });
  assert.equal(broken.response.status, 200);
});
