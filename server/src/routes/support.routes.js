import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { chatConfigFor } from '../services/support.service.js';

const router = Router();

/**
 * What the browser needs to boot the chat widget, for the person asking.
 *
 * `requireAuth` IS THE "SIGNED-IN ONLY" RULE, not a check in the component.
 * A client-side condition decides what renders; this decides what exists. An
 * anonymous visitor gets a 401 and the widget never loads, whatever the front
 * end does — and the footer's support address is still there for them.
 *
 * It is a GET with no side effects, so it caches and replays harmlessly, and
 * it deliberately returns the visitor block already assembled: the alternative
 * is the client posting its own idea of who it is, which is precisely what the
 * signature exists to stop.
 */
router.get('/chat', requireAuth, (req, res) => {
  // The interface language is the browser's business, not the session's — the
  // switcher writes to localStorage and never tells the server. It rides in as
  // a query param so the operator still sees it.
  const language = String(req.query.lang ?? '').slice(0, 8);
  res.json(chatConfigFor(req.user, language));
});

export default router;
