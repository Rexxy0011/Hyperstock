import { Router } from 'express';
import marketRoutes from './market.routes.js';
import leaderboardRoutes from './leaderboard.routes.js';
import portfolioRoutes from './portfolio.routes.js';
import watchlistRoutes from './watchlist.routes.js';
import orderRoutes from './orders.routes.js';
import walletRoutes from './wallet.routes.js';
import depositRoutes, { adminDepositRouter } from './deposits.routes.js';
import withdrawalRoutes, { adminWithdrawalRouter } from './withdrawals.routes.js';
import newsRoutes, { announcementRouter } from './news.routes.js';
import adminRoutes from './admin.routes.js';
import subscriberRoutes from './subscribers.routes.js';
import { optionalAuth } from '../middleware/requireAuth.js';

const router = Router();

router.get('/health', (req, res) => {
  res.json({ ok: true, service: 'hyperstocks-api', time: new Date().toISOString() });
});

/* `/auth` is NOT mounted here. Better Auth owns it, and its handler is mounted
   in app.js AHEAD of `express.json()` — a body parser in front of it consumes
   the request stream and every sign-in arrives empty. See the note there. */
router.use('/market', marketRoutes);
router.use('/portfolio', portfolioRoutes);
// Its own resource rather than /portfolio/watchlist: it now spans all three
// asset classes and is driven from /markets, where no portfolio is involved.
router.use('/watchlist', watchlistRoutes);
router.use('/orders', orderRoutes);
// Adding virtual capital. Under /wallet rather than /portfolio: a top-up is a
// funding event, not a position, and the screen driving it is the balance pill.
router.use('/wallet', walletRoutes);
// Deposits are their own resource, not a verb on the wallet: one is a
// long-lived object with a state machine and an audit trail, the other is a
// balance. The admin queue is mounted separately so it carries requireAdmin at
// the router rather than per handler.
router.use('/deposits', depositRoutes);
router.use('/admin/deposits', adminDepositRouter);
router.use('/withdrawals', withdrawalRoutes);
router.use('/admin/withdrawals', adminWithdrawalRouter);
// Public: the News page is reachable signed out, like /markets.
router.use('/news', newsRoutes);
router.use('/announcements', announcementRouter);
// Optional auth: anonymous callers get the public board, signed-in callers
// additionally get their own pinned row.
router.use('/leaderboard', optionalAuth, leaderboardRoutes);
// Public and unauthenticated: it backs the landing page's call to action, which
// runs before anyone has an account. Rate-limited at its own router.
router.use('/subscribers', subscriberRoutes);
// Curating the board. Mounted under /admin like the other two queues, and
// guarded at its own router rather than here, so the guard travels with the
// routes if this line ever moves.
router.use('/admin', adminRoutes);

export default router;
