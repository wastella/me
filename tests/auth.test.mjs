import test from 'node:test';
import assert from 'node:assert/strict';
import './helpers.mjs';

test('session cookies: signed, tamper-proof, and expiring', async () => {
  const S = await import('../lib/session.js');
  delete process.env.SESSION_SECRET;
  assert.equal(S.authRequired(), false);
  assert.equal(await S.verifySession('anything'), null, 'no secret means nothing verifies');
  process.env.SESSION_SECRET = 'test-secret-one';
  assert.equal(S.authRequired(), true);
  const token = await S.signSession('me@example.com');
  assert.equal((await S.verifySession(token)).email, 'me@example.com');
  const [body, sig] = token.split('.');
  const forged = Buffer.from(JSON.stringify({ email: 'evil@example.com', exp: Date.now() + 1e9 })).toString('base64url');
  assert.equal(await S.verifySession(`${forged}.${sig}`), null, 'changing the contents breaks the signature');
  assert.equal(await S.verifySession(`${body}.`), null);
  assert.equal(await S.verifySession('garbage'), null);
  assert.equal(await S.verifySession(''), null);
  process.env.SESSION_SECRET = 'a-different-secret';
  assert.equal(await S.verifySession(token), null, 'a cookie from another secret is refused');
  const realNow = Date.now;
  const fresh = await S.signSession('me@example.com');
  Date.now = () => realNow() + (S.MAX_AGE + 60) * 1000;
  try { assert.equal(await S.verifySession(fresh), null, 'expired cookies are refused'); } finally { Date.now = realNow; }
  delete process.env.SESSION_SECRET;
});

test('times are worked out in your timezone, including clock changes', async () => {
  const { zonedISO, localDate, localTime } = await import('../lib/tz.js');
  assert.equal(zonedISO('2026-11-14', '18:00'), '2026-11-14T23:00:00.000Z');   // EST, UTC-5
  assert.equal(zonedISO('2026-07-04', '09:30'), '2026-07-04T13:30:00.000Z');   // EDT, UTC-4
  assert.equal(zonedISO('2026-11-14'), '2026-11-14T05:00:00.000Z');
  assert.equal(localDate('2026-11-15T03:30:00.000Z'), '2026-11-14', 'late evening is still the same local day');
  assert.equal(localTime('2026-11-14T23:30:00.000Z'), '6:30 PM');
});
