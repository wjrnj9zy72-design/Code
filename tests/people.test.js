import test from 'node:test';
import assert from 'node:assert/strict';

import { withMeFirst, withoutMe } from '../src/people.js';

test('an empty form offers me as its first person', () => {
  assert.deepEqual(withMeFirst(['', ''], 'Gui'), ['Gui', '']);
  assert.deepEqual(withMeFirst(['', '', ''], '  Gui  '), ['Gui', '', ''],
    'however the name was stored');
});

test('a form with anything in it is left exactly as it stands', () => {
  // This is the whole point: someone who deletes their own name is someone
  // who is not on that list, and no redraw may put them back on it.
  assert.deepEqual(withMeFirst(['', 'Bob'], 'Gui'), ['', 'Bob']);
  assert.deepEqual(withMeFirst([' ', 'Bob'], 'Gui'), [' ', 'Bob']);
  const typed = ['x', ''];
  assert.equal(withMeFirst(typed, 'Gui'), typed, 'and handed back untouched, as the very same form');
});

test('nobody is offered twice', () => {
  assert.deepEqual(withMeFirst(['Gui', ''], 'Gui'), ['Gui', '']);
  assert.deepEqual(withMeFirst(['gui', ''], 'Gui'), ['gui', ''], 'whatever the case');
});

test('a device with no first name changes nothing', () => {
  const names = ['', ''];
  assert.equal(withMeFirst(names, ''), names);
  assert.equal(withMeFirst(names, null), names);
  assert.equal(withMeFirst(names, '   '), names);
});

test('what comes out is a form, not a longer one', () => {
  assert.equal(withMeFirst(['', '', ''], 'Gui').length, 3);
  assert.equal(withMeFirst([''], 'Gui').length, 1);
});

test('and my name is taken back out when the form stops being about people', () => {
  assert.deepEqual(withoutMe(['Gui', ''], 'Gui'), ['', '']);
  assert.deepEqual(withoutMe(['', 'gui'], 'Gui'), ['', ''], 'whatever the case');
  const others = ['Bob', 'Alice'];
  assert.equal(withoutMe(others, 'Gui'), others, 'a form that never held my name is untouched');
  assert.equal(withoutMe(others, ''), others, 'and a device with no first name changes nothing');
  assert.deepEqual(withoutMe(['Gui', 'Bob'], 'Gui'), ['', 'Bob'], 'the others stay where they are');
});
