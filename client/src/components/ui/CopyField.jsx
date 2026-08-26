import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FiCheck, FiCopy } from 'react-icons/fi';

/**
 * A value that exists to be copied exactly.
 *
 * THE PAYOUT ADDRESS IS THE CASE THIS WAS BUILT FOR. An operator approving a
 * withdrawal has to move that string into a wallet, and the two ways to do it
 * without a button are both bad: re-typing 42 characters of base58, or
 * selecting text that `break-all` has wrapped across three lines and hoping the
 * selection took the whole thing and no whitespace. Either mistake sends money
 * somewhere unrecoverable.
 *
 * `navigator.clipboard` NEEDS A SECURE CONTEXT — https, or localhost, which
 * development is. It is absent otherwise, so the button falls back to selecting
 * the text rather than silently doing nothing: a failed copy that visibly
 * selects is recoverable with one keystroke, whereas a button that appears to
 * work and does not is how the wrong thing ends up in the clipboard.
 *
 * The confirmation resets after 2s and the timer is cleared on unmount —
 * without that, copying and closing the modal sets state on a gone component.
 */
export default function CopyField({ value, label = undefined, className = '' }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const textRef = useRef(/** @type {HTMLSpanElement | null} */ (null));
  const timer = useRef(/** @type {ReturnType<typeof setTimeout> | undefined} */ (undefined));

  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // No clipboard permission, or an insecure context. Select it instead so
      // the operator can copy manually rather than being left with nothing.
      const node = textRef.current;
      if (!node) return;
      const range = document.createRange();
      range.selectNodeContents(node);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
  };

  return (
    <span className={`flex items-start gap-2 ${className}`}>
      {/* `break-all`, because an address has no spaces and would otherwise push
          the panel wider than the viewport. `select-all` makes a single click
          take the whole value when somebody copies by hand. */}
      <span ref={textRef} className="min-w-0 flex-1 font-mono text-xs break-all select-all">
        {value}
      </span>
      <button
        type="button"
        onClick={copy}
        // The label names WHAT is being copied — a screen reader hearing "copy"
        // on a queue of several rows learns nothing about which.
        aria-label={label ? t('common.copyValue', { label }) : t('common.copy')}
        title={t('common.copy')}
        className="shrink-0 cursor-pointer rounded-md border border-cool-grey p-1.5 text-text-muted transition-colors hover:bg-hover hover:text-void"
      >
        {copied ? (
          <FiCheck size={14} className="text-gain" aria-hidden="true" />
        ) : (
          <FiCopy size={14} aria-hidden="true" />
        )}
      </button>
      {/* Announced, not just shown — the icon swap is invisible to a screen
          reader, and "did that work" is the whole question this answers. */}
      <span role="status" className="sr-only">
        {copied ? t('common.copied') : ''}
      </span>
    </span>
  );
}
