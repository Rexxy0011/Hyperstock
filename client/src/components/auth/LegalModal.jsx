import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Modal from "../ui/Modal";
import Button from "../ui/Button";
import Link from "../ui/Link";
import { DOCUMENTS, LAST_UPDATED } from "../../pages/legal/legalContent";

/**
 * Renders Terms of Service or Privacy Policy directly inside a Modal on the Auth page.
 * Keeps the user on /auth so form state (username, email, password, country) is never unmounted or lost.
 */
export default function LegalModal({
  open,
  initialDoc = "terms",
  onClose,
}) {
  const { t, i18n } = useTranslation();
  const [activeDoc, setActiveDoc] = useState(initialDoc);

  useEffect(() => {
    if (open) {
      setActiveDoc(initialDoc);
    }
  }, [open, initialDoc]);

  const doc = DOCUMENTS[activeDoc] || DOCUMENTS.terms;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={doc.title}
      className="w-[min(48rem,calc(100vw-2rem))] max-h-[85vh] flex flex-col"
      footer={
        <div className="flex justify-end">
          <Button variant="secondary" size="sm" onClick={onClose}>
            {t("common.close", "Close")}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        {/* Just Privacy and Terms toggle buttons */}
        <div className="flex gap-2 border-b border-cool-grey pb-3">
          <button
            type="button"
            onClick={() => setActiveDoc("terms")}
            className={`cursor-pointer rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-colors ${
              activeDoc === "terms"
                ? "bg-void text-white"
                : "bg-mist text-text-muted hover:bg-hover hover:text-void"
            }`}
          >
            {t("footer.terms", "Terms of Service")}
          </button>
          <button
            type="button"
            onClick={() => setActiveDoc("privacy")}
            className={`cursor-pointer rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-colors ${
              activeDoc === "privacy"
                ? "bg-void text-white"
                : "bg-mist text-text-muted hover:bg-hover hover:text-void"
            }`}
          >
            {t("footer.privacy", "Privacy Policy")}
          </button>
        </div>

        {/* Scrollable document body */}
        <div className="max-h-[55vh] overflow-y-auto pr-2 text-text-body">
          <div className="mb-4 text-xs text-text-muted">
            {t("legal.lastUpdated", "Last updated:")}{" "}
            <time dateTime={LAST_UPDATED} className="font-numeric tabular-nums">
              {new Date(LAST_UPDATED).toLocaleDateString(
                i18n.language === "uk" ? "uk-UA" : "en-US",
                {
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                }
              )}
            </time>
          </div>

          {i18n.language !== "en" && (
            <p className="mt-2 mb-4 rounded-md border border-cool-grey bg-mist px-3 py-2 text-xs text-text-body">
              {t("legal.englishOnly", "This legal document is available in English only.")}
            </p>
          )}

          {doc.intro?.map((para) => (
            <p
              key={para.slice(0, 40)}
              className="mt-0 mb-3 text-sm leading-relaxed text-text-body"
            >
              {para}
            </p>
          ))}

          {doc.sections?.map((section, i) => (
            <section key={section.heading} className="mt-6">
              <h3 className="m-0 text-md font-bold text-void">
                <span className="mr-2 font-numeric text-text-muted tabular-nums">
                  {i + 1}.
                </span>
                {section.heading}
              </h3>
              <div className="mt-3">
                {section.blocks?.map((block, j) => (
                  <LegalBlock key={j} block={block} />
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </Modal>
  );
}

function LegalBlock({ block }) {
  if (typeof block === "string") {
    return (
      <p className="mt-0 mb-3 text-sm leading-relaxed text-text-body">
        {block}
      </p>
    );
  }

  if (block.subheading) {
    return (
      <h4 className="mt-4 mb-2 text-sm font-semibold text-void">
        {block.subheading}
      </h4>
    );
  }

  if (block.list) {
    return (
      <ul className="mt-0 mb-3 flex list-none flex-col gap-1.5 p-0">
        {block.list.map((item) => (
          <li
            key={item}
            className="flex gap-2.5 text-sm leading-relaxed text-text-body"
          >
            <span
              aria-hidden="true"
              className="mt-2 size-1.5 shrink-0 rounded-full bg-cool-grey"
            />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    );
  }

  if (block.link) {
    return (
      <p className="mt-0 mb-3 text-sm leading-relaxed text-text-body">
        {block.link.before}
        <Link
          to={block.link.to}
          className="font-medium underline underline-offset-2"
        >
          {block.link.label}
        </Link>
        {block.link.after}
      </p>
    );
  }

  if (block.contact) {
    return (
      <div className="mt-2 mb-3 rounded-md border border-cool-grey bg-mist px-3 py-2.5">
        <p className="m-0 text-xs font-semibold text-void">
          {block.contact.name}
        </p>
        <a
          href={`mailto:${block.contact.email}`}
          className="mt-0.5 inline-block font-mono text-xs text-text-body underline underline-offset-2"
        >
          {block.contact.email}
        </a>
      </div>
    );
  }

  return null;
}
