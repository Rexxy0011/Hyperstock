import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import cors from 'cors';
import helmet from 'helmet';
import mongoSanitize from 'express-mongo-sanitize';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import { toNodeHandler } from 'better-auth/node';
import { env } from './config/env.js';
import { createAuth } from './auth/betterAuth.js';
import routes from './routes/index.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { authLimiter } from './middleware/rateLimiters.js';

const sourceDirectory = path.dirname(fileURLToPath(import.meta.url));
const clientBuildDirectory = path.resolve(sourceDirectory, '../../client/dist');

export function createApp() {
  const app = express();

  app.set('trust proxy', 1);

  // The API serves JSON to a separate origin and embeds nothing, so CSP and
  // COEP would only constrain a surface that doesn't exist here.
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    }),
  );

  // CORS FIRST, because the auth handler below answers its own preflights and
  // sets cookies — a cross-origin sign-in with no `credentials: true` in front
  // of it succeeds on the server and silently drops the cookie in the browser.
  // In dev the Vite proxy makes requests same-origin, so this is a no-op there.
  // It matters when the client is deployed to a different host.
  app.use(cors({ origin: env.CLIENT_ORIGIN, credentials: true }));

  /**
   * BETTER AUTH MOUNTS BEFORE `express.json()`, AND THE ORDER IS NOT A STYLE
   * CHOICE. `toNodeHandler` reads the raw request stream itself; a body parser
   * in front of it has already consumed that stream, so every sign-in arrives
   * with an empty body and fails as bad credentials — which looks like a wrong
   * password rather than a middleware ordering bug.
   *
   * It also sits ahead of `mongoSanitize`, which rewrites keys containing `$`
   * and `.`: Better Auth's own payloads are its business, and a sanitiser
   * reaching into them can only corrupt them.
   *
   * `/api/auth/*` is the Express 4 wildcard. On Express 5 this must become
   * `/api/auth/*splat` or it matches nothing.
   *
   * The instance is built here rather than at import time because it borrows
   * the mongoose connection, which `index.js` opens before calling createApp().
   */
  app.all('/api/auth/*', authLimiter, toNodeHandler(createAuth()));

  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  // Strips $ and . from keys so a payload like { "email": { "$ne": null } }
  // cannot reach a Mongoose query as an operator.
  app.use(mongoSanitize({ replaceWith: '_' }));

  if (env.NODE_ENV !== 'test') {
    app.use(morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev'));
  }

  app.use('/api', routes);

  /**
   * Render runs the built Vite client and API as one persistent web service.
   * Keep this production-only: Vite owns the client in development, including
   * hot reload and its `/api` proxy. API misses stay JSON rather than falling
   * through to the React document, which would turn an API typo into a 200.
   */
  if (env.NODE_ENV === 'production' && existsSync(clientBuildDirectory)) {
    app.use('/api', notFoundHandler);
    app.use(express.static(clientBuildDirectory, { index: false }));
    app.get('*', (req, res) => {
      res.sendFile(path.join(clientBuildDirectory, 'index.html'));
    });
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
