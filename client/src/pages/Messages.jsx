import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { get, patch } from '../lib/api';
import Badge from '../components/ui/Badge';
import Button from '../components/ui/Button';
import notify from '../lib/toast';

/**
 * Messages left on `/contact`.
 *
 * THIS SCREEN IS WHY THE FORM POSTS TO THIS PRODUCT'S OWN API. A third-party
 * form backend keeps the messages somewhere the app cannot read them, so there
 * would be nowhere to show them and no way to answer the only question that
 * matters about the queue — which ones still need somebody. Same reasoning the
 * subscriber capture already recorded, and the same shape of screen.
 *
 * `registered` is computed against `User.email` on every read rather than
 * stored: whether the sender holds an account changes how a message gets
 * answered, and a stored flag would need a writer on the signup path that
 * nobody would remember to add.
 */
export default function Messages() {
  const { t } = useTranslation();
  const qc = useQueryClient();

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['admin', 'contact-messages'],
    queryFn: () => get('/admin/contact-messages'),
  });

  const toggle = useMutation({
    /** @param {{ id: string, handled: boolean }} vars */
    mutationFn: (vars) => patch(`/admin/contact-messages/${vars.id}`, { handled: vars.handled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'contact-messages'] }),
    onError: (err) => notify.apiError(err),
  });

  const rows = data?.items ?? [];

  return (
    <div className="w-full px-4 py-10 sm:px-5 lg:px-7 2xl:px-9">
      <div className="mb-6">
        <h1 className="m-0 text-xl font-bold">{t('admin.messages.title')}</h1>
        <p className="mt-2 max-w-2xl text-sm text-text-muted">{t('admin.messages.intro')}</p>
      </div>

      <div className="mb-5 flex flex-wrap gap-3">
        {/* Outstanding leads, because it is the only one of the two that is a
            quantity of work. `total` counts messages already dealt with. */}
        <Stat label={t('admin.messages.outstanding')} value={data?.outstanding ?? 0} />
        <Stat label={t('admin.messages.total')} value={data?.total ?? 0} />
      </div>

      {isLoading && <Placeholder />}

      {/* A FAILED LOAD IS NOT AN EMPTY QUEUE. Conflating them renders a server
          being down as "nobody has written in", which is the defect measured on
          the subscribers table by blocking its request at the network layer. */}
      {isError && (
        <div className="rounded-md border border-cool-grey bg-white py-10 text-center shadow-card">
          <p className="m-0 text-text-muted">{t('common.loadFailed')}</p>
          <button
            type="button"
            onClick={() => refetch()}
            className="mt-2 text-sm font-medium text-gain underline underline-offset-2"
          >
            {t('common.retry')}
          </button>
        </div>
      )}

      {!isLoading && !isError && !rows.length && (
        <div className="rounded-md border border-cool-grey bg-white py-10 text-center text-text-muted shadow-card">
          {t('admin.messages.empty')}
        </div>
      )}

      {/* CARDS, NOT A TABLE, and that is the one place this screen departs from
          the subscribers listing it otherwise mirrors. A message body runs to
          4,000 characters; in a table cell that is either truncated to
          uselessness or it blows the row height out and destroys the column
          alignment the table existed for. Every other field here is short
          enough to sit in the card's header. */}
      <div className="flex flex-col gap-3">
        {rows.map((r) => (
          <MessageCard
            key={r.id}
            row={r}
            busy={toggle.isPending}
            onToggle={() => toggle.mutate({ id: r.id, handled: !r.handled })}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * One message.
 *
 * COLLAPSED BY DEFAULT PAST FOUR LINES. A queue of twenty full messages is a
 * page nobody can scan for the one that matters, and `line-clamp` alone gives
 * no way to read the rest — so the clamp comes with its own control rather than
 * silently hiding text.
 */
function MessageCard({ row, busy, onToggle }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const long = row.message.length > 260;

  return (
    <article
      className={`rounded-md border bg-white p-4 shadow-card sm:p-5 ${
        row.handled ? 'border-cool-grey opacity-70' : 'border-cool-grey'
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-void">{row.name}</span>
            <Badge variant={row.handled ? 'approved' : 'pending'}>
              {t(row.handled ? 'admin.messages.handled' : 'admin.messages.new')}
            </Badge>
            {/* Two independent facts, so two badges — somebody can write in
                without an account, and an account holder can write in about
                something the account does not explain. */}
            {row.registered && (
              <Badge variant="neutral">{t('admin.messages.hasAccount')}</Badge>
            )}
            <Badge variant="neutral">
              {t(`contact.topic.${row.topic}`, { defaultValue: row.topic })}
            </Badge>
          </div>

          <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-muted">
            {/* The address is a link, because replying is the whole point of
                this screen and retyping it is how a reply reaches the wrong
                person. */}
            <a
              href={`mailto:${row.email}?subject=${encodeURIComponent(
                t('admin.messages.replySubject'),
              )}`}
              className="text-text-muted underline underline-offset-2 hover:text-void"
            >
              {row.email}
            </a>
            {row.phone && <span>{row.phone}</span>}
            <span className="whitespace-nowrap">{new Date(row.createdAt).toLocaleString()}</span>
          </div>
        </div>

        <Button
          variant="secondary"
          size="sm"
          disabled={busy}
          onClick={onToggle}
          className="shrink-0"
        >
          {t(row.handled ? 'admin.messages.reopen' : 'admin.messages.markHandled')}
        </Button>
      </div>

      <p
        className={`mt-3 mb-0 text-sm leading-relaxed whitespace-pre-wrap text-text-body ${
          long && !open ? 'line-clamp-4' : ''
        }`}
      >
        {row.message}
      </p>

      {long && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="mt-2 text-xs font-medium text-gain underline underline-offset-2"
        >
          {t(open ? 'admin.messages.showLess' : 'admin.messages.showMore')}
        </button>
      )}
    </article>
  );
}

function Placeholder() {
  return (
    <div className="flex flex-col gap-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className="rounded-md border border-cool-grey bg-white p-5 shadow-card">
          <span className="block h-4 w-48 animate-pulse rounded-sm bg-mist" />
          <span className="mt-3 block h-3 w-full animate-pulse rounded-sm bg-mist" />
          <span className="mt-2 block h-3 w-3/4 animate-pulse rounded-sm bg-mist" />
        </div>
      ))}
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="rounded-md border border-cool-grey bg-white px-4 py-3 shadow-card">
      <div className="text-2xs text-text-muted">{label}</div>
      <div className="font-numeric text-lg font-semibold tabular-nums">
        {value.toLocaleString('en-US')}
      </div>
    </div>
  );
}
