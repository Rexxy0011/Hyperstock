import { Toaster } from 'react-hot-toast';

/**
 * The one mount point for toasts, in `Root` so every route has it.
 *
 * STYLED FROM THE DESIGN TOKENS, not the library's defaults. Its stock toast is
 * a white pill with a system font and its own shadow, which lands next to this
 * product's cards looking like a browser notification rather than part of the
 * page — so the surface, border and shadow are the same trio every Card uses,
 * and the gain/loss greens and reds are the ones the price columns already use.
 *
 * BOTTOM RIGHT, and that is a real constraint rather than taste. Top-centre and
 * top-right both cover the sticky nav — which carries the balance pill and the
 * account menu — and the one toast people most want to dismiss is the one over
 * the control they were reaching for. The dashboard footer is 67px and static,
 * so the bottom right corner is the only region nothing else occupies.
 *
 * `containerStyle` insets it past that footer. `gutter` is 8, staying on the
 * grid the rest of the app sits on.
 */
export default function Toasts() {
  return (
    <Toaster
      position="bottom-right"
      gutter={8}
      containerStyle={{ bottom: 24, right: 24 }}
      toastOptions={{
        // `--color-*` cannot be read from a JS object, so the values are the
        // resolved tokens. They are the only place in the client that repeats a
        // token literal, and the alternative — a stylesheet rule against the
        // library's class names — breaks silently when it renames one.
        style: {
          background: 'var(--color-white, #fff)',
          color: 'var(--color-void, #0b0b0f)',
          border: '1px solid var(--color-cool-grey, #e4e6eb)',
          borderRadius: 'var(--radius-md, 8px)',
          boxShadow: '0 8px 24px rgb(11 11 15 / 0.10)',
          fontSize: '14px',
          maxWidth: '380px',
          padding: '12px 14px',
        },
        success: { iconTheme: { primary: 'var(--color-gain, #16a34a)', secondary: '#fff' } },
        error: { iconTheme: { primary: 'var(--color-loss, #dc2626)', secondary: '#fff' } },
      }}
    />
  );
}
