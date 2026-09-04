import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import Icon from "./Icon";

/**
 * A dialog built on the native `<dialog>` element.
 *
 * Native rather than a div-with-a-backdrop because the platform already solves
 * the three things that are tedious and easy to get subtly wrong: focus is
 * trapped inside while open, Escape closes it, and it renders in the top layer
 * so no ancestor's `overflow` or `z-index` can clip it. A hand-rolled overlay
 * inside the dashboard panel would be clipped by the panel's own rounding.
 *
 * `showModal()` is called from an effect rather than by rendering an `open`
 * attribute — the attribute produces a NON-modal dialog, which looks correct
 * and silently skips the focus trap and the backdrop.
 */
export default function Modal({
  open,
  onClose,
  title,
  children,
  footer = undefined,
  className = "",
}) {
  const { t } = useTranslation();
  const ref = useRef(/** @type {HTMLDialogElement | null} */ (null));

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;

    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;

    // Escape fires `cancel`, which closes the dialog natively. Without telling
    // React about it the parent's `open` stays true and the dialog cannot be
    // reopened — it is already closed, so the effect above does nothing.
    const onCancel = (e) => {
      e.preventDefault();
      onClose();
    };
    dialog.addEventListener("cancel", onCancel);
    return () => dialog.removeEventListener("cancel", onCancel);
  }, [onClose]);

  return (
    <dialog
      ref={ref}
      // The backdrop is styled through the pseudo-element; `p-0` and `m-auto`
      // undo the UA's default centring box so the panel controls its own size.
      className={[
        "m-auto rounded-xl border border-cool-grey bg-white p-0 text-text-body shadow-panel backdrop:bg-ink/40",
        className || "w-[min(30rem,calc(100vw-2rem))]",
      ].join(" ")}
      onClick={(e) => {
        // Click-outside. The dialog element's own box IS the panel, so a click
        // whose target is the dialog itself landed on the backdrop.
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="flex items-center justify-between border-b border-cool-grey px-5 py-4">
        <h2 className="m-0 text-md font-bold">{title}</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("common.close")}
          className="inline-flex size-7 cursor-pointer items-center justify-center rounded-lg border border-transparent text-text-muted transition-colors hover:bg-mist hover:text-text-body"
        >
          <Icon name="close" size={16} />
        </button>
      </div>

      <div className="px-5 py-5">{children}</div>

      {footer && (
        <div className="border-t border-cool-grey px-5 py-4">{footer}</div>
      )}
    </dialog>
  );
}
