import { useId } from 'react';

/**
 * Ported from the design system's components/forms/Input.jsx.
 * Focus styling moves from React state to :focus-within, so it also works for
 * keyboard navigation and autofill.
 */
export default function Input({
  label = undefined,
  hint = undefined,
  error = undefined,
  className = '',
  as = 'input',
  id: providedId = undefined,
  ...rest
}) {
  const autoId = useId();
  const id = providedId ?? autoId;
  // 'input' | 'textarea' chosen at runtime — see Money.jsx.
  const Tag = /** @type {any} */ (as);

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      {label && (
        <label htmlFor={id} className="text-sm font-medium text-text-body">
          {label}
        </label>
      )}

      <Tag
        id={id}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={error || hint ? `${id}-msg` : undefined}
        className={[
          'w-full rounded-md border bg-white px-3 py-2.5 text-base text-text-body',
          'transition-colors placeholder:text-text-muted',
          'focus:border-gain focus:outline-none',
          error ? 'border-loss' : 'border-cool-grey',
          as === 'textarea' ? 'resize-y font-body' : '',
        ].join(' ')}
        {...rest}
      />

      {(error || hint) && (
        <span id={`${id}-msg`} className={`text-xs ${error ? 'text-loss' : 'text-text-muted'}`}>
          {error || hint}
        </span>
      )}
    </div>
  );
}
