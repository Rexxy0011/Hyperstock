import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import mongoSanitize from 'express-mongo-sanitize';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import { env } from './config/env.js';
import routes from './routes/index.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';

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

  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  // Strips $ and . from keys so a payload like { "email": { "$ne": null } }
  // cannot reach a Mongoose query as an operator.
  app.use(mongoSanitize({ replaceWith: '_' }));

  // In dev the Vite proxy makes requests same-origin, so CORS is a no-op there.
  // It matters when the client is deployed to a different host.
  app.use(cors({ origin: env.CLIENT_ORIGIN, credentials: true }));

  if (env.NODE_ENV !== 'test') {
    app.use(morgan(env.NODE_ENV === 'production' ? 'combined' : 'dev'));
  }

  app.use('/api', routes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
