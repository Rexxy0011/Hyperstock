import { useEffect, useId, useRef, useState } from 'react';
import Icon from './Icon';

/**
 * A dropdown built as a listbox, not a native `<select>`.
 *
 * IT REPLACED A NATIVE ONE FOR A REASON THAT WAS NOT COSMETIC. Chrome draws the
 * native popup with the SYSTEM appearance while `<option>` text inherits the
 * page's `color` — so on a machine set to dark mode the list rendered dark text
 * on a dark popup and read as completely empty. Nothing about the markup was
 * wrong; the control simply cannot be relied on to own both halves of its own
 * contrast. A listbox owns both.
 *
 * What that buys beyond fixing it: an option can be more than a string. These
 * rows carry a coin logo, a ticker, a name and a hint, which a native select
 * cannot render at all.
 *
 * The parts that are easy to get wrong and are handled here — the reason this
 * is worth a component rather than a div with an onClick:
 *   - roles: `combobox` + `listbox` + `option`, with `aria-activedescendant`,
 *     so a screen reader announces the highlighted row rather than silence
 *   - full keyboard control: arrows, Home/End, Enter/Space, Escape, Tab
 *   - focus returns to the trigger on close, so Tab order does not jump
 *   - click-outside and Escape both close it
 *   - the highlighted row is scrolled into view as it moves
 */
export default function Select({
  value,
  onChange,
  options = [],
  placeholder = 'Select',
  disabled = false,
  id = undefined,
  className = '',
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const rootRef = useRef(/** @type {HTMLDivElement | null} */ (null));
  const listRef = useRef(/** @type {HTMLUListElement | null} */ (null));
  const buttonRef = useRef(/** @type {HTMLButtonElement | null} */ (null));
  const listId = useId();

  const selectedIndex = options.findIndex((o) => o.value === value);
  const selected = selectedIndex >= 0 ? options[selectedIndex] : null;

  // Opening lands on the current choice rather than the top, so reopening and
  // pressing Enter is a no-op instead of silently picking the first option.
  useEffect(() => {
    if (open) setActive(selectedIndex >= 0 ? selectedIndex : 0);
  }, [open, selectedIndex]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (!rootRef.current?.contains(e.target)) setOpen(false);
    };
    // `pointerdown`, not `click`: a click that starts inside and ends outside
    // should not close it, and vice versa.
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  useEffect(() => {
    if (!open || active < 0) return;
    listRef.current?.children[active]?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  const commit = (index) => {
    const option = options[index];
    if (!option) return;
    onChange(option.value);
    setOpen(false);
    buttonRef.current?.focus();
  };

  const onKeyDown = (e) => {
    if (disabled) return;

    if (!open) {
      // Down/Up/Enter/Space all open it — every convention a user might carry
      // over from a native select.
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setActive((i) => Math.min(options.length - 1, i + 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setActive((i) => Math.max(0, i - 1));
        break;
      case 'Home':
        e.preventDefault();
        setActive(0);
        break;
      case 'End':
        e.preventDefault();
        setActive(options.length - 1);
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        commit(active);
        break;
      case 'Escape':
        e.preventDefault();
        setOpen(false);
        buttonRef.current?.focus();
        break;
      case 'Tab':
        // Not prevented: Tab should move on, and leaving it open behind a
        // focused element elsewhere would be a stray popup.
        setOpen(false);
        break;
      default:
        break;
    }
  };

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        ref={buttonRef}
        id={id}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open && active >= 0 ? `${listId}-${active}` : undefined}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onKeyDown}
        className={[
          'flex w-full cursor-pointer items-center gap-3 rounded-lg border bg-white px-3 py-2.5 text-left',
          'transition-colors',
          open ? 'border-gain' : 'border-cool-grey hover:border-slate/40',
          'disabled:cursor-not-allowed disabled:bg-mist disabled:text-text-muted',
          'focus-visible:border-gain focus-visible:outline-none',
        ].join(' ')}
      >
        {selected ? (
          <>
            <Mark option={selected} />
            <span className="min-w-0 flex-1">
              {/*
                `triggerLabel` is an optional SHORT form for the closed control,
                for the case where the list needs a full name and the trigger
                has no room for one. The language switcher is exactly that: the
                menu must read "Українська" — somebody who cannot read the
                current interface language cannot read "Ukrainian" either — while
                the nav slot fits about three characters. Without it the trigger
                rendered "У…", which names nothing.
              */}
              <span className="block truncate text-sm font-semibold text-void">
                {selected.triggerLabel ?? selected.label}
              </span>
              {selected.sublabel && (
                <span className="block truncate text-2xs text-text-muted">
                  {selected.sublabel}
                </span>
              )}
            </span>
          </>
        ) : (
          <span className="flex-1 truncate text-sm text-text-muted">{placeholder}</span>
        )}

        <Icon
          name="chevronDown"
          size={16}
          className={`shrink-0 text-text-muted transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          // z-20 clears the page but stays under the nav's z-30 — a dropdown
          // painting over the navbar reads as a rendering fault.
          className="absolute z-20 mt-1.5 max-h-72 w-full list-none overflow-y-auto rounded-lg border border-cool-grey bg-white p-1 shadow-panel"
        >
          {options.map((o, i) => {
            const isSelected = o.value === value;
            return (
              <li
                key={o.value}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={isSelected}
                onMouseEnter={() => setActive(i)}
                onClick={() => commit(i)}
                className={[
                  'flex cursor-pointer items-center gap-3 rounded-md px-2.5 py-2 transition-colors',
                  i === active ? 'bg-hover' : '',
                ].join(' ')}
              >
                <Mark option={o} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-void">{o.label}</span>
                  {o.sublabel && (
                    <span className="block truncate text-2xs text-text-muted">{o.sublabel}</span>
                  )}
                </span>
                {isSelected && (
                  <Icon name="check" size={16} className="shrink-0 text-gain" aria-hidden="true" />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * The option's own icon node.
 *
 * A ReactNode rather than a URL, so the control stays a control: deciding what
 * a crypto row looks like is `CoinIcon`'s job, and Select has no business
 * knowing that BEP20 means BNB Chain.
 */
function Mark({ option }) {
  return option.icon ?? null;
}
