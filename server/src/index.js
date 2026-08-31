import { env } from './config/env.js';
import { connectDb, disconnectDb, isEphemeral } from './config/db.js';
import { createApp } from './app.js';
import { User } from './models/User.js';
import { runSeed } from './seed/seed.js';
import {
  startQuoteRefresh,
  stopQuoteRefresh,
  startTickFlush,
  stopTickFlush,
} from './market/refreshJob.js';
import { liveFeed } from './market/liveFeed.js';

/**
 * The in-memory database starts empty and dies with the process, so a separate
 * `npm run seed` would seed its own throwaway instance. Seed in-process instead
 * whenever we're ephemeral and empty — that's what makes `npm run dev` alone
 * enough to get a fully populated app.
 */
async function autoSeedIfNeeded() {
  if ((await User.estimatedDocumentCount()) > 0) return;

  console.log('  Database is empty — seeding initial markets and demo fixtures…\n');
  await runSeed({ fresh: false });
}

async function main() {
  console.log('\nHyperStocks API starting…');

  await connectDb();
  await autoSeedIfNeeded();

  // After the seed, never before: the job writes onto Stock documents that the
  // seed is still creating on a cold ephemeral boot.
  const quotesLive = startQuoteRefresh();
  console.log(
    quotesLive
      ? `  Live quotes: NYSE + NASDAQ every ${env.QUOTE_FULL_REFRESH_MS / 1000}s`
      : '  Live quotes: off (no FINNHUB_API_KEY) — prices stay as seeded',
  );

  // Real-time ticks over one Finnhub socket, fanned out to browsers by SSE.
  // The REST job above stays: it is what covers the venues the socket cannot
  // reach and what fills prices in before the first trade of a session prints.
  if (liveFeed.start()) {
    startTickFlush();
    console.log('  Live ticks:  Finnhub socket → /api/market/stream');
  }

  const app = createApp();
  const server = app.listen(env.PORT, () => {
    console.log(`  Listening on http://localhost:${env.PORT} (${env.NODE_ENV})\n`);
  });

  const shutdown = async (signal) => {
    console.log(`\n${signal} received, shutting down…`);
    server.close();
    stopQuoteRefresh();
    stopTickFlush();
    liveFeed.stop();
    await disconnectDb();
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('Failed to start:', err);
  process.exit(1);
});
