import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { post } from '../lib/api';
import Button from '../components/ui/Button';
import { SUPPORT_EMAIL } from '../lib/contact';
import { FiCheck } from 'react-icons/fi';

/**
 * The page every newsletter links to.
 *
 * IT EXISTS BECAUSE THE EMAIL PROMISES IT. The consent line under the subscribe
 * button was removed on the explicit grounds that people "could unsubscribe from
 * the emails", which makes this link the whole of that promise — and a link in a
 * marketing email that 404s is worse than no unsubscribe at all, because the
 * reader has already been told there is one.
 *
 * IT RUNS ON MOUNT, WITHOUT A CONFIRM BUTTON. Somebody arriving here has already
 * decided — they clicked "unsubscribe" in an email — and a second "are you sure"
 * is the pattern that makes people mark mail as spam instead, which costs the
 * sending domain far more than the subscriber did.
 *
 * `useRef` guards the effect: React 18+ runs effects twice in development
 * StrictMode, and while the endpoint is idempotent by design (the filter carries
 * `unsubscribedAt: null`, so a second call cannot move the date the first one
 * recorded) firing it twice is still two requests for one intent.
 *
 * EVERY OUTCOME LOOKS THE SAME — unknown token, already unsubscribed, success.
 * The server answers `{ ok: true }` to all three so the endpoint cannot be used
 * to test whether an address is on the list, and this screen must not undo that
 * by rendering three different messages.
 */
export default function Unsubscribe() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';

  const [state, setState] = useState(/** @type {'working'|'done'|'failed'} */ ('working'));
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;

    if (!token) {
      setState('failed');
      return;
    }

    post('/subscribers/unsubscribe', { token })
      .then(() => setState('done'))
      // Only a transport or server failure lands here — an unknown token is a
      // success as far as the API is concerned, deliberately.
      .catch(() => setState('failed'));
  }, [token]);

  return (
    <div className="flex min-h-[calc(100vh-140px)] items-center justify-center bg-mist px-4 py-16">
      <div className="w-full max-w-110 rounded-md border border-cool-grey bg-white p-8 text-center shadow-card">
        {state === 'working' && (
          <p className="m-0 text-sm text-text-muted">{t('unsubscribe.working')}</p>
        )}

        {state === 'done' && (
          <>
            <span className="mx-auto mb-4 flex size-11 items-center justify-center rounded-full bg-green-tint text-gain">
              <FiCheck size={22} aria-hidden="true" />
            </span>
            <h1 className="m-0 text-xl font-bold">{t('unsubscribe.doneTitle')}</h1>
            <p className="mx-auto mt-3 mb-0 max-w-80 text-sm text-text-muted">
              {t('unsubscribe.doneBody')}
            </p>
          </>
        )}

        {state === 'failed' && (
          <>
            <h1 className="m-0 text-xl font-bold">{t('unsubscribe.failedTitle')}</h1>
            {/* Names the address to write to rather than leaving somebody who
                wants out with nowhere to go — the one case where a dead end is
                least acceptable. */}
            <p className="mx-auto mt-3 mb-0 max-w-80 text-sm text-text-muted">
              {t('unsubscribe.failedBody')}{' '}
              <a href={`mailto:${SUPPORT_EMAIL}`} className="text-gain underline">
                {SUPPORT_EMAIL}
              </a>
            </p>
          </>
        )}

        <div className="mt-6">
          <Button to="/" variant="secondary" size="sm">
            {t('unsubscribe.home')}
          </Button>
        </div>
      </div>
    </div>
  );
}
