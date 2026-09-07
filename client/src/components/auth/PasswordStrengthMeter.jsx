import { useTranslation } from 'react-i18next';
import { getPasswordStrength } from '../../lib/password';

/**
 * Visual strength indicator with progress segments and security guidance.
 *
 * @param {object} props
 * @param {string} props.password
 */
export default function PasswordStrengthMeter({ password }) {
  const { t } = useTranslation();
  if (!password) return null;

  const strength = getPasswordStrength(password, t);

  return (
    <div className="mt-1 space-y-1.5 rounded-md border border-cool-grey/40 bg-mist/50 p-2.5">
      <div className="flex items-center justify-between text-2xs">
        <span className="text-text-muted">{t('auth.passwordStrength', 'Password strength:')}</span>
        <span
          className={`font-semibold ${
            strength.score >= 3
              ? 'text-gain'
              : strength.score === 2
                ? 'text-amber'
                : 'text-loss'
          }`}
        >
          {strength.label}
        </span>
      </div>
      <div className="flex h-1.5 gap-1 overflow-hidden rounded-full bg-mist">
        {[1, 2, 3, 4].map((step) => (
          <div
            key={step}
            className={`h-full flex-1 rounded-full transition-all duration-300 ${
              step <= strength.score ? strength.color : 'bg-cool-grey/30'
            }`}
          />
        ))}
      </div>
      <p className="m-0 text-2xs text-text-muted">
        {t('auth.passwordTip', 'Tip: Use 8+ characters with uppercase, numbers, and symbols.')}
      </p>
    </div>
  );
}
