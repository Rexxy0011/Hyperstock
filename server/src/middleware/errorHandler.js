import { ZodError } from 'zod';
import { ApiError } from '../lib/ApiError.js';
import { env } from '../config/env.js';

/** Wraps an async route handler so rejections reach the error handler. */
export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

export function notFoundHandler(req, res) {
  res.status(404).json({
    error: { code: 'NOT_FOUND', message: `No route for ${req.method} ${req.originalUrl}` },
  });
}

// Express identifies error middleware by arity, so `_next` must stay.
export function errorHandler(err, req, res, _next) {
  if (err instanceof ApiError) {
    return res.status(err.status).json({
      error: { code: err.code, message: err.message, ...(err.details && { details: err.details }) },
    });
  }

  if (err.type === 'entity.too.large') {
    return res.status(413).json({
      error: { code: 'IMAGE_TOO_LARGE', message: 'The uploaded file is too large.' }
    });
  }

  if (err instanceof ZodError) {
    return res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      },
    });
  }

  // Duplicate key — surface which field collided rather than a raw driver dump.
  if (err?.code === 11000) {
    const field = Object.keys(err.keyPattern ?? {})[0] ?? 'field';
    return res.status(409).json({
      error: { code: 'DUPLICATE', message: `That ${field} is already taken`, details: { field } },
    });
  }

  if (err?.name === 'CastError') {
    return res.status(400).json({ error: { code: 'INVALID_ID', message: 'Malformed identifier' } });
  }

  console.error('Unhandled error:', err);
  res.status(500).json({
    error: {
      code: 'INTERNAL',
      message: 'Something went wrong',
      ...(env.NODE_ENV !== 'production' && { details: { stack: err?.stack } }),
    },
  });
}
