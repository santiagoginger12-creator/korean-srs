import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DAY } from '@ksrs/srs-engine';
import { SyncError } from '@ksrs/sync';
import {
  coerceSyncConfig, DEFAULT_SYNC_REPO, describeSyncError, expiryReminder, parseRepo, syncSummary,
} from '../src/data/sync.ts';
import { parseRoute } from '../src/router.ts';

test('sync config: defaults to the owner\'s data repo, off; junk is ignored', () => {
  assert.deepEqual(coerceSyncConfig(undefined), { repo: DEFAULT_SYNC_REPO, enabled: false });
  assert.equal(DEFAULT_SYNC_REPO, 'santiagoginger12-creator/ksrs-data');
  const c = coerceSyncConfig({ repo: ' me/data ', enabled: true, tokenExpiry: '2027-11-01', lastError: { code: 'bad-token', message: 'x', at: 1 }, token: 'nope' });
  assert.deepEqual(c, { repo: 'me/data', enabled: true, tokenExpiry: '2027-11-01', lastError: { code: 'bad-token', message: 'x', at: 1 } });
  assert.equal('token' in c, false, 'the token never lives in the config');
  assert.equal(coerceSyncConfig({ tokenExpiry: 'soon' }).tokenExpiry, undefined);
});

test('token expiry reminder: from 14 days before, and once expired', () => {
  const now = new Date(2026, 10, 2, 12).getTime(); // local time
  assert.equal(expiryReminder(undefined, now), null);
  assert.equal(expiryReminder('2026-11-30', now), null, '28 days out');
  assert.deepEqual(expiryReminder('2026-11-16', now), { days: 14, expired: false });
  assert.deepEqual(expiryReminder('2026-11-02', now), { days: 0, expired: false }, 'expires today');
  assert.deepEqual(expiryReminder('2026-11-03', now), { days: 1, expired: false });
  assert.deepEqual(expiryReminder('2026-11-01', now), { days: 0, expired: true });
  assert.deepEqual(expiryReminder('2026-11-16', now + DAY), { days: 13, expired: false });
});

test('every sync failure has a plain-English fix', () => {
  const repo = 'me/data';
  const fix = (code: ConstructorParameters<typeof SyncError>[0]) => describeSyncError(new SyncError(code, 'x'), repo).fix;
  assert.equal(fix('bad-token'), 'Token expired or revoked — paste a new one in Settings → Sync.');
  assert.match(fix('no-access'), /Contents: Read and write/);
  assert.match(fix('repo-missing'), /me\/data wasn't found/);
  assert.match(fix('network'), /offline/);
  assert.match(fix('newer-format'), /newer version/);
  assert.match(describeSyncError(new Error('no-token'), repo).fix, /paste one in Settings → Sync/);
  // A plain object shaped like a SyncError (e.g. from another bundle) is recognised too.
  assert.equal(describeSyncError(Object.assign(new Error('m'), { name: 'SyncError', code: 'bad-token' }), repo).code, 'bad-token');
});

test('summary line and helpers', () => {
  assert.equal(syncSummary({ added: 3, pushed: 0, quarantined: 0, conflicts: 0 }), '3 new from other devices, nothing to send.');
  assert.match(syncSummary({ added: 0, pushed: 2, quarantined: 1, conflicts: 0 }), /2 sent, 1 set aside/);
  assert.deepEqual(parseRepo('https://github.com/a-b/c.d'), { owner: 'a-b', repo: 'c.d' });
  assert.deepEqual(parseRoute('#/settings/sync'), { name: 'sync' });
});
