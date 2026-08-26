import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FiEye, FiEyeOff } from 'react-icons/fi';

/**
 * Ported from the design system's components/forms/Input.jsx.
 * Focus styling moves from React state to :focus-within, so it also works for
 * keyboard navigation and autofill.
 *
 * `icon` AND `revealable` ARE PROPS, NOT className, for the reason `code`
 * already is and `Button` has `pill`: both change the field's own padding, and
 * a conflicting padding utility passed through className is resolved by
 * position in the generated stylesheet rather than by order in the attribute,
 * so one of them loses silently.
 *
 * THE REVEAL TOGGLE IS A REAL USABILITY FIX, not decoration. A password typed
 * blind on a phone keyboard is the single most common reason a correct
 * credential gets rejected, and it matters most on the signup field, where
 * there is no second chance to notice a typo before the account exists. It
 * swaps `type` rather than using `-webkit-text-security`, so a password manager
 * still recognises the field.
 */
export default function Input({
  label = undefined,
  hint = undefined,
  error = undefined,
  className = '',
  as = 'input',
  code = false,
  icon = undefined,
  revealable = false,
  id: providedId = undefined,
  type = undefined,
  ...rest
}) {
  const { t } = useTranslation();
  const autoId = useId();
  const id = providedId ?? autoId;
  const [revealed, setRevealed] = useState(false);
  // 'input' | 'textarea' chosen at runtime — see Money.jsx.
  const Tag = /** @type {any} */ (as);

  const canReveal = revealable && type === 'password';
  const resolvedType = canReveal && revealed ? 'text' : type;

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      {label && (
        <label htmlFor={id} className="text-sm font-medium text-text-body">
          {label}
        </label>
      )}

      <div className="relative">
        {icon && (
          // `peer-focus` cannot reach backwards, so the icon tints from the
          // wrapper's focus-within instead — same result, and it survives
          // autofill, which does not fire focus on the input in every browser.
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-text-muted transition-colors"
          >
            {icon}
          </span>
        )}

        <Tag
        id={id}
        type={resolvedType}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={error || hint ? `${id}-msg` : undefined}
        className={[
          'w-full rounded-md border bg-white py-2.5 text-text-body',
          icon ? 'pl-10' : 'pl-3',
          canReveal ? 'pr-10' : 'pr-3',
          'transition-colors placeholder:text-text-muted',
          // A RING AS WELL AS THE BORDER. A 1px colour change on its own is
          // easy to miss, and this is the only signal telling somebody which
          // field their keyboard is pointed at. Tinted at 15% so it reads as a
          // glow rather than a second border.
          'focus:border-gain focus:ring-2 focus:ring-gain/15 focus:outline-none',
          error ? 'border-loss' : 'border-cool-grey',
          as === 'textarea' ? 'resize-y font-body' : '',
          /**
           * A PROP RATHER THAN A className, for the reason `Button` has `pill`:
           * the size here conflicts with the base `text-base`, and conflicting
           * utilities passed through className are resolved by position in the
           * generated stylesheet rather than by order in the attribute — so one
           * of them loses silently. Only one is ever emitted.
           *
           * Numeric, not mono: a one-time code is a figure, and `--font-numeric`
           * carries the tabular set so six digits do not shift as they are typed.
           */
          code
            ? 'text-center font-numeric text-lg tracking-[0.4em] tabular-nums'
            : 'text-base',
        ].join(' ')}
        {...rest}
        />

        {canReveal && (
          <button
            type="button"
            // `tabIndex={-1}` deliberately: tabbing from the password field
            // should reach the submit button, not a display toggle. It stays
            // reachable by pointer and by a screen reader's own controls.
            tabIndex={-1}
            onClick={() => setRevealed((v) => !v)}
            aria-label={revealed ? t('auth.hidePassword') : t('auth.showPassword')}
            aria-pressed={revealed}
            className="absolute inset-y-0 right-0 flex w-10 cursor-pointer items-center justify-center text-text-muted transition-colors hover:text-void"
          >
            {revealed ? (
              <FiEyeOff size={16} aria-hidden="true" />
            ) : (
              <FiEye size={16} aria-hidden="true" />
            )}
          </button>
        )}
      </div>

      {(error || hint) && (
        <span id={`${id}-msg`} className={`text-xs ${error ? 'text-loss' : 'text-text-muted'}`}>
          {error || hint}
        </span>
      )}
    </div>
  );
}
