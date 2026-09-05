import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useMutation } from "@tanstack/react-query";
import Link from "../components/ui/Link";
import Button from "../components/ui/Button";
import Input from "../components/ui/Input";
import Select from "../components/ui/Select";
import Icon from "../components/ui/Icon";
import Eyebrow from "../components/ui/Eyebrow";
import Reveal from "../components/ui/Reveal";
import { assets } from "../assets/assets";
import { post } from "../lib/api";
import notify from "../lib/toast";
import {
  SUPPORT_EMAIL,
  SUPPORT_PHONE,
  OFFICE,
  OFFICE_HOURS,
  officeMapSrc,
  officeMapLink,
} from "../lib/contact";

/**
 * `/contact` — built from the supplied reference, which has three bands: a
 * titled hero with a breadcrumb, an information card beside a form card, and a
 * captioned map.
 *
 * IT IS PUBLIC, AND IT USED TO BE BEHIND THE SESSION. The route was a
 * `ComingSoon` stub inside `ProtectedRoute`, while `/faqs` — which is public —
 * carries two buttons pointing at it. So an anonymous reader following
 * "Contact support" from the FAQ was bounced to `/auth`, which is the opposite
 * of what a contact page is for: the people most likely to need it are the ones
 * who have not signed up yet. It sits in `PublicLayout` beside `/about` and
 * `/faqs` now, marketing regardless of session.
 *
 * THE FORM WRITES A ROW. `POST /api/contact` stores the message and
 * `/soap/messages` is where an operator reads it — see the note on
 * `models/ContactMessage.js` for why that is a collection here rather than a
 * third-party form backend, which is the same argument the newsletter capture
 * already settled.
 *
 * WHAT IS NOT REPLICATED FROM THE REFERENCE, deliberately. Its palette is a
 * peach gradient and its service list ("Web Design", "SEO") describes an
 * agency. The layout is the thing being copied; the colours come from this
 * product's tokens and the topics from its own surfaces, because a picker
 * offering services nobody here provides is a form that collects unanswerable
 * enquiries.
 */
export default function Contact() {
  return (
    <>
      <Hero />
      <MainBands />
      <LocationBand />
    </>
  );
}

/* -------------------------------------------------------------------- hero */

/**
 * The reference's titled banner: a centred page title over a soft wash, with a
 * breadcrumb beneath it.
 *
 * The wash is `mist` fading to white rather than the reference's orange, which
 * is its brand and not ours. It is the same band `/faqs` opens on, so the two
 * marketing pages start the same way.
 */
function Hero() {
  const { t } = useTranslation();

  return (
    <section className="border-b border-cool-grey bg-linear-to-b from-mist to-white">
      <div className="mx-auto w-full max-w-300 px-4 py-16 text-center sm:px-6 lg:px-10 lg:py-24">
        <h1 className="m-0 text-[clamp(30px,5vw,52px)] font-bold text-void">
          {t("contact.title")}
        </h1>

        {/* A real `<nav>` with an ordered list, not a row of divs: a breadcrumb
            is a navigation landmark, and `aria-current` is what tells a screen
            reader which crumb is the page it is already on. */}
        <nav aria-label={t("contact.breadcrumb")} className="mt-5">
          <ol className="m-0 flex list-none items-center justify-center gap-2 p-0 text-sm">
            <li>
              <Link
                to="/"
                className="text-text-muted no-underline transition-colors hover:text-void"
              >
                {t("contact.breadcrumbHome")}
              </Link>
            </li>
            <li
              aria-hidden="true"
              className="flex items-center text-text-muted"
            >
              <Icon name="chevronRight" size={13} />
            </li>
            <li aria-current="page" className="font-medium text-void">
              {t("contact.title")}
            </li>
          </ol>
        </nav>
      </div>
    </section>
  );
}

/* ------------------------------------------------------- information + form */

/**
 * The reference's two cards, side by side.
 *
 * THE SPLIT IS 2:3 RATHER THAN EQUAL. The left card holds four short facts and
 * the right holds five fields — given equal halves the information column ends
 * roughly 200px short and the row reads as a card that failed to load. Below
 * `lg` they stack, information first, because a phone number and an address are
 * useful on their own and a form is the longer commitment.
 */
function MainBands() {
  return (
    <section className="mx-auto w-full max-w-300 px-4 py-14 sm:px-6 lg:px-10 lg:py-20">
      {/* `items-start`, and NOTHING CARRIES `h-full`. Stretching the
          information card to the form's height left ~180px of empty card under
          "Our Location" at 1440 — measured — which reads as content that failed
          to load rather than as a short list. Four facts are a short list; the
          card should be the size of them. */}
      <div className="grid items-start gap-6 lg:grid-cols-[2fr_3fr] lg:gap-8">
        <Reveal>
          <ContactInformation />
        </Reveal>
        <Reveal delay={90}>
          <ContactForm />
        </Reveal>
      </div>
    </section>
  );
}

/**
 * The four facts, each a row with a boxed icon.
 *
 * THREE OF THE FOUR ARE LINKS AND THE FOURTH IS NOT. A phone number and an
 * address are things people act on — `tel:` and `mailto:` are one tap on the
 * device most likely to be reading this — whereas opening hours are a fact with
 * nowhere to go. Making all four look identical would either put a dead
 * pointer on the hours or hide the two that work.
 */
function ContactInformation() {
  const { t } = useTranslation();

  const rows = [
    {
      icon: assets.icons.contactPhone,
      label: t("contact.phoneLabel"),
      value: SUPPORT_PHONE.display,
      href: `tel:${SUPPORT_PHONE.dial}`,
    },
    {
      icon: assets.icons.contactMail,
      label: t("contact.emailLabel"),
      value: SUPPORT_EMAIL,
      href: `mailto:${SUPPORT_EMAIL}`,
    },
    {
      icon: assets.icons.contactClock,
      label: t("contact.hoursLabel"),
      value: t("contact.hoursValue", {
        days: t(`contact.days.${OFFICE_HOURS.days}`),
        from: OFFICE_HOURS.from,
        to: OFFICE_HOURS.to,
        zone: OFFICE_HOURS.zone,
      }),
    },
    {
      icon: assets.icons.contactPin,
      label: t("contact.locationLabel"),
      value: OFFICE.lines.join(", "),
      href: officeMapLink(),
      external: true,
    },
  ];

  return (
    <div className="rounded-xl border border-cool-grey bg-white p-7 shadow-card sm:p-8">
      <h2 className="m-0 text-lg font-bold text-void">
        {t("contact.infoTitle")}
      </h2>
      <p className="mt-3 mb-0 text-sm leading-relaxed text-text-muted">
        {t("contact.infoBody")}
      </p>

      <ul className="mt-7 m-0 flex list-none flex-col p-0">
        {rows.map((row) => (
          <li
            key={row.label}
            className="flex items-start gap-4 border-b border-cool-grey py-4 last:border-b-0 last:pb-0"
          >
            {/* NO TINT CHIP BEHIND THESE. The reference boxes its icons, and
                the first version did too — but these four marks carry their own
                framing (three are circular badges), so a rounded square behind
                them is a box drawn around a circle. The artwork sits directly
                on the card instead.

                `alt=""` and `aria-hidden`: the label beside it already says
                "Phone Number", so a described image here would have a screen
                reader announce the same fact twice. */}
            <img
              src={row.icon}
              alt=""
              aria-hidden="true"
              width={40}
              height={40}
              loading="lazy"
              className="mt-0.5 size-10 shrink-0 object-contain"
            />

            <div className="min-w-0">
              <p className="m-0 text-sm font-medium text-void">{row.label}</p>
              {row.href ? (
                <a
                  href={row.href}
                  {...(row.external
                    ? { target: "_blank", rel: "noopener noreferrer" }
                    : {})}
                  className="mt-1 block text-sm wrap-break-word text-text-muted no-underline transition-colors hover:text-gain"
                >
                  {row.value}
                </a>
              ) : (
                <p className="mt-1 mb-0 text-sm text-text-muted">{row.value}</p>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The topics the picker offers. Mirrors the server's enum — see the note there. */
const TOPICS = ["account", "funding", "trading", "partnership", "other"];

const EMPTY = { name: "", email: "", phone: "", topic: "", message: "" };

/**
 * The form.
 *
 * IT IS REPLACED IN PLACE BY A CONFIRMATION, not reset to empty fields. This is
 * the lesson the newsletter capture already recorded: a cleared form is
 * indistinguishable from a submit that did nothing, and it invites the same
 * message a second time. The confirmation carries the reference id, so somebody
 * following up has something to quote.
 *
 * `required` on the four real fields is doing genuine work rather than
 * decorating: the browser's own validation runs before the request, so an empty
 * submit costs no round trip and lands the caret in the offending field, which
 * a server 400 rendered as a toast cannot do.
 */
const CONTACT_DRAFT_KEY = "hyperstocks_contact_draft";

function ContactForm() {
  const { t } = useTranslation();
  const savedForm = (() => {
    try {
      const raw = sessionStorage.getItem(CONTACT_DRAFT_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  })();

  const [form, setForm] = useState(() => ({
    ...EMPTY,
    ...(savedForm || {}),
  }));
  const [sentId, setSentId] = useState(/** @type {string | null} */ (null));

  useEffect(() => {
    try {
      sessionStorage.setItem(CONTACT_DRAFT_KEY, JSON.stringify(form));
    } catch {}
  }, [form]);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const mutation = useMutation({
    mutationFn: () =>
      post("/contact", {
        ...form,
        // The picker's placeholder is an empty string, which the server's enum
        // would reject. It is genuinely optional, so it becomes the default
        // rather than blocking the send on a field nobody has to fill.
        topic: form.topic || "other",
      }),
    onSuccess: (data) => {
      setSentId(data?.id ?? "");
      setForm(EMPTY);
      try {
        sessionStorage.removeItem(CONTACT_DRAFT_KEY);
      } catch {}
    },
    // Inline is not an option here — the form has been replaced by the time a
    // failure could render beneath it — so this one speaks through the toast.
    onError: (err) => notify.apiError(err, t("contact.sendFailed")),
  });

  if (sentId !== null) {
    return (
      <div className="flex h-full flex-col items-start justify-center rounded-xl border border-cool-grey bg-white p-7 shadow-card sm:p-8">
        <span
          aria-hidden="true"
          className="flex size-11 items-center justify-center rounded-full bg-green-tint text-gain"
        >
          <Icon name="check" size={22} />
        </span>
        <h2 className="mt-5 mb-0 text-lg font-bold text-void">
          {t("contact.sentTitle")}
        </h2>
        <p className="mt-3 mb-0 max-w-125 text-sm leading-relaxed text-text-muted">
          {t("contact.sentBody")}
        </p>
        {sentId && (
          <p className="mt-4 mb-0 font-mono text-xs text-text-muted">
            {t("contact.sentRef", { id: sentId })}
          </p>
        )}
        <Button
          variant="secondary"
          size="sm"
          className="mt-6"
          onClick={() => setSentId(null)}
        >
          {t("contact.sendAnother")}
        </Button>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-cool-grey bg-white p-7 shadow-card sm:p-8">
      <Eyebrow className="self-start">{t("contact.eyebrow")}</Eyebrow>

      <h2 className="mt-5 mb-0 text-xl font-bold text-void">
        {t("contact.formTitle")}
      </h2>
      <p className="mt-3 mb-0 max-w-150 text-sm leading-relaxed text-text-muted">
        {t("contact.formBody")}
      </p>

      <form
        className="mt-7 flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!mutation.isPending) mutation.mutate();
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label={t("contact.fieldName")}
            value={form.name}
            onChange={set("name")}
            autoComplete="name"
            maxLength={120}
            required
          />
          <Input
            label={t("contact.fieldEmail")}
            type="email"
            value={form.email}
            onChange={set("email")}
            autoComplete="email"
            maxLength={254}
            required
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label={t("contact.fieldPhone")}
            type="tel"
            value={form.phone}
            onChange={set("phone")}
            autoComplete="tel"
            maxLength={40}
            hint={t("contact.optional")}
          />

          {/* THE LABEL IS A SIBLING WITH `htmlFor`, NEVER A WRAPPER. `Select` is
              a listbox rather than a native control, and a `<label>` around it
              forwards every click inside itself to the label's control — so
              pressing an option commits it, closes the list, and the forwarded
              click then reopens it. Measured on the payout form: the value was
              right and the dropdown would not shut. */}
          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="contact-topic"
              className="text-sm font-medium text-text-body"
            >
              {t("contact.fieldTopic")}
            </label>
            <Select
              id="contact-topic"
              value={form.topic}
              onChange={(v) => setForm((f) => ({ ...f, topic: v }))}
              placeholder={t("contact.topicPlaceholder")}
              options={TOPICS.map((value) => ({
                value,
                label: t(`contact.topic.${value}`),
              }))}
            />
          </div>
        </div>

        <Input
          as="textarea"
          label={t("contact.fieldMessage")}
          value={form.message}
          onChange={set("message")}
          rows={6}
          maxLength={4000}
          required
          className="[&_textarea]:resize-y"
        />

        <Button
          type="submit"
          pill
          loading={mutation.isPending}
          disabled={mutation.isPending}
          className="mt-1 self-start"
        >
          {mutation.isPending ? t("contact.sending") : t("contact.send")}
        </Button>
      </form>
    </div>
  );
}

/* ---------------------------------------------------------------- location */

/**
 * The captioned map, which is the band the reference ends on before its footer.
 *
 * THE IFRAME IS LAZY AND TITLED. `loading="lazy"` matters more here than on an
 * image: an eager map frame is a third-party document plus its tiles fetched on
 * every page load, for a band that sits below two full screens of content. The
 * `title` is what a screen reader announces in place of the frame, and without
 * one the whole embed is announced as an untitled document — which is why the
 * address is printed above it in text as well, rather than only being drawn.
 *
 * `border-0` on the element AND the class: some browsers still apply the legacy
 * `frameborder` presentation, and a 2px inset line inside a rounded card reads
 * as a rendering fault.
 */
function LocationBand() {
  const { t } = useTranslation();

  return (
    <section className="border-t border-cool-grey bg-mist/40">
      <div className="mx-auto w-full max-w-300 px-4 py-16 sm:px-6 lg:px-10 lg:py-20">
        <Reveal className="flex flex-col items-center text-center">
          <Eyebrow>{t("contact.locationEyebrow")}</Eyebrow>
          <h2 className="mt-5 mb-0 max-w-175 text-[clamp(22px,3vw,32px)] font-bold text-void">
            {t("contact.locationTitle")}
          </h2>
          <p className="mt-4 mb-0 max-w-150 text-sm text-text-muted">
            {OFFICE.lines.join(", ")}
          </p>
        </Reveal>

        <Reveal delay={90} className="mt-10">
          <div className="overflow-hidden rounded-xl border border-cool-grey bg-white shadow-card">
            <iframe
              title={t("contact.mapTitle")}
              src={officeMapSrc()}
              loading="lazy"
              /**
               * SANDBOXED TO THE THREE THINGS A MAP NEEDS. Without the
               * attribute an embedded document may run script, submit forms,
               * open popups AND navigate the top-level page — that last one is
               * the dangerous default, because a third-party frame can then
               * redirect the whole tab away from a page that has a session on
               * it. `allow-scripts` and `allow-same-origin` are what make the
               * tiles pan; `allow-popups` is what lets the OSM link open. It
               * has `allow-scripts` and `allow-same-origin` together, which for
               * a SAME-origin frame would let it remove its own sandbox — this
               * one is cross-origin, where that does not apply.
               */
              sandbox="allow-scripts allow-same-origin allow-popups"
              // Send no path or query to the map host; the coordinates are
              // already in the URL it is being asked for.
              referrerPolicy="no-referrer"
              className="block h-80 w-full border-0 sm:h-105 lg:h-120"
            />
          </div>

          <p className="mt-3 mb-0 text-center text-xs text-text-muted">
            <a
              href={officeMapLink()}
              target="_blank"
              rel="noopener noreferrer"
              className="text-text-muted underline underline-offset-2 transition-colors hover:text-void"
            >
              {t("contact.viewLarger")}
            </a>
          </p>
        </Reveal>
      </div>
    </section>
  );
}
