import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { buildChatConfig, chatConfigFor, visitorHash } from '../src/services/support.service.js';

/**
 * The live chat's boot config.
 *
 * IT NEEDS NO DATABASE AND SETS NO ENVIRONMENT VARIABLE. `buildChatConfig` takes
 * its config as an argument precisely so these cases are ordinary function
 * calls — a test that has to reach into `process.env` to exercise a branch is a
 * test that passes or fails depending on whose machine runs it, which is the
 * trap this repo has already hit with `MONGODB_URI`, `DEPOSIT_DESTINATIONS`,
 * a live CoinGecko call and `RESEND_API_KEY`.
 *
 * What is asserted here is mostly about what does NOT leave the process. This
 * payload is handed to a third party's servers, so the interesting failures are
 * a leaked key and a leaked balance rather than a wrong string.
 */

const USER = {
  _id: '65f0000000000000000000aa',
  username: 'jd_trader',
  displayName: 'JD Trader',
  email: 'jd@hyperstocks.app',
  cashBalanceCents: 118_966,
  role: 'user',
  status: 'Active',
};

const CONFIG = { propertyId: 'prop123', widgetId: 'default', apiKey: 'secret-key' };

test('live chat config', async (t) => {
  await t.test('is disabled when no property is configured', () => {
    const cfg = buildChatConfig({ user: USER, ...CONFIG, propertyId: '' });
    assert.equal(cfg.enabled, false);
    // Nothing else at all: a disabled config must not carry a visitor block
    // that a client could still hand to a widget.
    assert.equal(cfg.visitor, undefined);
    assert.equal(cfg.propertyId, undefined);
  });

  await t.test('is disabled when the widget id is blank', () => {
    assert.equal(buildChatConfig({ user: USER, ...CONFIG, widgetId: '' }).enabled, false);
  });

  await t.test('carries the ids the embed URL is built from', () => {
    const cfg = buildChatConfig({ user: USER, ...CONFIG });
    assert.equal(cfg.enabled, true);
    assert.equal(cfg.propertyId, 'prop123');
    assert.equal(cfg.widgetId, 'default');
  });

  /**
   * The one that matters most. `TAWK_API_KEY` signs the visitor's address; a
   * copy of it in the response would let anybody sign any address and appear to
   * the operator as any account on the platform.
   */
  await t.test('never returns the API key, in any field', () => {
    const cfg = buildChatConfig({ user: USER, ...CONFIG });
    assert.ok(!JSON.stringify(cfg).includes('secret-key'));
  });

  await t.test('signs the email with HMAC-SHA256 when secure mode is on', () => {
    const cfg = buildChatConfig({ user: USER, ...CONFIG });
    assert.equal(cfg.verified, true);
    assert.equal(
      cfg.visitor.hash,
      crypto.createHmac('sha256', 'secret-key').update('jd@hyperstocks.app').digest('hex'),
    );
  });

  await t.test('a different address produces a different signature', () => {
    // Otherwise the hash would authenticate nothing — it has to bind to the
    // address it travels with, not merely be present.
    assert.notEqual(
      visitorHash('jd@hyperstocks.app', 'secret-key'),
      visitorHash('admin@hyperstocks.app', 'secret-key'),
    );
  });

  await t.test('reports unverified, and sends no hash, without a key', () => {
    const cfg = buildChatConfig({ user: USER, ...CONFIG, apiKey: '' });
    assert.equal(cfg.enabled, true);
    assert.equal(cfg.verified, false);
    // Absent rather than empty: Tawk treats a blank hash as a failed signature
    // and drops every attribute with it, so the visitor would show as
    // anonymous instead of self-asserted.
    assert.equal('hash' in cfg.visitor, false);
  });

  /**
   * The boundary `adminQueue.service.js` draws for the review queues, drawn
   * again and harder — that payload goes to our own admin screen, this one
   * leaves the platform.
   */
  await t.test('carries no money and no account state', () => {
    const cfg = buildChatConfig({ user: USER, ...CONFIG });
    const sent = JSON.stringify(cfg);

    assert.ok(!sent.includes('118966'), 'balance reached a third party');
    for (const field of ['cashBalanceCents', 'role', 'status', 'passwordHash', 'tradeCount']) {
      assert.equal(cfg.visitor[field], undefined, `${field} reached a third party`);
    }
  });

  /**
   * An empty display name must not beat a perfectly good handle. `??` falls
   * through on null and undefined only, so this is the case that reached the
   * operator as a blank name before the service switched to `||`.
   */
  await t.test('falls back past a blank display name to the handle', () => {
    const cfg = buildChatConfig({ user: { ...USER, displayName: '' }, ...CONFIG });
    assert.equal(cfg.visitor.name, 'jd_trader');
  });

  await t.test('identifies the account well enough to answer it', () => {
    const cfg = buildChatConfig({ user: USER, ...CONFIG, language: 'de' });
    assert.equal(cfg.visitor.name, 'JD Trader');
    assert.equal(cfg.visitor.email, 'jd@hyperstocks.app');
    assert.equal(cfg.visitor['hs-username'], 'jd_trader');
    // So the operator can find the row in /admin/users.
    assert.equal(cfg.visitor['hs-user-id'], '65f0000000000000000000aa');
    // The widget's own chrome language is a dashboard setting per widget and
    // cannot be switched from the embed, so this attribute is the only thing
    // that tells the operator which language to answer in.
    assert.equal(cfg.visitor['hs-language'], 'de');
  });

  /**
   * The env-bound wrapper, against the values the test script forces empty.
   * If this ever starts returning `enabled: true`, a real property id has
   * leaked into the suite from somebody's `.env` and every case above is
   * measuring that machine rather than the code.
   */
  await t.test('is off in the test environment', () => {
    assert.equal(chatConfigFor(USER, 'en').enabled, false);
  });
});
