import { useTranslation } from 'react-i18next';
import Link from '../../components/ui/Link';
import { DOCUMENTS, LAST_UPDATED } from './legalContent';

/**
 * One component for all three legal documents.
 *
 * They share a shape — title, last-updated, intro, then numbered sections of
 * paragraphs and lists — so three near-identical page components would be three
 * places to fix a heading level. The numbering is COMPUTED from position, like
 * the FAQ's: hand-written numbers all need renumbering the moment a section is
 * inserted anywhere but the end.
 *
 * The chrome is translated and the document body is not — see the note at the
 * top of `legalContent.js`. The notice saying so is chrome, so it renders in the
 * reader's own language, which is the only way it can do its job.
 *
 * `max-w-180` on the prose, not the page: legal text is read line by line and a
 * 1400px measure is unreadable, but the heading and the meta line above it want
 * the page's own gutter.
 */
export default function LegalDocument({ id }) {
  const { t, i18n } = useTranslation();
  const doc = DOCUMENTS[id];

  if (!doc) return null;

  return (
    <div className="mx-auto w-full max-w-300 px-6 py-16 lg:px-10">
      <header className="mb-10 border-b border-cool-grey pb-8">
        <h1 className="m-0 text-[clamp(28px,4vw,40px)] font-bold text-void">{doc.title}</h1>
        <p className="mt-3 mb-0 text-sm text-text-muted">
          {t('legal.lastUpdated')}{' '}
          <time dateTime={LAST_UPDATED} className="font-numeric tabular-nums">
            {new Date(LAST_UPDATED).toLocaleDateString(i18n.language === 'uk' ? 'uk-UA' : 'en-US', {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })}
          </time>
        </p>

        {/* Only shown to a reader who is not reading the governing language.
            In English it would be a statement of the obvious taking up the top
            of every legal page. */}
        {i18n.language !== 'en' && (
          <p className="mt-4 mb-0 max-w-180 rounded-md border border-cool-grey bg-mist px-4 py-3 text-sm text-text-body">
            {t('legal.englishOnly')}
          </p>
        )}
      </header>

      <div className="max-w-180">
        {doc.intro.map((para) => (
          <p key={para.slice(0, 40)} className="mt-0 mb-4 text-base leading-relaxed text-text-body">
            {para}
          </p>
        ))}

        {doc.sections.map((section, i) => (
          <section key={section.heading} className="mt-10">
            <h2 className="m-0 text-xl font-bold text-void">
              <span className="mr-2 font-numeric text-text-muted tabular-nums">{i + 1}.</span>
              {section.heading}
            </h2>
            <div className="mt-4">
              {section.blocks.map((block, j) => (
                <Block key={j} block={block} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

/**
 * The block shapes the source actually has. A markdown renderer for this would
 * be more machinery than the content needs, and `dangerouslySetInnerHTML` over
 * legal copy is a class of bug worth not having.
 *
 * Nothing here is translated — the documents are English only, so `Block` takes
 * no `t`. See the note at the top of `legalContent.js`.
 */
function Block({ block }) {
  if (typeof block === 'string') {
    return <p className="mt-0 mb-4 text-base leading-relaxed text-text-body">{block}</p>;
  }

  if (block.subheading) {
    return <h3 className="mt-6 mb-2 text-base font-semibold text-void">{block.subheading}</h3>;
  }

  if (block.list) {
    return (
      <ul className="mt-0 mb-4 flex list-none flex-col gap-1.5 p-0">
        {block.list.map((item) => (
          <li key={item} className="flex gap-2.5 text-base leading-relaxed text-text-body">
            {/* A marker span rather than a list-style bullet: the default sits
                on the first line's baseline and drifts on a wrapped item. */}
            <span aria-hidden="true" className="mt-2.5 size-1.5 shrink-0 rounded-full bg-cool-grey" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    );
  }

  if (block.link) {
    return (
      <p className="mt-0 mb-4 text-base leading-relaxed text-text-body">
        {block.link.before}
        <Link to={block.link.to} className="font-medium underline underline-offset-2">
          {block.link.label}
        </Link>
        {block.link.after}
      </p>
    );
  }

  if (block.contact) {
    return (
      <div className="mt-2 mb-4 rounded-md border border-cool-grey bg-mist px-4 py-3.5">
        <p className="m-0 text-sm font-semibold text-void">{block.contact.name}</p>
        <a
          href={`mailto:${block.contact.email}`}
          className="mt-0.5 inline-block font-mono text-sm text-text-body underline underline-offset-2"
        >
          {block.contact.email}
        </a>
      </div>
    );
  }

  return null;
}
