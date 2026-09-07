/**
 * Password utilities for generating cryptographically random passwords
 * and calculating password strength.
 */

/**
 * Cryptographically random strong password generator.
 * Contains uppercase, lowercase, numbers, and special symbols (16 characters).
 * @returns {string}
 */
export function generateStrongPassword() {
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const numbers = '23456789';
  const symbols = '!@#$%^&*()_+~|}{[]:;?><,.-=';
  const all = upper + lower + numbers + symbols;

  const chars = [
    upper[Math.floor(Math.random() * upper.length)],
    lower[Math.floor(Math.random() * lower.length)],
    numbers[Math.floor(Math.random() * numbers.length)],
    symbols[Math.floor(Math.random() * symbols.length)],
  ];

  const array = new Uint32Array(12);
  crypto.getRandomValues(array);
  for (let i = 0; i < 12; i++) {
    chars.push(all[array[i] % all.length]);
  }

  return chars.sort(() => Math.random() - 0.5).join('');
}

/**
 * Calculates password strength on a 0-4 score scale.
 * @param {string} pwd
 * @param {((key: string, fallback?: string) => string)=} t Optional translation function
 * @returns {{ score: number, label: string, color: string }}
 */
export function getPasswordStrength(pwd, t = undefined) {
  if (!pwd) return { score: 0, label: '', color: '' };
  let score = 0;
  if (pwd.length >= 8) score++;
  if (pwd.length >= 12) score++;
  if (/[A-Z]/.test(pwd) && /[a-z]/.test(pwd)) score++;
  if (/[0-9]/.test(pwd) && /[^A-Za-z0-9]/.test(pwd)) score++;

  const weakLabel = t ? t('auth.strengthWeak', 'Weak') : 'Weak';
  const fairLabel = t ? t('auth.strengthFair', 'Fair') : 'Fair';
  const goodLabel = t ? t('auth.strengthGood', 'Good') : 'Good';
  const strongLabel = t ? t('auth.strengthStrong', 'Strong') : 'Strong';

  if (score <= 1) return { score: 1, label: weakLabel, color: 'bg-loss' };
  if (score === 2) return { score: 2, label: fairLabel, color: 'bg-amber' };
  if (score === 3) return { score: 3, label: goodLabel, color: 'bg-blue-500' };
  return { score: 4, label: strongLabel, color: 'bg-gain' };
}

/**
 * Validates whether a password meets the strong password standard (8+ chars and score >= 3).
 * @param {string} pwd
 * @returns {boolean}
 */
export function isStrongPassword(pwd) {
  if (!pwd || typeof pwd !== 'string' || pwd.length < 8) return false;
  return getPasswordStrength(pwd).score >= 3;
}
