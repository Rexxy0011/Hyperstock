import test from 'node:test';
import assert from 'node:assert/strict';
import { checkAddress, addressHint } from '../src/services/withdrawal.service.js';

/**
 * The payout network table.
 *
 * Payout networks used to be derived from DEPOSIT_DESTINATIONS, which capped
 * what could be paid out at what could be received. They are configurable
 * separately now — and the thing that must not slip is that every offered
 * network still has a real address rule behind it.
 */
test('payout networks', async (t) => {
  await t.test('every EVM chain validates a well-formed address', () => {
    const good = '0x4cF25a06d56492e68c83bb73a4BFaa3545A16286';
    for (const n of ['ETHEREUM', 'ERC20', 'BEP20', 'POLYGON', 'ARBITRUM', 'OPTIMISM', 'BASE', 'AVALANCHE']) {
      assert.equal(checkAddress(good, n), null, `${n} accepts a 0x address`);
      assert.match(addressHint(n), /0x/, `${n} has a usable hint`);
    }
  });

  /**
   * The hint NAMES THE CHAIN, because that is the sentence somebody reads when
   * their paste is rejected — "an Ethereum address" is unhelpful to somebody
   * withdrawing on Polygon.
   */
  await t.test('each EVM hint names its own chain', () => {
    assert.match(addressHint('POLYGON'), /Polygon/);
    assert.match(addressHint('ARBITRUM'), /Arbitrum/);
    assert.match(addressHint('BASE'), /Base/);
    assert.match(addressHint('BEP20'), /BNB Smart Chain/);
  });

  await t.test('the non-EVM chains keep their own formats', () => {
    assert.equal(checkAddress('TH1P2ue3vM7DKwGzXs2bDTEkwrNpXHMfCb', 'TRC20'), null);
    assert.equal(checkAddress('bc1qfasaka4t0dstpg63tdvjswsxl3tljzml7xql6r', 'BITCOIN'), null);
    assert.equal(checkAddress('LZ1oJC7ovqmWmGmUNCPZBhb5PnGZGoWbnB', 'LITECOIN'), null);
    assert.equal(checkAddress('DH5yaieqoZN36fDVciNyRueRGvGLR3mr7L', 'DOGECOIN'), null);
  });

  /** A chain's address must not validate on a different chain's rule. */
  await t.test('an address for the wrong chain is refused', () => {
    const evmAddr = '0x4cF25a06d56492e68c83bb73a4BFaa3545A16286';
    const tronAddr = 'TH1P2ue3vM7DKwGzXs2bDTEkwrNpXHMfCb';
    assert.ok(checkAddress(evmAddr, 'TRC20'), '0x is not a Tron address');
    assert.ok(checkAddress(evmAddr, 'BITCOIN'), '0x is not a Bitcoin address');
    assert.ok(checkAddress(tronAddr, 'POLYGON'), 'T… is not an EVM address');
    assert.ok(checkAddress(tronAddr, 'BITCOIN'), 'T… is not a Bitcoin address');
  });

  /**
   * THE STRING THAT ACTUALLY GOT THROUGH. Before per-chain rules the check was
   * `length >= 16`, and this was accepted on a live $3,937 payout request.
   */
  await t.test('the address that once got through is refused on every chain', () => {
    const junk = 'gdghsdhjsdhdjsdksjdhdjsjdujdu';
    for (const n of ['BITCOIN', 'TRC20', 'BEP20', 'POLYGON', 'SOLANA', 'LITECOIN', 'DOGECOIN']) {
      assert.ok(checkAddress(junk, n), `${n} refuses it`);
    }
  });

  await t.test('an empty address is refused before any rule runs', () => {
    assert.ok(checkAddress('', 'BITCOIN'));
    assert.ok(checkAddress('   '.trim(), 'POLYGON'));
  });
});
