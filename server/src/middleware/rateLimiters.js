import rateLimit from "express-rate-limit";

/**
 * Shared limits for endpoints whose abuse can affect an account balance or
 * credential. `express-rate-limit`'s default in-memory store is appropriate
 * for this long-running API process. If the API moves to a multi-instance or
 * serverless deployment, replace it with a shared store before relying on
 * these limits as a production control.
 */
const limited = ({ windowMs, max, message, keyGenerator = null }) =>
  rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    ...(keyGenerator && { keyGenerator }),
    message: { error: { code: "RATE_LIMITED", message } },
  });

/** Public credential mutation endpoints are strictly limited by IP to prevent brute-forcing. */
export const authAttemptLimiter = limited({
  windowMs: 15 * 60_000,
  max: 10,
  message: "Too many authentication attempts. Try again in 15 minutes.",
  keyGenerator: (req) => req.ip,
});

/** Read-only auth polling and session validation endpoints. */
export const authSessionLimiter = limited({
  windowMs: 15 * 60_000,
  max: 150,
  message: "Too many session requests. Try again later.",
  keyGenerator: (req) => req.ip,
});

/** Directs sensitive auth actions to the strict limiter and reads to the session limiter. */
export const selectiveAuthLimiter = (req, res, next) => {
  const url = req.originalUrl || req.url || "";
  if (
    url.includes("/sign-in") ||
    url.includes("/sign-up") ||
    url.includes("/email-otp") ||
    url.includes("/reset-password") ||
    url.includes("/change-password")
  ) {
    return authAttemptLimiter(req, res, next);
  }
  return authSessionLimiter(req, res, next);
};

export const authLimiter = selectiveAuthLimiter;

/**
 * Authenticated requests are limited per account. This prevents a distributed
 * client from bypassing a money-operation limit by changing IP addresses while
 * avoiding an entire office being penalised for one account's activity.
 */
const accountKey = (req) => (req.user?.id ? `account:${req.user.id}` : req.ip);

export const orderLimiter = limited({
  windowMs: 60_000,
  max: 30,
  message: "Too many trade requests. Please wait a minute and try again.",
  keyGenerator: accountKey,
});

export const topUpLimiter = limited({
  windowMs: 60 * 60_000,
  max: 5,
  message: "Too many top-up requests. Try again in an hour.",
  keyGenerator: accountKey,
});

export const depositLimiter = limited({
  windowMs: 60 * 60_000,
  max: 10,
  message: "Too many deposit requests. Try again in an hour.",
  keyGenerator: accountKey,
});

export const withdrawalLimiter = limited({
  windowMs: 60 * 60_000,
  max: 5,
  message: "Too many withdrawal requests. Try again in an hour.",
  keyGenerator: accountKey,
});

/** Admin queue actions are account-bound but leave room for normal queue work. */
export const adminMoneyActionLimiter = limited({
  windowMs: 60 * 60_000,
  max: 60,
  message: "Too many approval actions. Try again in an hour.",
  keyGenerator: accountKey,
});
