import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRoute } from '../src/router.ts';

test('hash routes', () => {
  assert.deepEqual(parseRoute(''), { name: 'home' });
  assert.deepEqual(parseRoute('#/'), { name: 'home' });
  assert.deepEqual(parseRoute('#/reviews'), { name: 'reviews' });
  assert.deepEqual(parseRoute('#/item/' + encodeURIComponent('v:배:ship')), { name: 'item', id: 'v:배:ship' });
  assert.deepEqual(parseRoute('#/item/' + encodeURIComponent('g:는-바람에')), { name: 'item', id: 'g:는-바람에' });
  assert.deepEqual(parseRoute('#/drill'), { name: 'drill' });
  assert.deepEqual(parseRoute('#/drill/start'), { name: 'drill', start: true });
  assert.equal(parseRoute('#/drill/nope').name, 'notFound');
  assert.equal(parseRoute('#/nope').name, 'notFound');
});
