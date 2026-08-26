# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

HyperStocks — a simulated stock-trading platform. Real market prices, virtual capital. npm-workspaces
monorepo: `server/` (Express + Mongoose, ESM) and `client/` (React 19 + Vite + Tailwind v4). JavaScript
throughout, no TypeScript.

## Commands

```bash
npm run dev          # both: API on :4000, Vite on :5173 (Vite proxies /api)
npm run seed         # seed a connected database (upsert, idempotent)
npm run seed:fresh   # drop collections first
npm test             # server tests (node:test)
npm run build        # client production build
```

Single test: `cd server && node --test --env-file-if-exists=.env test/seed.test.js`

```bash
npm run check       # lint + typecheck + test — run this after every change
npm run lint        # eslint . (flat config, react + hooks on client)
npm run typecheck   # tsc --noEmit; checkJs over the JS, no TypeScript conversion
```

`npm run check` must pass before a change is considered done. Type checking runs through
`tsconfig.json` with `checkJs: true` and `noImplicitAny: false` — it catches misspelt properties, wrong
argument counts and bad calls without requiring annotations. Where a type genuinely can't be expressed in
JS (a runtime-chosen element tag, Mongoose's `-1 | 1` sort literals), there is a narrow
`/** @type {any} */` cast with a comment saying why — prefer that over loosening the config.

Two lint rules worth knowing: optional component props need an explicit `= undefined` default or `checkJs`
infers them as required; and `no-console` is an error on the server except in `index.js`, `config/db.js`
and `seed/`, where the output is deliberate operator feedback.

**Conflicting Tailwind utilities passed via `className` lose silently.** Tailwind resolves a conflict by
position in the generated stylesheet, not by order in the attribute, and `.rounded-md` is emitted after
`.rounded-full`. So `<Button className="rounded-full">` renders at 8px with no error anywhere. Variations
on a component's own base utilities belong in the component as props — that is why `Button` has `pill`.

The same rule is why `Button` has **`onDark`**, alongside `Tabs`, `WatchButton`, `PriceChange` and
`TvChart`. Only the light-background variants get a deep-surface counterpart (`secondary`, `ghost`);
`primary` is absent deliberately, since the gain green already reads on ink and a second definition would
be a second owner of it. `onDark` also raises the disabled dimming from 45% to **60%** — 45% is right over
white and wrong over ink, where the label is light on a dark fill and the same dimming pushes it *toward*
the background instead of away from it. Measured on the terminal's disabled Trade button: **4.45:1 → 6.44:1**.
Audited across the app, the instrument terminal is the only surface that puts a light-variant button on a
dark background; Landing's and About's all sit on white or mist.

`npm run market:probe` is wired in `server/package.json` but `src/market/probe.js` does not exist yet —
it lands with the live market-data provider.

## Database: local and persistent, or ephemeral

`MONGODB_URI` blank means `config/db.js` starts an **in-memory MongoDB replica set** and `src/index.js`
**auto-seeds it on boot** when empty. That is still the zero-config path, and what the tests use.

**A local persistent instance is configured now**, via `scripts/mongo.sh`:

```bash
npm run db        # start   (also db:stop / db:status / db:logs)
```

It needs no install: it reuses the mongod binary **mongodb-memory-server has already downloaded** to
`~/.cache/mongodb-binaries`, so there is no Homebrew package, no Docker image and no Atlas account. Data
lives in `.data/mongodb`, bound to `127.0.0.1` with no auth — local development only.

**Why it is worth having.** On the ephemeral path every nodemon reload throws the database away and
re-seeds: measured, **~15s of API downtime per server file save**. Vite stays up the whole time but
proxies `/api` to a dead port, so the browser looks broken and Vite gets the blame. With persistence the
same restart is **1s**, because the seed only runs when the database is empty.

Two consequences of persistence:

- **It no longer seeds itself.** `autoSeedIfNeeded()` returns early unless `isEphemeral()`, so a fresh
  database needs `npm run seed` once. `npm run seed:fresh` wipes and rebuilds.
- **`npm run seed` in another terminal now hits the same database** the API is using. On the ephemeral
  path it seeded its own throwaway instance and the running API never saw it.

**`npm test` MUST NOT reach it, and this already went wrong once.** `test/seed.test.js` calls
`runSeed({ fresh: true })`, which drops every collection. The test script reads the same `server/.env` as
the dev server, so the moment `MONGODB_URI` was set, `npm run check` **wiped the development database** —
209 users and 52 stocks gone, and the only visible symptom was a login that suddenly returned
`BAD_CREDENTIALS`. Two guards now:

- `server/package.json`'s test script sets `MONGODB_URI=` inline — **and `DEPOSIT_DESTINATIONS=[]`
  alongside it, which is the same trap a second time.** The moment a real deposit destination was
  configured locally, `deposit.test.js`'s "refused when nothing is configured" case started passing for
  the wrong reason, and the suite was asserting against one machine's environment. Anything the tests
  need to control must be forced here, not assumed absent. The same rule caught a third case: quoting a
  deposit needs an asset price, which left alone was a live **CoinGecko call inside the test suite** —
  measured at ~800ms against an endpoint that 429s after a handful of requests. `deposit.test.js` primes
  the market cache instead, which also makes the quote assertable in a way a moving rate never could be. A variable set on the command line
  **wins** over `--env-file` (verified), and an empty one is falsy, so `connectDb()` takes the in-memory
  path regardless of what `.env` says.
- `seed.test.js` asserts `isEphemeral()` before it drops anything. That does not depend on shell syntax,
  so invoking `node --test` directly fails loudly instead of destroying data.

A replica set (not standalone) is used deliberately so multi-document transactions work — order execution
depends on them. `connectDb()` probes support at boot and logs the result; `withTransaction()` degrades
gracefully when absent. `MONGODB_URI` also accepts an Atlas M0 string.

## Money: integer cents, and two prices

**Every monetary value is an integer number of cents, never a float** (AGENTS.md mandates this). Fields
carry a `Cents` suffix so the unit is unmissable at a call site: `cashBalanceCents`, `priceUsdCents`,
`amountCents`, `costBasisCents`. "Cents" means major unit × 100 uniformly, including JPY — display applies
each currency's own decimal convention. Percentages are not money and stay plain numbers.

The client's `money()` in `lib/format.js` takes cents and is the only place `/100` happens.

**Positions store `costBasisCents`, not an average.** Average cost is a derived virtual
(`costBasisCents / shares`) — storing the average would round on every partial buy and drift the book value
away from what was actually paid.

Every `Stock` carries `priceCents` (native currency, display only) and `priceUsdCents` (USD, all
arithmetic). Portfolio values, order totals and leaderboard ranking must use `priceUsdCents`. Mixing yen
into a dollar total is the most expensive bug available here.

`lib/money.js` also normalises minor units: **`GBp` is pence** — LSE quotes arrive as `11606` meaning
£116.06. Skip the ÷100 and every LSE holding is overvalued 100×.

`test/seed.test.js` asserts both: that the portfolio reconciles to exactly `1_222_064` cents (integer
equality, no epsilon — that's the point), and that no persisted money field anywhere is a non-integer.

## Design is a Claude Design project, not this repo

The 9 screens and the design system live in Claude Design project
`9641f056-b41b-4506-816c-4fd30785f2fa`, read via the `DesignSync` tool (`method: "get_file"`).
`docs/legacy-landing/` is a static HTML/CSS port of the original `Landing.dc.html`, kept as a visual-diff
reference — not shipped, not imported.

**The design's own mock data is internally inconsistent.** Where figures conflict, `seed/seed.js`
documents which one is honoured and why (header comment). Two that matter: the Portfolio mockup's holdings
sum to $11,142.78 but its headline says $12,220.64 (we honour the headline, cash absorbs the remainder);
and "5 positions / 4 exchanges" was false in the mockup (we seed 5 positions genuinely spanning 4).

### Seed invariants the tests pin

`jd_trader` is the account every mockup depicts. `test/seed.test.js` asserts **portfolio value exactly
$12,220.64** and **leaderboard rank exactly 128**. Changing stock anchor prices, `JD_HOLDINGS`, or the
synthetic-user counts will break those; update the fixtures together.

Demo accounts: `jd@hyperstocks.app` and `admin@hyperstocks.app`, password `password123`.

## Server architecture

Routes are thin; logic lives in `services/`. Errors use `ApiError` and surface as
`{ error: { code, message, details? } }` — clients switch on `code`.

**Leaderboard** (`services/leaderboard.service.js`) starts its aggregation from `User`, not `Holding` —
starting from holdings silently drops cash-only traders off the board. Weekly and monthly returns are
*mathematically impossible* from current state alone, so `PortfolioSnapshot` is load-bearing: the seed
backfills 90 daily marks per user, and the same series feeds the performance chart. Results are memoised
60s per period; call `invalidateLeaderboard()` after a fill.

**RANK IS ALWAYS BY CURRENT PORTFOLIO VALUE — the period tabs do not re-rank.** `$setWindowFields` sorts on
`portfolioValueCents` whatever the period; Weekly/Monthly/All-time only change the `returnPct` *column*.
Measured: the order is byte-identical across all three, so on two of them the trader ranked first shows a
lower return than the one below. Landing compounds it — its panel is titled "Top investors this month",
requests `period=monthly`, then renders value and *today's* move, so the parameter changes nothing on
screen. Both are still true.

**The board's history is seeded and nothing extends it.** Only `seed.js` writes `PortfolioSnapshot`, so
"yesterday's mark" was computed from *seeded* prices while today's value uses live ones — the difference is
a one-time step, not a day of trading. Measured: trader_022's snapshot $27,747.99 against a live $58,787.74
is a **+111.86% "day" change**, while traders holding only Tokyo or Euronext read exactly 0.00% because
nothing quotes their venues. It also decays: 90 days after a seed the 30-day baseline falls off the end of
the series and every return silently becomes "value vs `SEED_CASH_CENTS`".

**None of the seeded traders ever traded.** 209 accounts written in one second; **24 order documents exist
in the whole database**, all jd_trader's. `tradeCount` is a display field — `rngInt(rng, 1, 900)` for the
synthetic ones, the mockup's figure for the named ones — so Denise Coates shows 482 trades against one
holding and zero orders. It is a running tally on a real account (`order.service.js` `$inc`s it per fill)
that starts from a fiction: jd_trader seeds at 38 and reads 54 against 24 orders. Nothing reconciles them.

**The seeded rank order does not survive live prices.** The seed back-solves 127 accounts above jd_trader to
put him at exactly 128, but synthetic accounts seeded into a band capped at $27,900 now lead the board at
$58,788 because they hold NASDAQ, while the hand-placed named traders sit frozen at their design figures on
venues no vendor quotes. jd_trader currently ranks **92, not 128**. The tests still pin 128 because they
never boot `index.js` and so never start the quote job — that separation is what keeps the pinned figure
reproducible while the running app drifts.

#### Featured traders — the operator's lever on the board

`models/FeaturedTrader.js`, `services/featuredTrader.service.js`, `/api/admin/featured-traders`, and
`pages/Admin.jsx` at `/admin/featured-traders` — **the first admin screen in the product**. An admin writes
a name, a value and a percentage, and the row takes its place on the leaderboard.

**It is merged, not pinned, and that is the design.** A curated row is ranked against the live board on the
figure that was typed, exactly like every other row — type a big number and it leads, type a small one and
it sits mid-table. A pin would put a $900 account above a $58,000 one and the board would visibly
contradict its own ordering. The admin form previews where a figure would land for that reason.

**A row carrying `userId` REPLACES that account rather than sitting beside it**, and the pinned `you` row is
suppressed for an overridden trader. One account at two different values in one list is the single outcome
that reads as a bug rather than as curation. Unique partial index over `userId`, so two admins overriding
the same account race in the index instead of both succeeding.

**The percentage owns the cash figure.** `dayChangeCents` is derived as `value − value/(1 + pct/100)`, never
typed — two independently entered numbers on one row is precisely how a value and its own percentage come
to disagree, which this project already shipped once on the ticker tape.

**Merged after the memo, before the slice.** After, because the 60s memo covers the aggregation over real
accounts and an admin edit must show on the next poll rather than a minute later — the collection is tiny
and indexed, so a per-request read beats invalidating a 208-row pipeline on every keystroke. Before,
because the slice and the `you` row both depend on final position.

**Nothing here moves money.** No balance, no ledger entry, no holding; a test asserts an overridden user's
cash and `tradeCount` are untouched. Curated rows are **visually identical** to computed ones by explicit
decision — the payload still carries `featured: true`, so labelling them is a UI change and not a schema
one. Landing's existing "Names are illustrative and the figures are not real portfolios" line is the only
disclosure on that surface.

Both leaderboard surfaces now key their lists on `userId`, not `username`: a curated name is free text and
may collide with a real trader's, and two rows sharing a React key silently drop one.

### The user admin — `/admin/users`

`services/adminUser.service.js`, `GET /api/admin/users`, `PATCH /api/admin/users/:id/status`,
`pages/Users.jsx`. It exists because Better Auth moved credentials out of the user document.

**THE COLUMN THE SCREEN EXISTS FOR IS "SIGN-IN".** A credential is a row in `accounts` now, so 209 user
documents look identical and **two of them hold a password**. Which rows are real accounts and which are
leaderboard fixtures was visible nowhere in the product. The header says it in one line: *Accounts 209 ·
Can sign in 2 · No credential 207*. `canSignIn` is computed by joining `accounts` on every read, never
stored — a stored flag needs a writer on the signup path, the credential-migration path and the deletion
path, and one of the three would eventually be forgotten. Same reasoning `subscriber.service.js` gives for
`converted`.

**A fixture's missing credential is `neutral`, not a loss red.** Having no password is the *correct* state
for 207 of these rows, not a fault, and red is what this palette uses for a loss and a rejection.

**The search term is escaped, not interpolated.** `{ $regex: term }` with `.*` returns every row — a search
box that dumps the table — and `(a+)+$` is a way to hang the process. `literal()` escapes the regex
metacharacters; a test asserts `.*` and `^jd` match **0** while `jd_` still matches 1.

**One query per page, not one per row.** Twenty-five sequential `findOne`s against `accounts` is the shape
that looks free on a seeded database and is not — the same note `/admin/queues` carries about counting with
`.length`.

**ROLE IS DELIBERATELY NOT EDITABLE.** Granting `admin` from a table row is a privilege escalation one
misclick wide and, unlike a suspension, invisible to the person it happened to. Status is the only write.

**An admin cannot change their own status, and the button is HIDDEN rather than disabled on that row.**
With one administrator — which is what this database has — suspending yourself removes the only account
that could undo it and the recovery is a database edit. The server refuses it independently
(`SELF_STATUS_CHANGE`); a control that exists only to reject you is worse than no control.

**Suspending deletes the account's sessions.** `requireAuth` already refuses `Suspended` on the next
request, so the block is immediate either way — but leaving the rows means the account is refused while its
session sits there valid, which is two answers to "is this person signed in". The response returns
`sessionsRevoked` because suspending somebody who is signed in *right now* is a different event from
suspending a dormant account, and nothing else on screen would say so.

`test/adminUser.test.js` pins all of it, including that the listing never carries `passwordHash`,
`password`, `token` or `unsubscribeToken`, that paging covers every account exactly once, and that a status
change moves no money.

### The approvals dashboard

`/admin/approvals` (`pages/Approvals.jsx`) drives the three review queues that had complete APIs and no
operator: `/api/admin/deposits`, `/api/admin/withdrawals` and `/api/wallet/admin/topups`. No endpoint
changed shape to make the screen work — what changed is what they return about the requester.

**NONE OF THE THREE LISTINGS SAID WHOSE MONEY IT WAS.** `publicDeposit`, `publicWithdrawal` and
`publicRequest` were written for the person who owns the row, so none carried an account — correct on a
user's own screen, and unusable as a queue: **approving a deposit credits a specific account, and the
operator could not see which.** All three `list*` functions now take `admin` and `populate()` the user;
`services/adminQueue.service.js` owns `traderOf()`, so exactly one place decides that a queue may see a
username and an email and may not see a balance. A user's own listing is unchanged and carries no `trader`
at all — a test asserts both directions.

**`GET /api/admin/queues` is three `countDocuments`, not three listings measured with `.length`.** The
statuses counted are the ones **waiting on an operator**, which is not the same as unfinished: an
`awaiting_payment` deposit is waiting on the depositor and would pad a queue nobody can act on. A *claimed*
withdrawal is counted, because a row someone started and abandoned is still outstanding work — and the
trader's cash is already debited while it sits there.

**Claim before confirm is enforced twice.** `requested` offers only Claim in the UI, and the server refuses
an unclaimed approval independently — measured live: `422 BAD_TRANSITION`. Approving without a `txHash` is
`400`, rejecting without a reason is `400`, an unknown reference is `404`. The UI hiding a button is a
convenience; the compare-and-set in `withdrawal.service.js` is the guard.

**`statusVariant()` gained the lower-case machine states.** The deposit and withdrawal machines are
snake-cased and were falling through to `neutral`, so every row in the queue rendered the same grey. It
belongs in that map rather than a second one in the admin screen — it is the single owner of status→colour.

Verified live end to end: approving a $5,000 top-up moved jd_trader's buying power **$1,189.66 →
$6,189.66**, dropped the queue badge 3 → 2, and a replayed approval returned **409 `ALREADY_REVIEWED`**
with the balance unmoved.

### The marketing CTA — a newsletter subscription, and why it is not EmailJS or a form backend

`POST /api/subscribers` (`models/Subscriber.js`, `services/subscriber.service.js`), listed at
`/admin/subscribers`. Landing's closing CTA used to collect nothing: it handed the address to `/auth` as a
query param, with a comment saying a field that silently swallows an address is worse than none.

**EmailJS was rejected on a specific ground, not a vague one.** Its service id, template id and public key
all ship in the JS bundle, so anyone can lift them and send through the account's own template and quota —
the domain allowlist is an `Origin` check and `curl` does not send one. It also keeps no record, so a
failed send is a lost enquiry. Basin is the better of the two (the public endpoint is its design, and it
stores submissions), but both put the addresses somewhere this product cannot read them. That is the right
trade for a static site. There is an Express API, a Mongo instance and an admin shell here, so the endpoint
is forty lines and the address lands somewhere the admin can count against registrations.

**Not a `User`.** Someone who left an address has no balance and cannot sign in; putting them in `User`
breaks every count that assumes a user is a trader, the leaderboard's `$match: { role: 'user' }` included.

**Upsert, not find-then-create** — a double-tapped button is two racing requests that would both find
nothing, both insert, and one die on the unique index with a 500 for a form that worked. `$setOnInsert` on
`source`, so the FIRST call to action keeps the credit rather than every conversion being reattributed to
whichever page somebody visited last.

**The response is identical whether or not the address is already known.** `{ ok: true }` either way:
returning "already subscribed" makes an unauthenticated endpoint into an oracle for whether an address is
on this platform. `created` is returned by the *service* for the server's own counting and deliberately
dropped by the *route*. It is also the only public POST in the API that writes a row, so it is
rate-limited — 10/hour, against the auth limiter's 20/15min.

**IT IS A SUBSCRIPTION, NOT A SIGNUP FUNNEL, and that changed the mechanics as well as the label.** It used
to fire the capture and navigate to `/auth` regardless of the outcome — correct when the button said Get
Started and the address was a convenience being carried across. A **Subscribe** button that navigates
somewhere else has not done what it said, and a failure it never mentions leaves somebody believing they
are on a list they are not on. So the request is awaited, the mutation is no longer `silent`, and the form
is REPLACED IN PLACE by a confirmation rather than reset to an empty field — which is indistinguishable
from a submit that did nothing, and invites the same address a second time.

**A list you cannot leave is not a newsletter list.** Every row carries an `unsubscribeToken` from
insertion. Keyed on a **token, never the email**: an endpoint that unsubscribes whatever address it is
handed lets anyone remove anyone, and confirms whether an address is on the list — the same oracle the
subscribe endpoint goes out of its way not to be. Unknown token, already-unsubscribed and success all
return `{ ok: true }`, and the filter carries `unsubscribedAt: null` so a second click on an old mail
cannot move the date the first one recorded.

**Re-subscribing must `$set` the field, not `$setOnInsert` it.** Someone who left and later fills the form
again is giving consent a second time; leaving `unsubscribedAt` in place would drop that submission on the
floor while showing them a confirmation for it.

**`config/db.js` backfills tokens at boot** — a Mongoose `required` does not apply to documents already
stored, the same lesson `assetClass` taught on `Holding`, and here the failure is quieter: a row written
before the field existed has no token, so **that address can never leave the list**, which is precisely the
liability the token exists to prevent. Measured on the dev database: 2 rows backfilled.

**NOTHING SENDS ANYTHING.** There is no SMTP client, no transport and no template anywhere in this
repository — the list is captured and stored, and that is all. The copy is written to that limit: the
confirmation reads "You are subscribed", not "check your inbox for a confirmation", because no confirmation
is coming.

**The consent line under the Subscribe button was removed by request** — unsubscribing happens from the
emails themselves. `POST /api/subscribers/unsubscribe` and the per-row token are untouched and still
tested; what went is the sentence, not the mechanism. **The link that sentence promised has to be printed
in every email when a sender is built** — with the note gone, this file is now the only place that records
the obligation.

### Toasts — `react-hot-toast`, one owner

`lib/toast.js` is the only module that imports the library, for the reason `PriceChange` owns the signed
percentage: two call sites picking durations disagree, and on a notification an inconsistency reads as a
product bug. Errors dwell 6s against a success's 3s. `Toasts` mounts in `Root`, not a layout — a toast
raised on one route must survive navigating to another, and remounting the container dismisses it mid-read.

**Bottom right is a constraint, not taste.** Top-centre and top-right both cover the sticky nav, which
carries the balance pill and the account menu — so the toast people most want gone sits over the control
they were reaching for.

**The global handler is on the QUERY CACHE, not the axios interceptor.** The interceptor sees every 401 the
single-flight refresh is in the middle of handling — the dashboard fires several queries on mount and each
401s before the token rotates — so a toast there fires repeatedly on an ordinary page load. 401 is excluded
at the other end too: an anonymous visitor's boot-time refresh returns one, and that is the expected answer
to "am I signed in". A component rendering its own inline message opts out with `meta: { silent: true }`.

**Two defects the toast work exposed, both fixed:**

- **Axios's "Network Error" was reaching users verbatim** — untranslated, capitalised like a class name,
  describing the transport rather than what to do. A response-less failure now carries
  `code: 'NETWORK_ERROR'`, so it travels the same path as every server error and the code *is* the
  translation key.
- **A failed query rendered the EMPTY STATE.** Measured by blocking `/api/admin/subscribers` at the network
  layer: the table read *"No addresses captured yet"* over a request that never returned — a server being
  down is indistinguishable from an account with nothing in it. `isError` now renders its own row with a
  retry, which a toast cannot offer. The same conflation exists on other tables and is not yet fixed.

**`MarketNotices` renders nothing and fires on the TRANSITION, never the state.** A component that toasts
because the market is closed fires on every poll and every route change. The first reading only seeds the
refs: loading a page during a closed market is the situation, not news. `/api/market/status` gained a
`session` so one endpoint answers both "has the session changed" and "is the feed alive". A dropped feed is
worth interrupting for because nothing else on screen distinguishes "this price has not moved" from "this
price can no longer move" — the failure that had the socket dark for 83 minutes.

Toast ids are used on the repeatable notices (`market-feed`, `market-session`, `admin-queue`), so a socket
that flaps replaces its own notice in place instead of stacking a column of them.

**`Exchange.code` must not be uppercased.** `Stock.exchange` stores the design's casing (`Euronext`), so
forcing `EURONEXT` silently breaks every join between the two collections. There is a comment on the field.

**Candles are simulated.** `market/mockCandles.js` is a deterministic seeded walk, generated *backwards*
from the live price so the series always terminates at the real quote. Invariant: `points × stepMs` must
equal the span the range label claims — a "1W" that actually covers 3 days makes the x-axis repeat dates.
Responses carry `simulated: true`, which the UI surfaces.

### Markets — three asset classes, three unrelated providers

`/markets` has Stocks / Crypto / Forex tabs served by `services/market.service.js`. They are not
interchangeable and the page says so per tab rather than with one vague line:

| tab | provider | key | resolution |
|---|---|---|---|
| stocks | seeded rows + Finnhub `/quote` merged over the US subset | yes | live on NYSE/NASDAQ only |
| crypto | CoinGecko `/coins/markets` — 50 rows, one call, with logos | no | live |
| forex | Frankfurter (ECB reference rates) | no | **daily, not a tick** |

**Live equity quotes gate on the VENUE, never the ticker.** The first version tested ticker shape — no
dot, therefore US — and Finnhub resolves a bare ticker against US listings, so `AIR` returned AAR Corp's
NYSE price and wrote it onto the row labelled "Airbus · Euronext"; `ALV` returned Autoliv onto
"Allianz · XETRA". ASML, AZN and SAP are the subtler form: right company, but the US ADR, a different
listing at a different price from the line the row names. Finnhub 403s all six non-US exchanges anyway, so
those rows keep their seeded price and carry `live: false`, which the table renders as a **Delayed** badge.

**Company logos come from the ticker, not from a vendor.** Finnhub's `logo` field is on `/stock/profile2`,
which is 403 on this tier, so `market.service.js` builds a parqet URL from the symbol (`logoFor`, exported
so `portfolio.service.js` uses the same builder rather than a second one). Coverage measured across every
seeded symbol: 30 of 34, including the European ADR tickers. The rewrite `.` → `-` is what turns BRK.B into
the BRK-B that exists. Misses need no handling — `AssetMark` falls back to the monogram on the image's own
error event.

**`components/market/AssetMark.jsx` is the single owner of that fallback, and there used to be four of it.**
`Markets`, `Instrument` and `InstrumentSidebar` each had a private `Mark`, and they disagreed: the
sidebar's branched on `logoUrl` being *present* with no `onError` at all, so a URL that 404s left a broken
image rather than initials — a present URL and a working one are not the same thing. Portfolio had no mark
component whatsoever. Its holdings table, position cards, position header and watchlist called
`monogram()` directly, and **`portfolio.service.js` never returned `logoUrl` in the first place**, so the
one screen a signed-in user spends the most time on rendered grey initials for companies whose logos were
already loading two screens over. Positions carry it now on all four resolution paths, including
`atCostBasis` — an equity mark is built from the ticker, so it survives the `Stock` document going missing,
which is the case that lands there.

The `tone` prop exists because the mark renders on both surfaces: `deep` is the terminal's ink panel, where
a solid ink chip vanishes into what it sits on. It also picks the **loading tint** — `loading="lazy"` means
the box exists before the bytes do, and a flat `bg-mist` placeholder is invisible on the light pages but a
light flash on the ink panel.

Verified live: 18 marks on /portfolio, 102 on /markets, 6 on the terminal, **0 broken** on any of them.
Toyota (`7203`, TSE) and Tencent (`0700`, HKEX) have no parqet coverage and fall to monograms — `TM` and
`TH`, which is `lib/monogram.js` doing the job it exists for rather than two identical `70`/`72` chips.

**Sort the equity table AFTER converting market cap, never in the Mongo query.** This bug shipped twice
from the same root. `Stock.marketCap` is native currency, so `.sort({ marketCap: -1 })` ranks by the size
of the *number*: Toyota's `4.8e13` yen sorts above Apple's `3.54e12` dollars, and a table captioned "top
stocks" opened on four Tokyo listings before reaching Apple. Rows are loaded unsorted and ordered in JS on
the converted figure.

**`Stock.marketCap` is stored in the stock's OWN currency.** Toyota's is `4.8e13` — ¥48 trillion. Printed
under a dollar sign it read $48T, overstating it ~150× and making the only column anyone would sort by
meaningless. `market.service.js` converts with `priceUsdCents / priceCents`, which is that stock's FX rate
already; it uses the SEEDED pair, because a live quote replaces `priceUsdCents` alone and would otherwise
drift the implied rate every tick.

Forex bypasses `money()` entirely — USDJPY at 158.70 is a rate, not a price, and cents would round the
move away. It also skips the 15s poll: ECB publishes once a business day.

**The table's sortable columns are the same trap a third time.** Clicking *Price* sorts on
`priceUsdCents`, never `priceCents` — the native figure ranks ¥2,940 above $214 and calls Toyota the
dearer share. The user-facing sort also *defaults to no column at all*: `sort.key === null` means the
server's order, because that order is ranked on converted market cap and is not reproducible client-side.
A third click on the active column returns to it rather than cycling, or the default becomes unreachable
once anything has been sorted.

### The watchlist — one collection, all three classes

`WatchlistItem` (`{userId, assetClass, symbol}`, unique compound index) replaced `User.watchlist:
[String]`, and the array could not survive contact with `/markets`: **a bare symbol does not say what kind
of thing it is.** `ETH` is a coin here and a plausible ticker elsewhere, `EURUSD` is neither, and the old
`POST /portfolio/watchlist` validated against `Stock.findOne()` — so crypto and forex could not be added
at all. Once the entry has to be a pair, the array buys nothing a collection doesn't, and it loses the
unique index that makes a double-tapped plus button a no-op instead of a duplicate row.

It lives at `/api/watchlist`, not under `/portfolio`: following an instrument is not a position in it, and
the screen driving it has no portfolio on it.

**Reads resolve through `market.service.js`, not through Mongo.** Equities have a `Stock` document to join
against; crypto and forex rows exist only in the vendor cache, so the one thing the three classes share is
the shape `getInstruments` already returns. One lookup per *distinct class* — a 40-row equity list is one
call, not forty — and the price on a watched row cannot disagree with the same row one screen over.

**An entry can outlive its instrument**, so `listWatchlist` returns unresolved rows with `resolved: false`
rather than dropping them. A coin that falls out of CoinGecko's top 50 would otherwise vanish from the
list while still existing in the database, leaving the user no way to remove something they can no longer
see. Adds are still validated against the live list, so the placeholder path is only ever reached by
things that *used* to exist.

`WatchButton` is one component for both surfaces. Signed out it renders as a **link to `/auth`**, not a
disabled button — `/markets` is public, and hiding the control would make the feature invisible to exactly
the people worth showing it to. On the list it rests as a green check and swaps to a red minus on hover
or focus, via CSS `group-hover` rather than React state: forty of these render per table, and forty hover
listeners re-rendering rows on mouse movement is the one cost this page cannot pay.

### All three classes are tradable — and cents could not price two of them

`/orders` fills stocks, crypto **and** forex. Getting there was not a flag flip, because the ledger's
price field was exact for exactly one of the three:

| | example | `priceUsdCents` | |
|---|---|---|---|
| stocks | AAPL $310.34 | `31034` | exact — a share is quoted in cents |
| crypto | RAIN $0.01487883 | `1` | **rounds to a cent: 32.8% error on a 10,000-unit order** |
| forex | EURUSD 1.1663 | `11664` | **not cents at all — rate × 10⁴, so a fill is 100× out** |

**So the ledger prices in `priceUsdNanos`** — integer billionths of a dollar, on every market row, computed
at the vendor boundary where the raw quote still exists. BTC at ~$79k is 7.9e13, three orders of magnitude
under 2^53. **Money is still integer cents everywhere it is stored**: nanos are a *price*, never a balance,
and exist so `quantity × price` is rounded to cents **once**, in `costCents()`, instead of inheriting an
error already baked into the unit price. Measured: 1,000 EURUSD costs **$1,166.40**, not $116,640.

**Quantities are fractional for crypto and forex, whole for equities.** The design has no fractional shares
and no venue here sells them — but one BTC is roughly eight times a starting account, so a whole-unit
crypto market is a Trade button that can never fill. `shares` is a float for those classes; it is a *count*,
not money, and `costBasisCents` stays an integer.

**Float dust is a close, not a remainder.** Three buys of 0.1 store `0.30000000000000004`, so selling the
0.3 the screen showed strands 4e-17 of a coin in a row the user can never close. Below `QTY_EPSILON` the
position is deleted and the **whole** basis relieved, so no cost is stranded either.

**The slippage guard compares in nanos too.** In cents, EURUSD rounds to 117 — already 0.32% off, most of
the 0.5% tolerance spent on rounding before the market moves — and a sub-cent coin rounds to the same
integer across a 40% move, so the guard would wave through exactly the drift it exists to catch. The client
sends `quotedPriceUsdNanos`; `quotedPriceUsdCents` is still accepted.

**`Holding` and `Order` are keyed by `{userId, assetClass, symbol}`.** A bare symbol cannot identify an
instrument once there is more than one class — the lesson `WatchlistItem` learned first. The superseded
`{userId, symbol}` unique index is **dropped at boot by `config/db.js`**: Mongoose creates what a schema
declares and never drops what it no longer declares, and left in place that index refuses a legitimate
second position in a symbol that exists in two classes, surfacing as an E11000 on an unrelated buy.

**`MarketPrice` exists because the leaderboard aggregates in-database.** The board's holdings join used
`$unwind: '$s'`, which does not merely fail to value a crypto position — it **deletes it from the
pipeline**, so a trader half in Bitcoin would rank as though that half did not exist. Crypto and forex rows
live only in the market service's in-process cache, which a `$lookup` cannot see, so their prices are
mirrored to Mongo for aggregation only. `$round` on the value keeps an equity landing on exactly
`shares × priceUsdCents`, which is what stops the seeded ranks the tests pin from moving.

**The ticket's displayed price must reconcile with its own total.** Forex at two decimals showed "$1.17"
beside a total struck at 1.1664: 420 units × the displayed figure is $491.40 against the $489.89 charged,
and the arithmetic visibly failed on one small panel. `priceUsd()` takes a per-class decimals override —
the same rule the candle axis already applies.

`test/order.test.js` pins all of it: sub-cent pricing, the forex 100× trap, dust closure, the whole-share
rule, the nanos slippage comparison, and two positions in the same symbol under different classes.

### Deposits — a state machine, a ledger, and a reviewer

`/api/deposits` (`services/deposit.service.js`, `models/Deposit.js`). Built to the architecture in the
brief: create → awaiting_payment → payment_detected → under_review → approved, with expired / cancelled /
rejected as the other terminals.

**A deposit is a first-class row, not wizard state.** It is created BEFORE any address is shown, so a
closed tab, a dropped connection or a session that ends mid-flow loses nothing. `reference`
(`DEP-2026-8F92K1`, Crockford-ish base32 — no I/L/O/U, so it survives being read aloud and typed back) is
the permanent handle, and it is in the URL: `/fund/DEP-2026-8F92K1`. **Creating happens on POST only** —
a `GET` that mints a row leaves a trail of abandoned deposits and the one actually paid into becomes
indistinguishable from the rest.

**The transition table is DATA** (`DEPOSIT_TRANSITIONS`), not `if` statements scattered through the
service, and every move goes through one `transition()` that carries the expected current status **in the
update filter**. A double-clicked Approve matches no document. Two tests assert the shape of the machine
itself: terminals have no exit, and *nothing but `under_review` can reach `approved`* — because anything
else that could would be a path to crediting money without review.

**"I've sent the funds" credits nothing.** It moves the deposit to `payment_detected` and records the hash;
a human verifies. `approve` is the only function in the file that touches the ledger.

**One on-chain payment, one deposit** — a unique partial index over `txHash`. Without it the same hash can
be pasted into two deposits and *both look entirely legitimate in the queue*, because each row is
individually well-formed.

**`LedgerEntry` is the audit record; `cashBalanceCents` is a maintained projection of it.** Signed integer
cents (one column, so a sum over the collection IS the balance), plus `balanceAfterCents` — which is why
the balance moves first and the entry records the result rather than predicting it. Unique on
`{type, reference}`, so a re-post collides; inside a transaction that aborts the balance change with it.
`reconcile()` asserts the two still agree, and that check is the only thing that would catch a code path
moving cash without posting.

**The payment screen quotes an EXACT ASSET AMOUNT, not a dollar figure.** The chain has no idea what
$1,000 is and the reviewer matches on the quantity, so the number given top billing is
`1000.305094 USDT`, with the USD figure and the rate it was struck from underneath. Three things follow:

- **A stablecoin is not a dollar.** USDT quotes at **$0.999695**; assuming 1:1 builds a systematic 0.03%
  error into every deposit, always in the same direction. The rate comes from the same market cache the
  rest of the product reads, and an asset that cannot be priced is refused (`NO_RATE`) rather than quoted
  blind.
- **`rateUsdNanos` is STORED, not re-derived.** It is what the quote was struck at, and it is the reason
  the quote expires. Recomputing at read time would silently change what the user was told to send after
  they had already sent it.
- **Rounding is UP, at the asset's own precision** (`decimals` per destination — 6 for USDT, 8 for BTC).
  Rounding down leaves an underpayment for a reviewer to chase over a decision made here; quoting more
  places than the chain carries produces an amount that cannot be sent exactly, so can never be matched
  exactly.

**Submitting narrates three REAL states.** The server takes the deposit
`awaiting_payment → payment_detected → under_review` on that one call, so the sequence describes something
that actually happens rather than counting down for effect — the distinction matters on a funding screen,
where a bar labelled "verifying on-chain" would be an outright lie, since nothing here reads the chain. The
~6s dwell exists because the transition is otherwise instant, and an instant jump from a form to "Under
review" reads as though the click did nothing. It is a bar per step, not one filling bar: the steps are
discrete states and a continuous bar implies a measured percentage nothing here knows. The overlay covers
the card so the form cannot be edited or resubmitted mid-flight.

**The hourglass HOLDS, flips, holds** (`--animate-hourglass`) rather than spinning — a continuous spin reads
as a generic loader, whereas the pause is what makes it read as time passing, which is what the deposit is
actually waiting on. Both it and `--animate-rise` are switched off under `prefers-reduced-motion`; the
hourglass still communicates without turning, because it is an hourglass.

**The `Steps` rail collapses eight states into three phases** — Payment / Review / Complete. It answers
"is it me or them I am waiting on", which is the question somebody on this screen actually has, and a
failed deposit marks the last phase in loss red so the rail can say *ended here* rather than *completed*.

**The countdown is not decoration** — it is the quote's rate going stale. At zero the client refetches
rather than declaring the deposit dead on its own authority: the server decides, so a drifted clock cannot
tell someone their window closed while it is still open.

**The QR encodes BIP-21 for Bitcoin and a bare address for everything else.** There is no universal URI
scheme for TRC20 or ERC20 tokens, and inventing one yields a QR some wallets silently fail to parse —
worse than one carrying only the address, which every wallet handles. Generated in the browser, since the
address is already on the page, and the address is its `alt` text so nothing is lost when it fails.

**Over- and underpayment is the most common way a crypto deposit goes wrong**, and the reviewer cannot fix
it without hearing from the depositor — so the payment form CAPTURES AN EMAIL rather than telling the user
to send one. The block it replaced asked them to compose a mail to support with their reference in it: a
task, done later, from another application, by somebody who has just been told their money is in limbo.
`Deposit.contactEmail` puts the address on the deposit itself, where the reviewer already is.

It is **pre-filled from the account and still editable** — a field people have to fill is a field people
leave empty, which defeats the point of asking, and the person paying is not always the person who signed
up. **Optional, validated only when present**: requiring it would block a legitimate submission over a
contact detail. Stored trimmed and lower-cased.

`SUPPORT_EMAIL` survives in one place — a **rejected** deposit, which is otherwise a dead end: the money
moved, the deposit did not, and the screen would offer no way to argue with that. The mailto carries the
reference and transaction hash already filled in.

**`components/market/CoinIcon.jsx` resolves a coin or chain to a real brand mark**, in the order
bundled vector → vendor logo → initials. The vector is already in the bundle (`react-icons` is a
dependency this app has anyway) so it paints on the first frame instead of after a CDN round trip, stays
crisp at any size, and cannot 404 — which a vendor URL eventually will. The remote logo stays as the
second step rather than being dropped, because the map covers eleven coins and CoinGecko covers every one
it lists.

**Nothing in it is drawn by hand.** Tron has no mark in `react-icons`, so TRC20 falls through to the Tron
Foundation's own artwork via TRX rather than an approximation of a trademark from memory. A network
resolves to the mark of the CHAIN, not the token — USDT on BEP20 is a Tether balance moving over BNB Smart
Chain, and the row is about the chain — which is why `depositMethods()` attaches each network's
`chainToken` logo alongside the asset's own.

**`ui/Select` is a listbox, not a native `<select>`, and the reason was not cosmetic.** Chrome draws the
native popup with the SYSTEM appearance while `<option>` text inherits the page's `color` — so on a machine
set to dark mode the list rendered dark-on-dark and read as **completely empty**. Nothing about the markup
was wrong; a native select simply cannot be relied on to own both halves of its own contrast. A listbox
owns both, and an option row can then carry a coin logo, a ticker, a name and a hint, which
`<option>` cannot render at all. It keeps what the native control gives for free: `combobox`/`listbox`/
`option` roles with `aria-activedescendant`, arrows/Home/End/Enter/Escape, focus returning to the trigger
on close, click-outside via `pointerdown`, and the active row scrolled into view.

**The picker is two cascading dropdowns — asset, then network** — not a grid of asset/network cards. Twelve
destinations across six assets is already too many cards to scan, and the pairs are not independent: the
networks under Solana are not the networks under Tether. The network list is *derived* from the chosen
asset rather than held in its own state, so a stale selection cannot survive an asset change — the lookup
simply stops matching and the second dropdown falls back to its placeholder. `ui/Select` wraps a native
`<select>` for the reason `Modal` uses `<dialog>`: keyboard type-ahead, the screen-reader role and above
all the mobile OS picker are things no hand-rolled dropdown gets as right.

**`assetGroup` lets one choice span two tickers.** Picking "Bitcoin" offers both the Bitcoin network and
BEP20 — but on BEP20 the thing that actually moves is BTCB. The group is what a person *thinks* they are
sending; every destination keeps its own real ticker, decimals, price symbol and warning, so nothing
downstream has to pretend BTCB is BTC. The option label says `— sends BTCB` for exactly that reason.

**The pending-deposit list is capped at three.** Abandoning a deposit is normal, and an uncapped list
pushes the form the user came for off the bottom of the screen — measured at nine during testing, which is
not a hard number to reach.

**BEP20 forced two things the other networks did not.**

- **USDT on BEP20 carries 18 decimals, not the 6 that TRC20 and ERC20 use.** Same ticker, same apparent
  asset, different precision — which is why `decimals` is per *destination* rather than per asset.
- **"BTC on BEP20" is not Bitcoin.** It is **BTCB**, a BNB Smart Chain token backed by Binance's reserve.
  It is not in CoinGecko's top 50, so pricing it by its own ticker returns nothing and the deposit is
  refused — hence `priceSymbol` on a destination, which quotes BTCB against BTC while the deposit still
  records that BTCB is what was asked for. Labelling it "BTC" would have been the dangerous shortcut: a
  user who sends native Bitcoin to a BEP20 address does not get it back.

That second case is why a destination can carry a **`note`**, stored on the deposit (like the address, so
rotating config cannot rewrite an old warning) and rendered **above the address on the payment screen** and
on the picker — the moment to learn that BTCB is not Bitcoin is before anything has been copied.

**The note is AMBER, not red, and worded as guidance.** Red is the colour this app uses for a loss and a
rejection; borrowing it for a routine "check your wallet" step tells somebody about to deposit that
something has already gone wrong. The fact is unchanged — send on the wrong network and the money really
is gone — but it is framed as a check to make, and the wrapped-asset notes now name the correct
alternative ("If you are sending BTC, choose the Bitcoin network instead") rather than only warning. The
sentence carries the weight; the colour does not need to.

**The hourglass is the project's own artwork** — `assets/brand/deadline.png`, shipped as
`icons/hourglass.webp` (5.8KB against 16KB) following the same PNG-source/webp-build convention as the
Security marks. An icon-font glyph read as belonging to a different app next to them.

**No destination configured means no deposit.** `DEPOSIT_DESTINATIONS` is JSON config, empty by default,
validated at boot — a treasury address in source cannot be rotated without a deploy, leaks into every
clone, and a typo in it sends real funds somewhere unrecoverable. `createDeposit` refuses with
`NO_DESTINATION` and the funding screen says so instead of rendering a form with a blank address in it.

**The two funding paths are named separately on purpose.** `/fund` is a real deposit — payment, reference,
reviewer, ledger entry. **Practice funds** is `wallet.service.js`, which grants simulated capital instantly.
One ambiguous "Add funds" button would leave the user unable to tell which kind of money just arrived,
which is the one thing a funding screen must never be vague about.

**PRACTICE FUNDS HAS NO ENTRY POINT IN THE UI AT ALL ANY MORE.** Its Portfolio header button became
Withdraw — so the two header actions are the two directions real money moves — and the trade ticket's
shortfall path, which was the last place that reached it, now offers only Deposit. `wallet.service.js`,
`/api/wallet`, the admin approve/decline endpoints and `test/wallet.test.js` all still exist and pass;
`components/market/TopUpModal.jsx` is orphaned. Nothing server-side needs changing to restore it — the
funding UI is the only thing that was taken away.

#### Credited money has to arrive somewhere, and three things were in the way

`approveDeposit` → `post()` → `$inc cashBalanceCents`, and `buyingPowerCents` **is** `cashBalanceCents`, so
the server side was always right. The rest of the chain was not.

**The client found out and told nobody.** `Fund.jsx` polls its deposit every 15s until it settles, so the
card flipped to "Deposit complete" on its own — but it invalidated `['deposits']` only. `keys.portfolio` is
one query feeding the nav balance pill, the Buying power card *and* the trade ticket's affordability check,
and `refetchOnWindowFocus` is off globally, so nothing was going to correct it: on `/fund`, which has no
poll of its own, the balance stayed stale until a reload. Measured over CDP with the deposit response
rewritten to `approved` at the network layer (so nothing was credited on the dev database): with the fix,
`/api/portfolio` **26ms** after the status flip; without it, **no portfolio request at all** in the
following 16 seconds. It fires on the *transition*, guarded by a ref — an already-approved deposit left
open would otherwise refetch three queries every 15s forever.

**A deposit was counted as investment return.** `allTimeReturnCents` was `portfolioValueCents −
SEED_CASH_CENTS`, so funding the account $2,500 read as *All-time return +$2,500* on the card directly
beside Buying power, with no trade having happened. The base is now `contributedCapitalCents()` — the grant
plus every `DEPOSIT` and `TOPUP` on the ledger — and `investedCents` ships in the summary so a client never
has to assume the denominator. `ADJUSTMENT` is excluded: nothing posts one yet, and when something does it
will be an operator fixing a mistake, not the user contributing capital. The seeded account has no ledger
entries of either type, so its base stays exactly `SEED_CASH_CENTS` and the pinned figures do not move.

**Top-ups moved cash without posting to the ledger.** `wallet.service.js`'s `credit()` did a bare
`$inc` and wrote only a `Transaction` — the display row. That is *precisely* the code path `reconcile()` is
documented as existing to catch, and it went unnoticed because the test asserting it was named "it writes a
ledger row for the credit" and checked `Transaction`, not `LedgerEntry`. Both are asserted now.

**Both reconciliation tests were tautologies.** They computed `openingCents` as `balance − posted` at check
time, which makes `balanced` true by construction — a credit that skipped the ledger could never have
failed them. The opening balance is now captured before the suite moves anything.

**Still on the same fault, unfixed: the leaderboard.** `baseValueCents` is `SEED_CASH_CENTS` for the
all-time period, so a deposit buys rank the same way it used to buy a return figure. Fixing it means
`$lookup`ing contributed capital per user inside the ranking pipeline, which is a different piece of work
from this one and is not done.

**Still missing, deliberately:** chain monitoring (`POST /api/webhooks/blockchain` or a worker) — until it
exists the user supplies the hash and a human is the only check; the admin *screen* over
`/api/admin/deposits`; and **any withdrawal path at all**, which is the gap that matters most and is
discussed under "Not built yet".

### Top-ups — adding virtual capital

`/api/wallet` (`services/wallet.service.js`). `TopUpRequest` was modelled and seeded from the start but had
**no route and no service**, so nothing could call it.

**Two outcomes, and the threshold is the point.** The model carries a review workflow — Pending / Approved /
Declined, with a seeded admin queue — and that workflow is real. But routing *every* request through it
answers "I cannot afford this trade" with "wait for an administrator to approve some imaginary money".
So at or below `AUTO_TOPUP_LIMIT` ($1,000) the funds land immediately and the request records as Approved
with no reviewer; above it, to `MAX_TOPUP_AMOUNT` ($5,000), it queues. **The response says which happened**
— an unchanged balance on its own is indistinguishable from a failure — and the modal says it *before*
submitting, not after.

**It credits cash, so it gets the order ledger's guards, not lighter ones:**

- **Insert-first idempotency.** The request row is written before any money moves, so a double-tapped
  button collides on the unique partial index over `idempotencyKey` and returns the original.
- **The review guard is the update filter** — `{ _id, status: 'Pending' }`. Two admins approving the same
  row, or a retry racing the original, means the loser matches no document. Without it, approving twice
  credits twice.

**The admin approve/decline endpoints ship even though the admin screen does not.** Without them a Pending
request is a dead end and the queue can only grow. `requireAdmin` finally has a caller.

**The trade ticket offers funding where the shortfall happens.** "Not enough buying power" states a fact
and leaves the user to find another screen and come back. The ticket names the gap — `$1,294.00 short of
$2,482.72` — and offers both funding paths at the exact amount, rounded up to a whole dollar (the exact
figure would leave the account at zero and the next tick would put it short again). Both are native
`<dialog>`s, so the top-up stacks in the top layer over the ticket, which stays mounted with its quantity
intact.

**Deposit is the ONLY funding path offered here.** The button used to open the practice-funds modal
whatever the size of the shortfall, which was a dead end wearing an action: over the $5,000 ceiling
(100 AAPL is $31,034) the user added the most they could and still could not buy. Offering both side by
side fixed the dead end and introduced a worse one — a choice between two kinds of money at the exact
moment somebody is trying to do something else, with the capped option listed first. There is one button
now and it goes to the real deposit flow.

**`TopUpModal.jsx` is consequently orphaned and `/api/wallet` is unreachable from the UI.** The service,
its routes, the admin approve/decline endpoints and `test/wallet.test.js` are all untouched and still pass
— what was removed is the only screen that called them. Practice funds is one import away if it is ever
wanted again; nothing about the server needs to change to bring it back.

**Funding is a PLACE YOU GO, so the order has to survive the journey.** `lib/tradeIntent.js` encodes the
ticket into the URL — `/fund?need=2984500&back=%2Fportfolio%3Ftrade%3Dstocks%3AAAPL%3ABUY%3A100` — because
a funding round trip crosses a route, survives a reload, and can take minutes if the money is a real
deposit, and the URL is the only place that outlives all three. `/fund` renders a banner naming the waiting
order (*Funding to buy 100 AAPL — $29,845.00 short*), prefills the amount from `need`, carries both params
onto the payment screen, and offers **Back to buy 100 AAPL** once the deposit is approved — only then,
since returning earlier lands on a ticket that still cannot afford itself. Portfolio and Instrument both
read `?trade=` on mount, reopen the ticket on the same side and quantity, and **consume the param**, or a
refresh would reopen an order already dealt with. `safeReturnPath()` rejects anything that is not a
same-origin path: `back` comes from the query string, and a funding screen is the worst possible place for
an open redirect.

**Dialogs transition, and until now none of them did.** Every modal appeared and vanished on one frame,
which on the order ticket reads as a navigation rather than a layer opening. The entrance and exit are pure
CSS on the native element: `@starting-style` supplies the before-open state (without it the entrance is
silently skipped while the exit still works), and `transition-behavior: allow-discrete` on `display` and
`overlay` is what lets a `<dialog>` animate **out** at all — both are discrete properties, so without it
the element drops out of the top layer on the first frame and the exit never renders. Measured: entrance
`0 → 0.10 → 0.31 → 0.53`, exit holding `display: block` through `1 → 0.89 → … → 0.01` before going to
`none`. The backdrop transitions **opacity**, not colour, because `Modal` sets its `background-color` with
a Tailwind `backdrop:` utility that would win over anything in the base layer.

**A modal must stay mounted to animate out.** `{selected && <TradeModal open …>}` unmounts on close and the
exit never runs — the panel just disappears. The selection outlives the close and a separate `open` flag
drives the dialog.

`test/wallet.test.js` pins the instant credit, the replay, the queued path, both ceilings, single-credit
approval, decline, and the per-user pending cap.

### Withdrawals — the mirror of deposits, where every failure mode inverts

`/api/withdrawals` (`services/withdrawal.service.js`, `models/Withdrawal.js`), `/withdraw` on the client.
A deposit that goes wrong makes somebody wait; a withdrawal that goes wrong sends money nobody can recall.
Four things differ from the deposit flow as a result, and each is the answer to a specific way of losing
money.

**The cash is debited when the payout is REQUESTED, not on approval.** Debiting on approval leaves a window
in which the user can spend money they have already asked to withdraw — request $5,000, buy $5,000 of
stock, and the approval either overdraws the account or fails and leaves the payout stuck with nothing an
operator can do. The debit is a hold; `cancelled` and `rejected` post a `WITHDRAWAL_REVERSAL` credit under
the same reference. Two entries, one reference, distinguished by type: the ledger records the round trip
rather than erasing it, and `post()`'s existing overdraw guard *in the update filter* is what makes "you
cannot withdraw more than you hold" one atomic operation instead of a read followed by a hopeful write.

**Approval requires the row to have been CLAIMED first**, and nothing but `under_review` can reach
`approved`. `requested → under_review` is a compare-and-set, so two operators working the same queue cannot
both send the funds — the loser matches no document. On a deposit a double approval credits twice, which is
recoverable; here it is a second transfer. `txHash` is required on approval: an approved payout with no
evidence of a transfer is a row asserting money left the building with nothing to check it against.

**The quote rounds DOWN, the opposite of a deposit.** Both round in the house's favour by less than one
unit, because the alternative in each case is worse: a deposit rounded down arrives short and a reviewer
chases it, and a withdrawal rounded up pays out more than the account was debited, which the ledger would
then disagree with.

**The address is validated against the CHAIN'S FORMAT, not for a plausible length.** This started as
`length >= 16` and that is not a check: `gdghsdhjsdhdjsdksjdhdjsjdujdu` was accepted on a live **$3,937**
payout request during testing. A reviewer cannot eyeball a Tron address either, so nothing downstream would
have caught it. `checkAddress()` holds a per-network pattern and `addressHint` travels with the network so
the screen can say *"starts with T and is 34 characters"* before anything is pasted rather than refusing
afterwards. They are format checks, not existence checks — no regex proves an address is reachable — but
they catch the class that actually happens: truncations, typos, and an `0x…` address pasted into a Tron
payout. Base58 excludes `0/O/I/l` precisely so a mis-copy fails the pattern instead of silently addressing
a different wallet.

**The payout networks are DERIVED from `DEPOSIT_DESTINATIONS`**, which is a real coupling rather than
reuse: if we can receive USDT on TRC20 then we hold USDT on TRC20 and can send it back, and one list means
the two screens cannot disagree about which chains exist. What is not carried over is the address — ours is
a receiving address and has no business on a payout screen, and a test asserts it never appears in the
methods response.

**The screen is two stages because a withdrawal can only pay out CASH.** On this product most of an account
is usually positions, so asking for an amount first would refuse most requests with "not enough buying
power" and leave the user to work out that the fix is to sell something, on another screen, and come back.
Holdings come first with the sell ticket attached, then the amount step is reached with the buying power
they actually have. The **sell is an ordinary market sell through `/orders`** and fills immediately — it is
not part of the review, because holding a sell for approval would leave somebody unable to close a position
while the market moved against them. Someone already liquid passes straight through stage one; forcing a
sale on them would be a step that exists only to be satisfied.

**Withdrawals reduce `contributedCapitalCents`**, or taking money out would read as losing it: withdraw
$1,000 and portfolio value drops $1,000 against an unchanged base, so the card would show −$1,000 of
return on a payout the user asked for. The entries are already signed, so a plain `$sum` over DEPOSIT,
TOPUP, WITHDRAWAL and WITHDRAWAL_REVERSAL is the net figure and a cancelled payout contributes exactly zero.

**A `<label>` must not wrap a custom listbox**, and this cost a real bug on the payout form. Clicking
anything inside a label forwards the activation to the label's control, so pressing an option ran `commit()`
— setting the value and closing the list — and then the forwarded click hit the trigger and toggled it
straight back open. The value was right and the dropdown would not shut. Measured: `aria-expanded` never
left `true` through a full selection, while the identical `Select` on `/fund` — where the label is a
SIBLING with `htmlFor` — closed every time. Associate by id; a `<label>` with no `htmlFor` and no control
inside it is inert.

`test/withdrawal.test.js` pins all of it: the hold at request time, the reduced buying power, the replay,
the overdraw refusal, single-claim, approval moving no money, both reversal paths returning the full
amount, the cancelled round trip leaving the summary byte-identical, cross-user access, the queue cap, the
address rules (including the exact string that got through), and a genuine reconciliation.

### The allocation must reconcile, and a missing quote must not shrink it

The donut, the summary and the holdings table are three views of one number, so they are asserted against
each other rather than trusted: slices sum to `portfolioValueCents`, holdings plus cash equals it, the Cash
slice equals `buyingPowerCents` exactly, and every non-cash slice traces back to the positions of that
sector. Verified live on the seeded account and pinned in `test/order.test.js`.

**The one that was broken: a position whose instrument stopped resolving was DROPPED.** `getPortfolio`
returned `null` for it and filtered it out, so the holding vanished from the table, from the donut and from
`holdingsValueCents` in one go — the portfolio total quietly fell by the value of a position the user still
owned, with nothing on screen to say so. Exactly the failure the leaderboard's `$unwind` had, and the one
`listWatchlist` already avoids by returning unresolved rows.

It is a live risk for crypto specifically: a coin exists only inside CoinGecko's top 50, and that list
changes. The fallback chain is now **live cache → `MarketPrice` mirror (last price we ever saw) → cost
basis**, and the row carries `resolved: false` so the table can mark it *stale*. Cost basis rather than
zero, because zero claims the holding became worthless, which is a far stronger statement than "we lost the
quote"; valuing at cost shows book value and a return of exactly zero. The mirrored `changePct` is
deliberately NOT reused — it was current when it was written and says nothing about today.

### A Mongoose `default` does not backfill, and that split a live position

Worth its own heading because the failure is silent and the symptom points nowhere near the cause.

`Holding` gained `assetClass` with `default: 'stocks'`. **A Mongoose default applies on creation and never
to documents already stored.** So a holding written before the field existed indexes under the compound key
as `(userId, null, 'AAPL')`, while a new buy upserts on `(userId, 'stocks', 'AAPL')` — different keys, no
uniqueness violation, and the account quietly ends up holding **12 AAPL and 7 AAPL as two separate
positions**. Observed exactly that on the development database after the multi-class work landed.

`config/db.js` runs `backfillAssetClass()` at boot, **before** the index work. Legacy rows are adopted; where
adopting one would collide with a row that already carries the class, the two are **merged** — shares and
cost basis summed — because both halves are money the user actually paid. Dropping either would lose a
position. It is a no-op once it has run. Two cases in `test/order.test.js` pin it.

### Order execution — the ledger

`services/order.service.js`. **The one failure mode that cannot ship is cash debited without a holding
credited**, and two independent mechanisms guard it — the second is the one that actually holds:

1. `withTransaction()` wraps the path, so a mid-way crash rolls back.
2. **The balance check lives in the UPDATE FILTER, never in a preceding read.**

```js
User.findOneAndUpdate(
  { _id: userId, cashBalanceCents: { $gte: totalCents } },   // the guard IS the filter
  { $inc: { cashBalanceCents: -totalCents } }, { new: true, session })
// null ⇒ insufficient funds ⇒ 422. SELL uses the same shape on `shares`.
```

A read-then-write is racy however carefully written — two concurrent buys can both read a sufficient
balance and both proceed. The conditional update is one atomic operation, so the loser matches no document.
That is race-safe *on its own*, which is what keeps it correct where `withTransaction` degrades to a plain
call on a standalone Mongo.

**Idempotency is the insert, not a lock.** The order row is written FIRST, so a retried submit collides on
the unique partial index over `idempotencyKey` (E11000) *before any money moves*, and the original order is
returned. The client generates one key per **ticket**, not per attempt — regenerating it on submit would
defeat the whole mechanism. Verified: a replayed key returns 200 with `replayed: true` and leaves the
balance untouched.

**Cost basis is relieved proportionally on a sell**, `round(basis × qty / shares)`. Taking it off at the
current price instead would book the gain into the basis and quietly corrupt every future average. A
position that reaches zero shares is **deleted**, not left at 0 — a zero-share row pollutes the donut and
the positions count.

**`cash + costBasis` is invariant across a BUY and must NOT be across a SELL.** A buy moves money from cash
into basis 1:1; a sell moves it by exactly the realised P&L. Measured on a round trip: buy 3 AAPL held the
sum at `1_171_339` exactly, and selling 3 moved it by `22_879` — $228.79, which is precisely
`proceeds − basisRelieved`. A test asserting the sum is conserved across a sell is asserting the wrong
invariant.

**Slippage is what makes the confirm step mean something.** The ticket sends the price it displayed; a
fill that has drifted more than `MAX_SLIPPAGE_PCT` (0.5) is rejected with **409 PRICE_MOVED** so the user
re-confirms against a real number. Observed live: quoted $309.35, filled $310.70 — 0.44%, inside
tolerance, and the receipt shows the **actual fill price**, not the quoted one. Skipped entirely when the
caller sends no quote: an API consumer that never saw a price cannot be protected by one.

MARKET orders only. `Order` models LIMIT and the sweeper is described in the plan, but a limit order that
sits unfilled is a worse first experience than not offering one.

The equity path above is unchanged by the multi-class work — same guards, same basis relief, same
idempotency. What changed is that `resolveTradable()` now answers for three classes instead of one: an
equity still resolves through its `Stock` document, while crypto and forex resolve through
`market.service.findInstrument()`, because they have no document anywhere. Pricing a fill through the same
cache the Markets table and the watchlist read is what stops a fill disagreeing with the row that was
clicked.

### Instrument detail — the terminal, one screen for three classes

`/stocks/:symbol`, `/crypto/:symbol` and `/forex/:symbol` all render `pages/Instrument.jsx`, served by
`GET /api/market/instruments/:assetClass/:symbol`. The class is in the PATH rather than a query string so a
pasted URL still says what kind of thing it is.

It exists because crypto and forex rows had nowhere to point: they live only in the market service's cache,
so there was no record to look up by key and those rows rendered as plain text while equities were links —
an inconsistency with no visible explanation. Equities keep their own richer `/market/stocks/:symbol` route
for the fields only they have (sector, P/E, 52-week range, `about`).

**It is laid out as a TradingView chart page, because the chart is the product on this screen** — not an
illustration inside a card. So the chart gets the height and everything else is a band around it:

```
┌──────────────────────────────────────────────┬────────────┐
│ ← AAPL Apple Inc · NASDAQ │ 1D 1W 1M │ Candles│  Details   │  symbol bar
├──────────────────────────────────────────────┤  ────────  │
│ $310.34  +$0.99 (+0.32%) today   Jul–Aug −1.09%│  Open …   │  price strip
│                   CHART (flex-1)             │  WATCHLIST │
│                                              │  AMZN …    │
├──────────────────────────────────────────────┴────────────┤
│ NASDAQ · Closed · opens in 17h · 1d bars · Twelve Data     │  status bar
└───────────────────────────────────────────────────────────┘
```

**The whole thing is ONE DARK PANEL.** Candle greens and reds separate better against ink than against
white, which is why trading screens are dark, and a single surface means the eye never crosses a boundary
between a number and the chart explaining it. The surface is `--color-ink` / `--color-text-on-deep`, already
used by Landing's dark sections; nothing new was invented. `Tabs`, `WatchButton`, `PriceChange` and
`TvChart` each take an `onDark`/`dark` prop rather than a className, because the active-pill background and
the resting text have to change together and `bg-mist` would otherwise win by stylesheet position.

**The panel is `xl:h-[calc(100dvh-10.25rem)]`, and that number is measured rather than guessed** — the
sticky nav renders at **65px**, the dashboard footer at **67px**, plus this page's own 16px of padding top
and bottom. Landing exactly on the fold is what lets the terminal fill the screen *and* keep the footer
visible, which is the complaint that produced `DashboardLayout`'s flex-column shell in the first place.
Below `xl` the panel is not height-constrained at all: a phone has no room to give a chart 60% of a short
viewport and still show a rail, so it grows to its content and the page scrolls.

**`min-h-0` on the chart's flex ancestors is load-bearing.** A flex child defaults to `min-height:auto`, so
without it the canvas refuses to shrink and pushes the status bar off the bottom of the panel.

**The rail is two stacked sections, not three tabs, and the watchlist is the one always on screen.**
Tabbing all three looked tidier and was wrong: the instrument's own figures are a short list — eleven rows
for an equity, seven for a coin — which behind a tab left roughly **500px of empty rail** under them on a
1080px screen, while the watchlist, the only unbounded thing here and the only reason the page is not a
dead end, was hidden behind a click. So Details/Position take the height they need (capped at 55%) and the
watchlist takes the remainder. It is also what TradingView does. Both scroll areas carry a `ScrollFade`,
because both cut a row in half at their cap — measured at 1280×900 the Details list ends mid-`Currency`,
and a sliced row reads as a rendering fault rather than as "there is more below".

**Everything in the rail is real.** No Ideas tab, no depth-of-market, no drawing toolbar: there is no order
book and no annotation store behind them, and chrome that looks like a feature and does nothing is worse
than a narrower rail. The rail's watchlist prices come off the same refcounted `useLivePrices` hook as
every other surface, so forty rows cost one connection and a row here cannot disagree with the same row on
`/markets`.

**The ticker is the h1, the company name sits under it** — on a market screen the symbol is what people
scan for and the name is context.

**Every figure in Details is derived from the VISIBLE CANDLE SERIES**, not from stored fields, and that
is a correctness decision. `Stock` carries seeded `dayOpenCents` and `week52HighCents`, and they are stale:
AAPL's seeded 52-week high is **$237.23 against a live quote of $309.35**, so rendering it would put a
52-week high *below* the current price on the same card. Deriving open/high/low/range from the drawn points
keeps them consistent with the chart beside them. Labels carry the range (`High · 1M`) because "High"
alone implies the day, which is only true on 1D. `peRatio` is the one stored figure kept — it travels under
`reference` with its `asOf` and renders as `P/E · ref`, since Finnhub 401s fundamentals. `about` rides
along on the same `Stock.findOne` that fetches `peRatio`, so the rail gets a description at no extra round
trip; crypto and forex have none and the rail is simply shorter there rather than padded.

**The two percentages on the screen answer different questions and are now labelled.** The headline is the
session/24h move and carries `today` or `24h`; the one beside the date span is the period return —
open-of-first-bar to close-of-last — and reads `over 1M`. They must not reuse each other's number. The
absolute change beside the headline (`+$0.99`) is *derived*, not fetched: previous close is
`price / (1 + pct/100)`, which is exact and cannot go stale against a socket-patched price the way a
separate `changeCents` field would.

**The status bar exists because a closed venue is otherwise invisible.** An equity price that has not moved
in four hours is not a broken feed, and nothing on the screen says so unless this does — so the instrument
response now carries a `session` for the row's OWN exchange (`getInstruments` computes NYSE and NASDAQ only,
being the two it can claim live prices for). Crypto and forex answer the same question differently and get
their own sentence rather than a shared vague one. The vendor attribution lives here for the same reason it
used to sit under the chart: a seeded walk that terminates at the real price is indistinguishable from real
history once drawn.

**The skeleton takes the shape of the terminal.** The panel is viewport-height from first paint, so a
couple of placeholder bars in the corner leave 800px of flat ink underneath and read as a page that has
failed. A cold candle fetch takes seconds after every server restart, so this is a state people see.

**The forming bar falls back to the POLLED price when no tick has arrived.** Candles are cached up to ten
minutes, so without this the chart's last bar sits at the vendor's cached close while the headline shows
the newer REST price — measured on BTC, header **$78,906** against a chart reading **$78,367**: two answers
to "what is it now" on one card. `isLive` additionally requires `streamed != null`, so a closed venue
cannot claim Live off a REST fallback that has not moved in hours.

**Trade is live for all three classes.** It was disabled for crypto and forex while there was no position
model for them; there is one now — see the section above on nanos pricing and fractional quantities. Signed
out it becomes a link to `/auth`, since these pages are reachable anonymously.

**The ticket opens on a quantity the account can afford.** A default of `1` is a reasonable share order and
an absurd Bitcoin one — roughly eight times a starting balance — so the fractional classes open on roughly
$500's worth at two significant figures (0.0063, not 0.00634117) rather than greeting the user with an
error. A **Max** button fills the largest quantity the side supports, which is most of the friction in
typing a fractional quantity at all.

**That disabled button was invisible, and the reason was in a tooltip nobody could reach.** `Button`'s
`secondary` variant is `bg-white text-void` — built for the white app canvas — and under the blanket
`disabled:opacity-45` it composites over ink to a **mid-grey slab with near-black text at 4.45:1**, on a bar
where everything else is transparent or bright green. It read as an artefact, not a control, so the
observation it produced was "there is no Trade on crypto". `Button` now takes **`onDark`** (see below) and
the *reason* moved out of the `title` and into the status bar — `Market data only — HyperStocks holds
equity positions` — because `title` does not exist on touch and needs a hover nobody performs on a control
that already looks unavailable.

### Candles — two classes are real now, one is not

`services/candles.service.js` routes `{assetClass, symbol, range}` to whichever adapter can actually supply
history. Candles are no longer simulated across the board:

| class | source | real? | wicks | volume |
|---|---|---|---|---|
| crypto | CoinGecko `/coins/{id}/ohlc`, keyless | **real OHLC** | yes | **no — the endpoint has no volume field** |
| forex | Frankfurter (ECB) time series | **real daily closes** | **no** | no |
| stocks — NYSE/NASDAQ | Twelve Data `/time_series`, needs a key | **real OHLC** | yes | **yes** |
| stocks — other six venues | `market/mockCandles.js` | simulated | yes | yes |

**Finnhub sells no history on this tier — all three of `/stock/candle`, `/crypto/candle` and
`/forex/candle` return 403**, verified against the live key. It buys quotes and news, not candles.

**The two equity vendors are exact mirror images, which is why both are needed.** Finnhub streams US
quotes free but 403s US candles; Twelve Data's free plan sells US candles but no non-US anything. Together
they cover NYSE and NASDAQ completely and leave the other six venues simulated until somebody pays. The
gate is the VENUE, never the ticker — the same rule the quote provider learned the hard way.

**Forex bars have no wicks, and that is the honest rendering, not a gap.** The ECB publishes one reference
rate per business day — there is no open, high or low anywhere in the source. Open is set to the previous
publication, which is the standard way to build a daily bar from closes and encodes a real day-over-day
move; high and low would be pure invention, so `hasRange: false` and the chart draws bodies only. A
fabricated wick is indistinguishable from a real one, which is exactly why it is not drawn. For the same
reason **forex has no 1D tab** — the client drops it rather than offering a range with one bar in it.

**`vendorId` on a crypto row is load-bearing.** `/coins/BTC/ohlc` is a 404: CoinGecko keys history by slug
("bitcoin"), and the slug cannot be derived from the ticker — TON is "the-open-network". The markets
response carries the slug so the candle adapter needs no second lookup.

**Candles must be cached, and not for latency.** CoinGecko returns 429 after roughly five calls in quick
succession, so a chart that reached the vendor per page load would break for everyone the moment two people
opened one. Measured: 227ms cold, 14ms warm. A vendor failure degrades to the simulated walk and the label
flips with it, so the fallback is never presented as real history.

**Bar width is chosen by CoinGecko from the day count, and it is not monotonic** — `days=30` returns 180
bars at 4h while `days=90` returns 23 at 4 days. Nothing downstream may assume more range means more bars.

#### The forming candle

The last bar is patched from the tick stream, which is what makes the chart live rather than merely recent
— the vendor's last bar was closed when it was fetched, up to ten minutes ago on a cached daily range, so
without this the right edge sits still while the headline price above it moves.

**Patch or append is decided by age, and getting it wrong rewrites history.** A bar timestamp is the
period's *start*, so a bar is still forming until one interval has elapsed. Measured: CoinGecko's last 4h
bar reads 3.0h old (forming → patch in place), while Frankfurter's last daily bar read **83h old on a
Monday** — Friday's publication with the weekend behind it. Patching that would have written a live rate
into a bar that settled three days earlier, so a stale bar gets a *new* one appended, opening at the
previous close. On forex that is the normal case, not an edge case.

Only the three things a real forming bar changes are touched: close follows the print, high and low extend
and never retreat, open never moves. The "Live" pill requires a tick to have actually reached *this*
symbol, not merely that the socket is up — a closed equity venue must not claim Live over a bar nothing is
moving.

**FX ticks must be read raw here too.** Measured tick: `price: 1.16638`, `priceCents: 117`. Cents would
render EURUSD at 1.17 and lose every decimal the pair moves in, so the tick is scaled by the response's
declared `divisor` (10,000 for FX, 100 for money) rather than by a guess.

#### The chart

`components/charts/TvChart.jsx` wraps **TradingView Lightweight Charts** (`lightweight-charts`,
Apache-2.0, on npm). It replaced a hand-rolled SVG candlestick component, which is deleted.

**TradingView ships three chart products and only one of them fits here:**

| | |
|---|---|
| Advanced Chart **widget** | an iframe carrying **TradingView's own data**. It would discard every price this product fetches, ignore the live socket, and draw intraday forex wicks the ECB never published. Rejected on those grounds, not on licensing. |
| **Charting Library** | self-hosted, needs an access request plus a UDF datafeed adapter — a far larger build for the same picture. |
| **Lightweight Charts** | Apache-2.0, npm, renders **our** data. This one. |

So the chrome is TradingView's and the numbers stay ours: Twelve Data OHLC, CoinGecko OHLC, ECB closes
and the socket-patched forming bar all arrive unchanged.

**`setData()` RESETS THE VISIBLE RANGE — never call it on a tick.** Doing so yanks the chart back to its
default zoom about once a second and makes panning impossible. A full set is reserved for an actual series
change (symbol, range, chart type, keyed by `seriesKey`); live ticks go through `series.update()`, which
patches the last bar in place or appends a newer one.

Four more that bite:

- **Times are UNIX SECONDS and must be strictly ascending and unique.** The library throws on a duplicate
  rather than ignoring it, and the forming bar is appended client-side — so the rows are deduped and
  sorted before they reach it.
- **v5 changed the series API.** It is `chart.addSeries(CandlestickSeries, opts)`; `addCandlestickSeries()`
  no longer exists.
- **The volume overlay needs `lastValueVisible: false` and `priceLineVisible: false`**, or the histogram
  publishes its own last value onto the price axis — a red "716.05K" tag under the real price, on a scale
  that is not the price scale, plus a line across the plot.
- **`rightPriceScale.scaleMargins` needs a top margin**, or the highest gridline sits flush against the
  canvas edge and its label renders clipped in half.

Values reach it in display units (`v / divisor`), and `priceFormat.precision` comes from the class — 4
decimals for FX, 2 for money — so EURUSD does not render as 1.17.

**`height` takes a number or the string `'fill'`.** `'fill'` is what the terminal passes: the chart is the
page there, so its height is whatever the symbol bar, price strip and status bar leave behind. `autoSize`
already wires up a ResizeObserver, so all the flag switches is whether a fixed height is written onto the
container. It is the one prop that needed a JSDoc annotation — `checkJs` infers `number` from the default
alone and then rejects the string.

### Real-time ticks — one socket, SSE to the browser

`market/liveFeed.js` holds a single Finnhub WebSocket and `GET /api/market/stream` fans it out over SSE.
Measured in the browser: **5 price changes in 9 seconds**, pill reading Live.

**Why a socket and not a shorter interval.** The REST quote endpoint is one call per symbol against
60/minute. Polling 17 symbols every 5s is 204 calls a minute — over budget before news spends any of it.
The socket costs one connection, so "seconds" stops being a trade-off against quota.

**One socket carries two classes.** Finnhub streams US equities and crypto together, crypto as
`BINANCE:BTCUSDT`, which is why there is no second Binance connection. Forex is absent on purpose: its
stream is paid and the ECB publishes daily, so `useLivePrices` does not even open a connection for that tab.

Three failure modes are handled, and the middle one is the one that actually bit:

- **Reconnect** — EventSource retries on its own; the socket has exponential backoff with a 30s ceiling.
- **A handshake that never completes.** A retry socket sat in CONNECTING indefinitely: no open, error or
  close event ever fired, `reconnectAttempts` froze at 1, and the feed was dark permanently while every
  health check read plausible. Backoff cannot save you — there is no event to back off from. A handshake
  timeout that calls `close()` is the only thing that turns a hung connect into a failed one.
- **Resubscribe on open** — a new socket knows nothing of the old one's subscriptions, so skipping this
  connects successfully and then sits silent forever, which reads green everywhere.

**Forex streams, and the reason is worth recording because the docs imply otherwise.** Finnhub's free
tier returns **403 for every forex REST call** — `/forex/rates` and `/quote?symbol=OANDA:EUR_USD` alike —
but **streams the same OANDA pairs over the WebSocket without complaint**: measured, 136 ticks in 15
seconds across 10 pairs. So the ECB daily publication still backs the table's opening state and its change
column, and the socket makes the rate itself live. A tick carries no reference to the prior close, so the
24h column stays ECB-derived rather than being recomputed from a print.

FX ticks carry a **raw `price` alongside `priceCents`**, and the client reads the raw one for that class:
USDJPY at 159.1825 rounds to 15918 cents and loses the two decimals the pair actually moves in. Tick
deduplication compares the raw value for the same reason — at cent resolution most FX ticks look identical.

**The 50-symbol socket budget is split explicitly, not first-come.** 52 equities, 50 crypto and 12 FX
pairs do not fit. Forex takes all 12 (small fixed set, dead tab without it), equities the top 20 by market
cap — the order the table sorts in, so the visible rows are the live ones — and crypto the remainder. Rows
outside the budget still carry a REST price; they update on the minute rather than on the tick. A
first-come loop would have let the equity list silently starve forex the moment a stock was added.

**A closed market is not a broken feed, and the pill has three states because of it.** Measured over one
15-second window on the same socket: **1 stock tick against 113 crypto ticks**. The plumbing is identical —
equities and crypto share the connection, the SSE stream and the client hook — but crypto trades all day
and the NYSE does not. `market/hours.js` computes the session from the Exchange record so the page reads
"Market closed · opens in 4h 7m" rather than showing "Live" over a column that has not moved in hours.

It uses `Intl.DateTimeFormat` with the stored IANA zone rather than an offset, because the offset is not a
constant — New York is UTC-5 in January and UTC-4 in July, and `test/news.test.js` pins both. **Exchange
holidays are not modelled**: a holiday reads as open-but-silent, which is the same failure this fixes, just
rarer.

**Ticks are flushed to Mongo on a 5s timer, not per tick.** Trades print several times a second; browsers
already have the tick over SSE, so the flush exists only so the slow readers — portfolio value, the
leaderboard, the tape's next request — are not a minute behind. The bulk filter carries `$ne`, so an
unchanged price is not a write.

**A CACHED TICK HAS NO EXPIRY, AND THE FLUSH USED TO TRUST IT ANYWAY.** `liveFeed.priceFor()` returns the
last trade ever seen for a symbol, so a socket that goes quiet — a closed session, a thin book, a
connection that died — does not merely stop updating: it keeps handing back the same number, and the flush
wrote that over the fresh REST quote every five seconds while stamping `quoteAsOf: now`. The staleness was
invisible at every layer above. Measured on the Landing tape with the socket down for 83 minutes: the
refresh job wrote AAPL's real close of **$310.34 at 11:58:40.487** and the flush put an 06:35 pre-market
print of **$310.00 back one second later, at 11:58:41.494** — over 69 one-second samples the tape carried
the vendor's price in exactly **one**. So a tick older than one `QUOTE_FULL_REFRESH_MS` window is refused:
past that point REST has demonstrably written something newer, and the tick is not a fresher price but an
older one wearing a new timestamp. The age comes from the vendor's **trade** timestamp (`at`), not from
when the process received it.

**The price and its percentage have to describe each other, and one writer owning each is what broke
that.** REST struck `changePct` once a minute while the socket moved the price every five seconds, so a
pill read `$310.00` beside `+0.32%` when $310.00 is **+0.21%** on the same previous close. Outside regular
hours it is worse than a lag and never self-corrects: REST holds yesterday's close all morning while the
socket streams pre-market prints. The flush therefore restates `changePct` from `previousCloseCents` in the
same write — as an **aggregation-pipeline update**, because the new percentage depends on a field of the
document being written and reading it first would race the refresh job for the same row.

That field existed on `Stock` and was never refreshed: **AAPL's seeded `previousCloseCents` read $227.97
against a live prior close of $309.35**, so `finnhubQuote` now returns `pc` and the job writes it. Only a
real one is written, and only the US vendor supplies it — the fallback branch keeps whatever REST struck
rather than deriving a percentage from a seeded figure. Verified live: all six US tape symbols reconcile
to four decimals, ASML does not and correctly is not touched, since no free plan quotes Euronext.

`test/market.test.js` pins the age guard, its boundary, a missing timestamp, one stale row not suppressing
a live one, the crypto/forex skip, and the derived percentage.

Client side, `hooks/useLivePrices.js` keeps **one connection for the whole app**, refcounted: browsers cap
six per origin, and a table opening one per row would stall every other request on the page. Ticks are
coalesced to one flush per animation frame — several a second per symbol would otherwise re-render faster
than the screen repaints.

### The quote refresh job — the only thing that writes a price

`market/refreshJob.js` is what makes prices move at all. Before it existed nothing anywhere wrote to
`Stock` documents outside the seed, and **everything price-shaped reads them**: the Landing ticker tape,
portfolio values, every holding's P&L, the leaderboard, Top investors. Measured before: 0 of 7 tape
symbols changed in 75 seconds, and they would not have changed in 75 days. One job fixes all of it because
they all read the same collection.

- **Twelve Data was meant to be the non-US half of the book. On the free plan it cannot be.** This was
  written from the docs before a key existed; measured with a live one, every non-US symbol answers
  *"not available with your plan"* — `ASML:Euronext`, `SAP:XETR`, `AZN:LSE`, `0700:HKEX`, `600519:SSE`
  alike. The `basic` plan is **US-only**, so the six non-US venues stay seeded and keep their **Delayed**
  badge whether or not a key is set. A paid plan re-enables the path with no code change.
- **Twelve Data returns a native price and no FX rate**, so the USD figure is derived from that listing's
  own seeded `priceUsdCents / priceCents` ratio — same technique as market cap, same reason: a per-symbol
  invented rate would drift the two prices apart. Its symbol format is `SYMBOL:EXCHANGE`, not Yahoo's
  suffixes, and two codes are traps already hit in this project — **XETRA is `XETR`, TSE is `JPX`**. All of
  that still applies the moment the plan covers them.
- **~16 calls a minute**, one per symbol at `QUOTE_FULL_REFRESH_MS`. There is deliberately no faster
  hot-symbol tier: at 15s the seven tape symbols alone add 28/min, and news spends the same 60/min key.
- **Breaker at 3 consecutive failures**, one window off. A revoked key would otherwise burn the whole
  quota re-failing every minute and take the news feed down with it.
- `GET /api/market/status` reports `live`, `quoteAgeMs` and `lastError`, because the failure mode is
  invisible: with the job off every screen still renders a full set of plausible prices that never change.
  It also reports `twelvedata.coversNonUs`, for the reason below.

**Twelve Data credits are the constraint, and mis-spending them is silent.** A batch costs one credit
**per symbol**, not per request — against **8 a minute and 800 a day**. So the job cannot blindly ask for
18 non-US symbols every 60 seconds: that is ~26,000 credits a day against an 800 allowance, exhausting it
in under an hour and taking the *candle charts* down with it, which are the thing the key actually buys.
Support is therefore probed **once with a single symbol** and remembered for the process, so a restart
re-probes and an upgraded plan is picked up automatically.

**The same rejection is worded two ways, and matching only one is a slow leak rather than a visible bug.**
A batch says `**symbol** ASML is not available with your plan`; a single symbol says `This symbol is
available starting with the Grow or Venture plan`. The probe sends one symbol, so it sees the second form —
matching only the first left it unresolved, re-probing every cycle at one credit a minute, 1440 a day. It
would have drained the budget overnight. Both wordings and the pricing URL are matched now, and an
unresolved probe is abandoned after three attempts so an *unknown* permanent error cannot leak either.

**`startQuoteRefresh()` is called from `index.js` and nowhere else, and that is load-bearing.**
`test/seed.test.js` asserts jd_trader's portfolio is exactly `1_222_064` cents and his rank exactly 128,
both computed from these prices. The tests import the seed and models directly and never boot `index.js`,
so quotes stay seeded there and those integer equalities hold. Starting the job from `app.js`, or from a
model import, breaks both assertions non-deterministically.

Consequence worth expecting: in a **running** dev server jd_trader's portfolio is no longer exactly
$12,220.64. Live prices mean a live portfolio value. Only the test's frozen prices reproduce the design's
figure.

### News — the only thing here that calls a third party

`/news` renders two feeds: our own `Announcement` records above market headlines from a vendor. They are
separate queries on purpose — announcements come out of our database, headlines depend on a rate-limited
third party, and merging them would let a vendor outage blank our own operational notices.

**The cache is the quota.** Finnhub's free tier allows 60 calls a minute; one person reloading `/news`
would spend that in under a minute if page loads reached the vendor. So `services/news.service.js` refreshes
a feed at most once per `NEWS_MIN_FETCH_MS` however many people ask, single-flights concurrent misses, and
every response is served out of the `NewsArticle` TTL collection. The ladder is fresh cache → fetch →
**RSS fallback** → stale cache → empty, and `refresh()` records its outcome even when everything failed,
which makes that a crude circuit breaker.

`source` and `degraded` are on every response and the page renders a pill from them. Note what forced that:
a cache hit never enters `refresh()`, so if the remembered state held only a timestamp the page would spend
`NEWS_MIN_FETCH_MS` presenting fallback headlines as the real feed. `feedState` remembers *which adapter
answered*, not just when.

**Which provider serves which market is not uniform, and that is measured rather than assumed.** Finnhub
silently answers an unrecognised `category` with `general` — `category=commodities` is byte-identical to
`category=banana`, which is byte-identical to `general` — so `finnhub.covers()` is a whitelist of the two
that were verified real. Nasdaq plays the same trick from the other side: `?category=Currencies` returns
200 with 15 items of which **12 are byte-identical to its Markets feed**. Never add a class without
diffing its output against the default feed first.

| class | providers | has `imageUrl` / 24 | **actually loads** |
|---|---|---|---|
| stocks | Finnhub `general` (RSS only as fallback) | 2 | **2** |
| crypto | Finnhub `crypto` **+ CoinTelegraph + Decrypt** | 11 | 11 |
| forex | FXStreet + Investing.com | 24 | **23** |
| commodities | Nasdaq + Investing.com | 10 | **0 — every one is Investing.com, every one 403s** |

Re-measured by fetching every URL, not by counting the field. Two columns because they disagree:
`imageUrl` being present is not evidence an image will render, and commodities is the proof —
ten URLs, zero pictures. Stocks reads low because the adapter strips Finnhub's house logos at the
vendor boundary, which is correct; what survives is the handful of real photographs.

**Merging is per class and the list is measured, not tidy.** `AUGMENT` holds only `crypto`, where adding
CoinTelegraph and Decrypt took the tab from 1 usable image to 13. The same merge applied to stocks made it
*worse*: Nasdaq publishes no images on any feed and posts more often than Finnhub, so under a straight
`publishedAt` sort its items crowded the photographs out and the tab fell from 6 distinct images to 1.
Stocks therefore takes Finnhub alone with RSS behind it as a fallback. Before adding a provider to a class,
count the images after merging, not before.

Forex and commodities on RSS is **not** a degraded state — Finnhub's forex category returns a single item
and it has no commodities category — so `refresh()` reports `degraded: false` for them or the page would
cry wolf on every load.

**Three things arrive dirty and are cleaned at the vendor boundary**, all measured on one 20-article
sample where the same 14 items had all three: the image is the publisher's logo on `static*.finnhub.io`
(the rule is the HOST, not `/logo/` — the crypto feed uses `/hmpimage/` for the same thing), the summary
restates the headline verbatim, and the headline ends in " - Reuters" beside a byline already reading
Reuters. Cleaning happens in the adapter so the cache holds clean records.

**A present `imageUrl` does not mean a loadable image.** Investing.com hotlink-protects its CDN: every
enclosure it publishes 403s from any origin but its own. `Thumbnail` falls back on the img's `onError`
rather than blacklisting that host, so any dead image from any provider degrades to a tile.

**`market/news/rss.news.js` is the keyless Nasdaq fallback, and its parser is the fragile part** — hence
`test/news.test.js`, where every case is a defect that shipped and was caught rather than a hypothetical.
Three things about that feed are true and non-obvious: it prefixes some elements and not others
(`<nasdaq:tickers>`, `<dc:creator>`, but bare `<title>`), it **double- and sometimes triple-encodes
entities** (`&amp;rsquo;`, `&amp;amp;`), and it welds section headings onto summaries with no space
("Key PointsDuring the second quarter…") on essentially every item. The decoder therefore runs twice, and
the second pass excludes `lt`/`gt` — that omission is the only thing keeping `&amp;lt;script` text rather
than markup.

`FINNHUB_API_KEY` is set, so stocks answers from Finnhub and crypto from `finnhub+rss`. Forex and
commodities run on RSS by design, not by degradation — clear it and every tab falls back, which the pill
reports.

**The page's layout is driven by which stories have a picture, and that is not a stylistic choice.**
Reread the table above: forex is fully illustrated, stocks has two photographs in twenty-four, and
commodities has none at all. A fixed image slot would look designed on one tab and reserve two dozen empty
frames on another. So an image is optional at every level — the lead story drops to a full-width text hero
without one, and cards render with no picture area rather than a grey placeholder, taking `line-clamp-4`
on the summary instead of `line-clamp-2` so they still carry their share of the row.

Two things that were wrong before being measured:

- **The two-column split on the lead must be conditional on there being an image.** Left unconditional the
  copy lands in the image column and wraps at 48% width beside an empty half — which is the *usual* state
  of the stocks and commodities tabs, not an edge case.
- **`loading="lazy"` means the box exists before the bytes do.** Untinted, every card below the fold is a
  white void the width of the card; the image carries `bg-mist` so it reads as a loading panel.

`onError` drives the collapse rather than a host blacklist, so a dead image from any provider degrades the
same way. Verified across all four tabs: **0 broken frames**, including the ten commodities images that
all 403.

The header's freshness line reads the newest article's `publishedAt`, **not** the response's `asOf` —
that field is stamped when the JSON is built, so it always says "just now" even when every headline is six
hours old, which is worse than showing nothing because it implies the feed is moving.

## Client architecture

**Two shells, chosen by session not by route.** `AdaptiveLayout` renders `DashboardLayout` (grey canvas,
floating panel) when signed in and `PublicLayout` (marketing, footer) when not. `/markets` and
`/leaderboard` go through it; `/` stays marketing for everyone; the rest are `ProtectedRoute`. Picking the
shell by route is what previously made the product look like two different apps.

**Pages own their horizontal padding** (`px-4 … 2xl:px-9`), not the shell — the same page renders in both
shells, and only one of them has padding. Neither the panel nor page content is width-capped; the dashboard
is meant to fill a desktop viewport.

**One navbar.** `components/nav/` holds `navItems.js` (shared config), `TopNav` (web, text-only links) and
`MobileDrawer` (below `lg`, icons retained). `TopNav` swaps the account cluster for Login/Get Started based
on auth state.

**THE NAV SEARCH IS THE ONLY FLEXIBLE ITEM IN A ROW OF `shrink-0` SIBLINGS, so it absorbs every squeeze and
collapses instead of wrapping.** Measured on the rendered nav, it fails in *two* separate bands:

| | 480 | 414 | 390 | 360 | 320 |
|---|---|---|---|---|---|
| input width | 132px | 66px | 42px | **12px** | **0px** |

At 360 the label is 64px — a bordered box holding a clipped magnifier and nothing else, which reads as a
rendering fault rather than a control. The second band is signed-in from `lg`, where the desktop nav links
appear and take **353px**: the input measures 45px at 1024, 121px at 1100, and is only back to a usable
221px by 1200. So the search is `hidden sm:flex lg:hidden xl:flex` — present 640–1023 and from 1280,
absent in the two bands where it has no room.

**Nothing is lost by hiding it: it does not search.** Its only behaviour is `onFocus` → `/markets`, and the
mobile drawer already carries a Market link to the same place. A `min-width` instead would only move the
failure — at 320 there is no room to honour one, so it would force the page to scroll sideways, which is
worse than an absent shortcut.

**The account cluster's `ml-auto` MIRRORS THE SEARCH'S VISIBILITY EXACTLY** — `ml-auto sm:ml-0 lg:ml-auto
xl:ml-0` — because the search is what pushed the cluster right, and hiding it drops the auto margin with
it. Measured before this mirrored: the `lg`–`xl` band left the cluster packed against the nav links with
**204–380px of dead space** trailing it. The two must never both carry it, either: two auto margins in one
row split the free space and leave a gap in the middle rather than a bar that fills. Wrapping the two
branches in one div is what gives the signed-in fragment (`InvestmentPill` + `AccountMenu`) something to
hang that margin on; it repeats the header's own `gap-3 sm:gap-4` so nothing moves visually.

Audited across **22 routes × 7 widths (1920 → 360), 154 combinations, zero horizontal overflow**, public
anonymously and the six authenticated routes with a fresh login each. Two overflows exist at **320px only**,
both pre-existing and below the 414 floor this file sets: Landing's `rounded-full` security capsule is
299px against 256px of container (it is `shrink-0` by design so the flanking rules collapse first, but the
capsule itself then cannot fit — `text-base` would bring it to 249px at the cost of shrinking the heading
on every phone), and `/leaderboard` rows overflow 6px.

**Auditing an authenticated route needs A FRESH LOGIN PER ROUTE, and one login per *navigation* trips the
auth limiter** — measured, `429 RATE_LIMITED` at 20/15min. Each load calls `/auth/refresh`, which rotates
the token, so navigating again before that request completes replays a spent one and revokes the family.
The first run of the audit lost its session partway through and measured `/auth` six times while reporting
it as `/portfolio`; every authenticated result now asserts `location.pathname` stayed on the route.

**Import `Link` and `NavLink` from `components/ui/Link`, never from `react-router-dom`.** The wrapper
exists only to default `viewTransition` on. React Router has no router-level switch for it, so without one
owner every new `<Link>` is a chance to forget — and the failure is silent: the link works, it just skips
the crossfade while every other link on the page has one.

### Scroll and route transitions

Three pieces that only work together, all in `router.jsx` and `styles/theme.css`:

- **`<ScrollRestoration />`** is required, not decorative. Without it React Router does nothing about
  scroll and where you land depends on whether the incoming page rendered tall enough yet — measured:
  /about at 4410px → /markets landed at 0 (document collapsed mid-swap, browser clamped) while /markets at
  1200px → /news landed at 1200, halfway down a page never seen. Now: top on navigate, exact position on Back.
- **`scroll-behavior: smooth`** affects programmatic and fragment scrolls only. It does nothing to wheel or
  trackpad scrolling and must not — that needs a library that takes the wheel off the compositor.
- **`ScrollBehaviour` must render BEFORE `<ScrollRestoration/>`.** ScrollRestoration jumps with
  `window.scrollTo(0, 0)`, the two-argument form, which *obeys* `scroll-behavior`. Unguarded, every
  navigation animates a full page-length scroll on top of the page just opened. `ScrollBehaviour` sets
  `html[data-navigating]` in a layout effect and clears it on the next frame; React runs layout effects in
  tree order, so moving it below ScrollRestoration silently breaks the guard.

Route crossfade is the browser's native View Transitions — no animation library, ~180ms, and browsers
without the API navigate instantly. A crossfade rather than a slide because these pages have no spatial
relationship; /markets is not to the left of /news.

### Scroll reveal — `components/ui/Reveal`, and why it is not Framer Motion

Landing and About fade-and-lift their sections in on scroll. `Reveal` is ~50 lines: an
IntersectionObserver that runs once and toggles a class, with the animation itself in
`--animate-reveal`.

**Framer Motion was evaluated and rejected on three specific grounds.** It earns its place for layout
projection, drag, shared-element transitions and exit animations on lists — and these two pages need none
of them. The two cases that would have justified it are already solved in CSS here: `Modal`'s exit via
`@starting-style` + `transition-behavior: allow-discrete`, and the route crossfade above.

- **It ships to every route.** There are no `React.lazy` routes (see the AGENTS.md gaps), so the bundle is
  one chunk — measured **1,017KB raw / 327KB gzipped**. `motion`'s plain import is ~34KB gz, about +10%,
  downloaded by `/portfolio`, `/fund` and `/withdraw`, which would never use it. `Reveal` minifies to a
  few hundred bytes.
- **It would be a second owner of `prefers-reduced-motion`.** One block in `theme.css` currently kills the
  hourglass, `rise`, the marquees and the dialog transitions. `useReducedMotion` is that same decision
  again, in JS, free to drift from the CSS. Compare `PriceChange` owning signed percentages and
  `toast.js` owning durations.
- **Every call site could invent its own easing.** `--radius-*` and `--shadow-*` are deliberately wiped so
  `shadow-lg` will not compile; inline `transition={{ duration: 0.8, ease: 'backOut' }}` is exactly what
  those wipes exist to prevent.

**`--animate-reveal` is a separate token from `--animate-rise`, not a reuse of it.** `rise` is a panel
replacing another in place — 8px over 240ms, sized to read as content settling. A whole section arriving as
you scroll to it has further to travel and needs longer, so this is 16px over 560ms. Same easing
deliberately: the distance and duration differ, the character does not.

**THE TRIGGER IS A NEGATIVE `rootMargin`, NOT A THRESHOLD, and the difference is a bug rather than a
preference.** A threshold is a ratio of the *element*, so `threshold: 0.12` can never be satisfied by a
section taller than ~8× the viewport — at 900px against a 10,000px section the observer tops out at 9% and
the content stays invisible forever. Shrinking the root's bottom edge fires at a fixed distance in
whatever the element measures.

**AN ELEMENT WITH NO BOX CAN NEVER INTERSECT, and IntersectionObserver does not re-fire when it later
gains one.** A `hidden lg:block` child would be stranded at `opacity: 0` until something happened to
scroll. Measured on Landing's flow arrow: at 414 it is `display: none` and correctly invisible, but
resizing to 1440 left it `display: block; opacity: 0`, recovering only on the next scroll. `Reveal` now
reveals a zero-area element immediately — nothing without a box is visible anyway, so it costs no
animation anybody could have seen and makes stranding impossible.

**It runs once and never replays.** Content that re-animates every time it passes the fold reads as a
glitch, and on pages this long it would happen constantly.

**Stagger is `animation-delay`, passed as `delay`.** The keyframes carry `both`, so an element holds the
hidden state through its delay instead of flashing in and back out. Grids pass `i * 80`; `Split` gives
whichever half is *visually* first the zero delay, because `reverse` moves the photo right and a
right-hand element arriving before the left one reads backwards.

**Wrapping a grid item moves the stretch.** `Reveal` becomes the grid item, so anything relying on
`align-items: stretch` needs `h-full` on **both** the wrapper and the child — otherwise cards size to
their own copy and stop ending level, which is the failure the note about `items-start` already warns off.
Verified at 1440: security cards 216/216, asset cards 195/195 and 174/174, Split photos filling their
wrappers exactly, all Δbottom = 0.

Verified across `/` and `/about` at 1440 and 414, motion and reduced: **35 reveal elements, 0 stranded,
0 horizontal overflow**. Under `prefers-reduced-motion` the component never applies the class at all, so
the count is 0 and the content simply renders — the CSS kill-list entry is a second line of defence for
the element that was already on screen when the setting was switched on mid-session.

Verified: 0 animated frames on the router's scroll, 28 on an ordinary `scrollTo`, `startViewTransition`
called once per navigation, Back restoring to 1399px, and under `prefers-reduced-motion: reduce`
`scroll-behavior` computing to `auto` with the transitions off.

**Formatting has single owners.** `PriceChange` is the only component allowed to render a signed
percentage, and `Money` the only one to render currency — both delegate to `lib/format.js`. The design uses
a real **U+2212 minus (−)**, not an ASCII hyphen; they render at different widths and mixing them makes
columns ragged.

**Numbers are `font-numeric`, NOT the mono face — and tabular alignment is a font feature, not a property
of monospace.** Prices, percentages, quantities and ranks used to render in Geist Mono, which reads as a
code listing rather than as money. They are the body face now, so `$1,000.00` looks like the rest of the
interface. The column alignment mono was there for comes from the `tnum` OpenType set, which
`--font-numeric` bakes into the token so a call site cannot forget it. Measured across six digits at 32px,
system-ui spans **31px** between `111111` and `000000` normally and **exactly 0** with tabular figures on;
re-measured on the rendered holdings table by swapping every digit in six price cells between all-1s and
all-0s — **0px** of movement in each.

**`font-display` still must not touch a number, and that is now measurable: Poppins has no tabular figure
set at all.** The same test spans 59px in Poppins and `tabular-nums` does not close it, because there is no
`tnum` feature for it to switch on. A price column in Poppins visibly shifts on every tick.

**The split at a call site is whether the thing is a figure.** `font-mono` survives for codes — tickers,
deposit references, transaction hashes, wallet addresses, exchange badges, env var names — which want
per-character distinction and are not numbers. The sweep keyed on exactly that: `font-mono` alongside
`tabular-nums` became numeric, `font-mono` alone stayed. 67 sites moved, 26 stayed. `Tabs`' `mono` prop is
renamed `numeric` for the same reason, since it now sets the numeric face.

**`TvChart` reads the token rather than repeating the stack.** Lightweight Charts paints to a canvas that
no stylesheet reaches, so the family is handed over as a string — resolved from `--font-numeric` at chart
creation. Left on mono, both axes (which are entirely figures) disagreed with the headline price directly
above them.

`lib/monogram.js` exists because the design system's `symbol.slice(0,2)` turns `600519`, `601398` and
`601899` into three identical "60" avatars; numeric tickers fall back to company initials.

### Internationalisation — English and Ukrainian

`i18n/` holds the config and two bundles; `react-i18next` + `i18next-browser-languagedetector`. The
switcher is in `TopNav`, the choice persists to `localStorage` under `hs_lang`, and `<html lang>` follows
it — screen readers, `:lang()` and font matching all key off that attribute and nothing else would set it.

**Not a translate widget, and the reason is specific to this product.** A Google-Translate-style embed
rewrites text nodes in place, which fights React's reconciler, and — far worse here — **rewrites numbers**.
The deposit screen quotes `1000.304000 USDT` with `toFixed` precisely so it can be pasted into a wallet;
reformatted to `1.000,304000` it is an amount that cannot be sent. Wallet addresses and transaction hashes
carry the same exposure. Translation has to be something the app controls.

**POPPINS HAS NO CYRILLIC. AT ALL.** Verified against the Google Fonts API: zero `cyrillic` @font-face
blocks for Poppins, four for Montserrat. Without a fallback every Ukrainian heading falls straight through
to the system stack — silently, exactly the way a missing *weight* does. Montserrat now sits between
Poppins and the system stack in `--font-display`, and because font matching is **per character** English is
untouched. Measured at 40px/700, "Поширені запитання": app stack **456.5px** against Montserrat **458** and
system-ui **404.7** — Cyrillic resolves to Montserrat. "Frequently asked": app stack **357.2** against
Poppins **357.2** exactly. Geist Mono already ships Cyrillic, so the mono face needed nothing.

**`format.js` localises the DIGITS ONLY, and that boundary is the point.** The group separator and decimal
mark are locale-driven — Ukrainian writes `$17 103,75` where English writes `$17,103.75`, and reading a
balance in the wrong convention is a real misreading. The **sign and the symbol position are not**:
`pct()` emits a real U+2212 because the design does and because it aligns with tabular digits, and `Intl`'s
own currency mode would replace it with the locale's minus and move `$` behind the number for `uk-UA` —
breaking the column rule this module exists to own. So the parts are assembled here and only the digits go
through `Intl`. The locale is **pushed in** via `setNumberLocale()` rather than read from a hook, because
`money()` is called from plain functions, not components.

**Server errors were already translatable and needed no server change.** The contract is
`{ error: { code, message } }` and the client already switched on `code`, so **the code IS the translation
key**. `lib/apiError.js` maps it, falling back to the server's English `message` — never to the bare code,
because "STALE_STATE" on a funding screen is a leak, not a message.

**Ukrainian has four plural forms** (one/few/many/other) where English has two. i18next resolves them
through `Intl.PluralRules`, so a key needs `_one/_few/_many/_other` in `uk` against `_one/_other` in `en` —
see `portfolio.exchanges` and `faq.answered`. A count interpolated into a sentence built by concatenation
cannot express this, which is why the trade CTA is `trade.submitBuy` with `{{quantity}}` inside the string
rather than a verb with a quantity appended: Ukrainian puts them in a different order.

**`Select` gained `triggerLabel`** for the language control specifically: the open list must read
"Українська" — somebody who cannot read the current interface cannot read "Ukrainian" either — while the
nav slot fits about three characters. Without it the trigger rendered "У…", which names nothing.

**Nav items carry `key` separately from `label`.** A key derived from the English label would change the
moment anyone reworded it, silently orphaning every other language's translation with nothing to report it.

**EVERY ROUTE IS TRANSLATED.** Nav (both shells), Portfolio, the trade ticket and receipt, the whole
Withdraw and Fund flows, Markets, News, Leaderboard, Auth, the FAQ (all nineteen answers), Landing, About
and the shared marketing footer. Verified by reloading each route with `hs_lang=uk` stored and measuring
the Cyrillic share of the rendered text.

**A low Cyrillic ratio is not a gap on the data-heavy screens.** Markets reads 8%, News 3%, Leaderboard 5%
— those pages are mostly tickers, company names, vendor headlines and trader usernames, which are DATA and
correctly stay as they are. Their chrome is fully translated; compare Landing at 87% and About at 95%,
which are prose. The one genuine remainder is Landing's exchange table (`NYSE / United States /
09:30–16:00 EST`), which comes from the `Exchange` collection — translating it is a data-layer decision,
not a UI one, and translating the venue codes would be wrong.

**Copy that is DATA lives in the bundles as data.** `faq.*.json` and `site.*.json` are separate files
merged into the same namespace: nineteen FAQ answers plus two marketing pages would bury the ~forty app
strings a developer actually edits. Structure stays in the components — `PILLARS`, `HERO_STATS`,
`ASSET_CLASSES`, `FOOTER_COLUMNS` and `CATEGORY_IDS` became key lists, so order, icons and routes are
identical in every language while only sentences are translated. Numerals stay out of the copy: the `01.`
on Landing's security cards and About's `$3B+` are composed in JSX, because a numeral is the same in every
language and baking it in means translating it four times.

**Both bundles are asserted key-identical** — a one-line node check over the flattened key sets, ignoring
plural suffixes, since `uk` legitimately has `_few`/`_many` where `en` does not.

### The legal pages and cookie consent

`/privacy`, `/terms` and `/cookies` render from one `pages/legal/LegalDocument.jsx` — they share a shape
(title, last-updated, intro, numbered sections of paragraphs and lists), so three near-identical components
would be three places to fix a heading level. Section numbering is **computed**, like the FAQ's.

**THE DOCUMENTS ARE ENGLISH ONLY AND DELIBERATELY OUTSIDE THE i18n BUNDLES.** A translated privacy policy
is a *second legal document in different words*, and a data-rights clause that drifts in translation is an
exposure rather than a rough edge. Keeping them out of `en.json`/`uk.json` also keeps the parity check
honest — these keys would otherwise be permanently "en-only" and the check would need an exception, which
is how a check stops catching anything. The **chrome is translated**, including the notice explaining the
governing language, which only renders for a reader who is not reading English.

**THERE IS NO COOKIE CONSENT BANNER, AND REMOVING IT HAD ONE TRAP IN IT.** A banner and preference centre
were built and then removed by request. `components/legal/CookieConsent.jsx` and `lib/cookieConsent.js` are
gone; what matters is what had to be undone with them.

While the banner existed, `functional` consent genuinely gated `hs_lang` — the one non-essential thing this
app stores — which meant `i18next-browser-languagedetector` ran with **`caches: []`** and the write moved
to a listener calling `isAllowed('functional')`. **`isAllowed()` returns false when no consent record
exists**, so deleting the banner while leaving that gate would have meant the language preference silently
never persisting again: the switcher would still work, and the choice would vanish on every reload. The
detector owns the write again. Verified after removal: switching to Ukrainian stores `hs_lang: "uk"`
immediately and `document.documentElement.lang` is still `uk` after a reload.

If a banner is ever reinstated, that gate is the piece to restore with it — a toggle that does not stop the
write it names is consent theatre, and this is the only write it would have to name.

**The Cookie Policy stays**, and it gained a section the supplied copy did not have — *What This Site
Actually Stores Today*. It now carries the removal too: it states plainly that **no preference banner is
currently shown**, and its Managing Cookies section points at browser controls rather than at a centre a
reader cannot find. A policy describing a control that does not exist is worse than one describing none.

**These documents describe a product this is not**, more so than About's or the FAQ's. They assert
collection of government ID, Social Security numbers, employment and net-worth information; clearing and
custody providers; AML, sanctions screening and Regulation S-P compliance; and mutual funds and gold.
`server/src/models` has none of it: registration takes an email and a password. **A privacy policy that
overstates what is collected is a false disclosure, not aspirational marketing**, and it is the one class of
copy on this site where being wrong is itself the problem. Carried as supplied — the wordmark normalised to
"HyperStocks" as About's was — and flagged here for legal review before any real deploy. The contact
addresses are `@hyperstock.com` as given, against the `@hyperstocks.app` the rest of the product uses.

**All six documents exist now**: Privacy Policy, Financial Privacy Notice, Terms of Service, Cookie Policy,
Risk Disclosure and Disclosures, at `/privacy`, `/financial-privacy`, `/terms`, `/cookies`,
`/risk-disclosure` and `/disclosures`. Verified rendering, in order: 11, 7, 19, 4, 14 and 20 sections.

**THE DISCLOSURES COPY CONTAINED INSTRUCTIONS TO THE IMPLEMENTER, NOT TEXT FOR A READER**, and rendering
them verbatim would have published a drafting note to customers. Three sections carried them — *"Do not
insert claims such as 'FINRA member,' 'SIPC protected,' 'SEC registered'…"*, *"Use the official SIPC wording
applicable to HyperStocks's actual membership…"*, *"Do not describe brokerage cash as FDIC-insured
unless…"*. Each is honoured as a **constraint** and the customer-facing substance around it kept:

- **Regulatory Status** asserts no membership, registration or insurance anywhere, and says so explicitly.
- **SIPC** is *described* without claiming membership, because HyperStocks is not a member and every
  position here is simulated — "SIPC protects your account" would be the exact false claim the instruction
  exists to prevent. If membership ever becomes real, replace that section with SIPC's official wording
  rather than editing around it.
- **No FDIC Guarantee** is kept verbatim because it is TRUE as written: nothing here is a bank deposit.

A walk over all six pages asserts none of `FINRA member`, `SIPC protected`, `SEC registered`, `Do not
insert`, `Do not describe` or `Use the official` appears in the rendered text.

**The footer is Legal / Security / Support**, replacing Product / Resources / Company — which were twelve
links to routes that do not exist. On a site that now publishes risk disclosures, a dead link beside a real
one teaches the reader that these are decoration. Every Legal link resolves.

**Two footer entries are `mailto:` rather than routes**, and that is not a shortcut. "Report a Security
Issue" is the worst possible dead link — somebody with a vulnerability to report is exactly who must not
hit "Not found" — so it goes to an address, which works today where a Security Center page does not.
"Account Security" points at the Disclosures section that covers it, for the same reason. A `mailto` must
render as a plain `<a>`, never through `Link`: the router would try to navigate to it.

`footer.cookies` still read **"Cookies Settings"** from the original design after the preference centre was
removed, so the Legal column labelled the Cookie Policy as a settings screen. It is "Cookie Policy" now.

**The social icons are real profiles now** — Facebook, Instagram and YouTube. They replaced four `href="#"`
placeholders (X, Instagram, LinkedIn, GitHub) which were the last dead links in the footer; **there are now
zero**. X, LinkedIn and GitHub are *removed rather than kept pointing nowhere*: an icon that goes nowhere
looks like a channel somebody could follow and silently is not. Add them back when there is a URL.

They carry `target="_blank"` with `rel="noopener noreferrer"` — `noopener` is not optional there, or the
opened page gets a `window.opener` handle back into this one. Browsers imply it now; stating it makes that
independent of the browser. The supplied Facebook URL had a trailing `#`, an empty fragment on an external
page, which was dropped.

Verified: Instagram and YouTube both return 200, and the YouTube channel's `og:title` reads **"Hyper
Stocks"**. **Facebook cannot be checked from here** — it returns 400 to any automated request, including
for `facebook.com/meta`, so that URL is unverified rather than known-good.

### Landing's market-partner strip

The last section before the footer: a marquee of ten venue and trading-firm wordmarks under "Our Market
Partners". It reuses the ticker tape's keyframes and its doubling technique — the row renders twice and the
track shifts exactly -50%, so both copies must measure identically and the trailing gap is `pr-14` on the
row rather than a gap on the track.

**It needs its own DURATION, not its own animation.** `--animate-marquee` is 90s, tuned to the price tape's
long list; ten short wordmarks at that speed barely appear to move, which reads as a rendering fault rather
than a slow scroll. `--animate-marquee-partners` is 40s over the shorter track for roughly the same
perceived pace.

**Under `prefers-reduced-motion` it becomes a WRAPPED, CENTRED LIST, not a frozen marquee.** The ticker tape
gets away with freezing because a truncated price list still reads as a price list; a partner list cut off
mid-name reads as a layout bug. The duplicate copy is hidden in that mode so nothing renders or is
announced twice. Verified in all four combinations — 1440 and 414, motion and reduced: 2 rows/`nowrap` with
the animation running, 1 row/`wrap` without, and no horizontal overflow in any of them.

**The edges are MASKED rather than clipped.** A hard clip severs a wordmark mid-letter — measured at 1440 it
left "NYSE" reading "YSE" against the left edge. The mask is dropped under reduced motion, where nothing
moves and a fade over static text is just low contrast.

**The marks are the firms' OWN icons, bundled rather than hotlinked.** Nine third-party requests on the
landing page would each be subject to a CSP rule, a rate limit and a host that may hotlink-protect its CDN
— the lesson Investing.com already taught the news thumbnails. `assets/partners/*.png`, ~35KB for all nine.

**They are ICONS, NOT WORDMARKS, and that is what is actually obtainable.** Measured across every candidate
source: **Clearbit's logo API is discontinued** (connection failure, not a 404); **`simple-icons` carries
0 of 10**; **Wikipedia's page image is a photograph of the building** for six of them and a real logo for
one (Cboe). What survives is favicon services — DuckDuckGo and Google both return 9 of 10 — so each asset
is the company SYMBOL and the name beside it is rendered as text. That pairing is why the strip still reads
when a mark is missing.

**NYSE HAS NO ICON ANYWHERE.** 404 from `nyse.com` directly, from `apple-touch-icon`, and from both icon
services. Its parent `theice.com` has one, but that is the ICE brand rather than NYSE's, and drawing a
trademark by hand is exactly what `CoinIcon` already refuses to do. It renders as a wordmark alone — which
is what the missing-logo path exists for, and a test of it in production.

Native sizes run **32px (Jane Street, all that is published) to 192px**, so they render into a fixed square
with `object-contain`: stretching any of them to fill would distort a trademark. A failed load HIDES the
mark rather than leaving a broken frame, so the row degrades to exactly what it looked like before there
were logos — the same rule as `AssetMark` and `Thumbnail`. Verified on the rendered strip: 10 items, 9
logos, **0 broken**.

**THE NAMES ARE REAL, TRADEMARKED FIRMS AND THE HEADING IS A CLAIM — and shipping their actual registered
marks is the strongest version of it**, materially beyond the text wordmarks it replaced. "Our Market Partners" over Citadel
Securities, Virtu, Jane Street, Apex, DriveWealth and Alpaca asserts commercial relationships that do not
exist — a materially stronger statement than the leaderboard's illustrative individuals, because it names
counterparties. A line under the strip, not in the supplied copy, states that the platform is a simulation
and is not affiliated with, endorsed by, or a customer of any of them. **Remove the names before a public
deploy, not that line** — the same instruction the Top investors panel already carries, and for the same
reason.

### The FAQ page

`/faqs` (`pages/Faqs.jsx`, copy in `pages/faqContent.js`). Nineteen answers across six categories, built
from a supplied reference: hero, sticky category rail beside a single accordion list, closing CTA.

**It replaced the "Stock & fund" nav dropdown**, which was four links to the same `/markets` table
pre-filtered by sector — and two of those sectors (`Fund`, `Materials`) match nothing this product lists,
so half the menu led to an empty table. A flat nav link costs one slot instead of a menu, and there is no
submenu left to keep in sync with a taxonomy that no longer holds. `FUND_CHILDREN` and both `FundsMenu`
implementations (TopNav and MobileDrawer) are gone.

**It sits in `PublicLayout` beside `/about`** — marketing regardless of session. That is what gives it the
marketing footer whether or not somebody is signed in, which is the point: a signed-in user asking how
withdrawals work wants the same page as a visitor, and the support and legal links that come with it.

**The copy lives in a separate file, as data.** Nineteen answers inlined into JSX would put layout and copy
in one 700-line component and make every wording change a markup edit. `body` is an array of blocks rather
than a string because one answer is a list and the rest are paragraphs — a single string would need a
markdown renderer or `dangerouslySetInnerHTML` for two shapes. The 01–19 numbering is **computed**, since
it runs across categories and hand-written numbers would all need renumbering the moment a question is
inserted anywhere but the end.

**The rail scrolls to a heading, it does not filter.** Filtering would hide eighteen-nineteenths of the
page behind a click and break Cmd-F, which on a page of answers is the search people actually reach for.
Its active state is driven by an `IntersectionObserver` rather than by clicks: set on click alone it keeps
pointing at whatever was pressed last the moment somebody scrolls instead. `scroll-mt-24` on each heading
is load-bearing — the nav is sticky at 65px, so without it an anchor jump lands the heading *underneath*
it. On mobile the rail becomes a horizontally scrolling chip strip, and the active chip is scrolled into
view or it silently drifts off the left edge.

**Multiple answers may be open at once**, which is a departure from the usual accordion and deliberate:
these are reference material, and somebody comparing "what documents" against "how long it takes" has to
hold two answers at once. Nothing here is a wizard step.

**`grid-template-rows: 0fr → 1fr` is what animates the open.** `height: auto` is not animatable, and the
usual `max-height` workaround makes every short answer open at the speed of the longest one because the
transition spends most of its duration crossing empty space — these answers run from two lines to eight.
The `+` rotates 135° into a `×` rather than swapping two icons: a swap has no in-between state, so the
control would change on one frame while the panel takes 300ms.

**The closing CTA is light, and the first version was not.** On ink it butted straight into the marketing
footer, which is also ink — two dark bands with nothing between them read as one shapeless block with a
hole in the middle, and the closing ask disappeared into the site furniture below it.

**The copy describes a product this is not**, the same way About's does and more so: identity verification,
government ID, gold, mutual funds, fee schedules and real withdrawals. Gold and mutual funds have no model
anywhere in `server/src/models`, and there is no KYC flow. It is carried as supplied, like About's — but it
is worth knowing that this page makes regulatory-sounding claims (verification, compliance checks, fee
disclosures) that nothing in the codebase implements.

### The About page

`/about` is the Landing hero's "Learn more" destination and the footer's Company → About. It is built from
a supplied consulting-site reference that has exactly three section archetypes — hero card, alternating
photo/copy split, card grid with the first card filled — and it reuses those three rather than inventing a
shape per section. Photography is in `assets/images/about-*.webp`, cropped from the `cosmos_*` sources in
`assets/brand/`.

Two sections opt out of the archetypes, each for a stated reason. Security is centred because there is no
sixth photograph — five are in use and the only unused source is a pharmaceutical dashboard — and repeating
one would read as a mistake. The closing section runs video.

Two things in it are worth knowing before editing, both about claims rather than code:

- **The hero figures are supplied marketing numbers, not measurements.** `$3B+` volume, `500K+` investors,
  `$1.2B+` assets — nothing in the app produces them and no endpoint is behind them. They replaced a row
  that *was* live (exchange count and listing totals off `/market/exchanges`). `CountUp` animates them on
  first scroll into view, once, and renders the final value immediately under `prefers-reduced-motion`.
- **The copy sells a multi-asset platform the product is not.** "Access the Markets That Matter" describes
  stocks, crypto, gold and mutual funds; the app trades equities and nothing else, and there is no crypto,
  commodity or fund model in `server/src/models`. Three of those four cards describe things that do not
  exist. The copy is the client's, carried as given except that "Hyperstock" is written "HyperStocks" to
  match the wordmark above it.

A stretch grid item with a percentage height and an intrinsic aspect ratio resolves to its **own** natural
size, not the row's — so `h-full` on an `<img>` grows the row instead of fitting it. The hero photo is
absolutely positioned inside a wrapper with no intrinsic height, which is what makes the two columns end
level; the `Split` sections do use `lg:h-full` because there the copy is reliably the taller side.

**The closing section runs video** (`assets/video/markets-loop.mp4`, re-encoded from 4.5MB to 1.0MB at
CRF 34 — it plays under a scrim, so the quality it would otherwise carry is invisible). `VideoBackdrop`
deliberately has **no `autoPlay`**: that would download a megabyte on page load for a section three screens
down. `preload="none"` plus `play()` on intersection means only someone about to see it pays. The poster is
load-bearing, not decoration — it is what renders under `prefers-reduced-motion` and when a browser refuses
the `play()` call.

**The `bg-ink/80` scrim over it is an accessibility requirement, not a look.** The footage runs bright
candles and a white line chart through the middle of the frame, exactly where the copy sits. Measured on
the rendered video across a full loop, at the 99.9th percentile of brightness inside the text box: white
heading 10.9:1, `white/85` body 7.8:1. `--color-text-on-deep-muted` — the token every *other* dark surface
here uses — fails AA over this video at any scrim weak enough to leave the footage visible, which is why
this one section's body copy is a different colour from the ink section above it.

### Auth — Better Auth owns it

`server/src/auth/betterAuth.js`, mounted in `app.js`. The hand-rolled JWT layer is gone:
`routes/auth.routes.js`, `lib/jwt.js` and `models/RefreshToken.js` are deleted, and the client's
memory-held access token and single-flight refresh went with them.

**IT WRITES THE SAME `users` COLLECTION THE REST OF THE APP READS, which is the whole reason this was
cheap.** Two facts carry it:

- **`usePlural: true`** maps Better Auth's singular defaults onto `users`, `sessions`, `accounts` and
  `verifications`. Without it the adapter builds a second, empty `user` collection beside the populated one
  and the leaderboard ranks nobody.
- **The Mongo adapter stores ids as real `ObjectId`s.** It coerces `_id` and any field referencing `id` on
  write and converts back to a hex string on read. So the **eleven Mongoose models holding `ObjectId` refs
  to `User`** — Deposit, Holding, LedgerEntry, Order, PortfolioSnapshot, TopUpRequest, Transaction,
  WatchlistItem, Withdrawal, FeaturedTrader — and the leaderboard's `$lookup` all keep working untouched. A
  string-id adapter would have meant re-keying every one of them.

**CREDENTIALS LIVE IN `accounts`, NOT ON THE USER, and that is what makes the seed coherent.** A `users`
row with no `accounts` row beside it cannot sign in but still ranks, still holds positions and still
carries a `tradeCount` — which is exactly what the **207 leaderboard fixtures** are. Only `jd_trader` and
`admin` get a credential. `test/auth.test.js` pins both directions: a fixture trader's sign-in is 401, and
no fixture ever gains an `accounts` row.

**bcrypt is kept rather than Better Auth's scrypt default.** `config/db.js`'s `migrateLegacyCredentials()`
copies the existing `users.passwordHash` straight into `accounts.password` for the two demo accounts, so
jd_trader keeps working — there is no mail sender in this repo, so an account that cannot verify its old
password has no route back in. Legacy hashes are cost 10, new signups cost 12; bcrypt encodes cost in the
hash, so the two coexist without invalidating anything.

**`input: false` ON EVERY ADDITIONAL FIELD IS A PRIVILEGE-ESCALATION GUARD, not tidiness.** Sign-up is a
public endpoint that would otherwise accept arbitrary user columns — `{"role":"admin"}` makes an
administrator and `{"cashBalanceCents":999999999}` mints money, both unauthenticated. A test posts exactly
that payload and asserts none of it lands.

**THE HANDLER MOUNTS BEFORE `express.json()`.** `toNodeHandler` reads the raw request stream itself; a body
parser in front of it has already consumed that stream, so every sign-in arrives with an empty body and
fails as **bad credentials** — which reads as a wrong password rather than a middleware ordering bug. It
also sits ahead of `mongoSanitize`, which rewrites `$` and `.` keys. `/api/auth/*` is the Express 4
wildcard; on Express 5 it must become `/api/auth/*splat`.

**MONGODB CANNOT CREATE A COLLECTION *OR AN INDEX* INSIDE A TRANSACTION, and this bit twice.** Better Auth
wraps signup in one (user and account are written together, correctly). On a fresh database the implicit
creation of `accounts` fails with *"Unable to write … due to catalog changes"* — so **the very first signup
on a new deployment fails and the second succeeds**, because the failed attempt is what created the
collection. Observed live: the first signup 500'd, the next worked. Fixing the collection exposed the same
trap again in the index the adapter builds lazily (`accounts_issuer_accountId_uidx`).
`ensureAuthCollections()` creates both at boot, outside any transaction. It is the worst shape of bug —
it never reproduces for whoever is testing, only for the first real person through the door.

Two client details, one carried over and one retired:

- `AuthProvider` still exposes **`authReady`** and `ProtectedRoute` must still wait on it. The cookie is
  present immediately but whether it is a valid session is a round trip, so without this a hard refresh
  bounces a signed-in user to `/auth`. Verified: reloading `/portfolio` stays signed in.
- **The single-flight refresh is gone and nothing replaces it.** It existed because refresh tokens rotated
  on use and the dashboard's concurrent 401s would each spend the same one. A cookie the browser manages
  cannot race with itself. The trade is real and worth naming: the old access token lived in memory where
  an XSS could not reach it, while an httpOnly cookie is unreadable by script but sent automatically — so
  CSRF becomes the exposure instead, which `SameSite=Lax` plus Better Auth's `Origin` check covers.
  Measured: a state-changing POST carrying the session cookie but no trusted `Origin` is **403**.

**`BETTER_AUTH_SECRET` has a `min(32)` floor** because that is Better Auth's own — below it the library
logs a low-entropy warning at every boot, and a warning nobody can act on is one everybody learns to
ignore. `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` remain in the env schema, unread, only because deployed
`.env` files still carry them.

**`driverInfoList` — the two `mongodb` copies.** mongoose nests its own driver (6.20.0) beside the one the
adapter resolves (6.21.0). Same object at runtime, nominally distinct to `checkJs`, so the adapter call
carries two narrow `/** @type {any} */` casts. Narrower than a dedupe that would pin mongoose's driver to
the adapter's.

**Still not built: Google OAuth.** The provider slot is what Better Auth was adopted for and nothing is
configured in it yet. Email verification, password reset and magic links are all equally inert until
something can send mail — `requireEmailVerification` is explicitly `false` for that reason, named rather
than defaulted into.

### Tailwind v4 theme

`client/src/styles/theme.css` is CSS-first `@theme`, no config file.

**Poppins is the heading face, and only the heading face.** `--font-display` leads with it;
`--font-body` and `--font-mono` stay on the system/mono stacks, because Poppins is a display face —
wide, big x-height — and it turns dense 13px table UI mushy. The `<link>` lives in `client/index.html`,
not an `@import` in `theme.css`, which would serialise the font fetch behind the app stylesheet. The
system stack stays behind Poppins in the list on purpose — `display=swap` means that fallback is what
paints for the first few hundred ms.

**The marketing title rung does not survive the dashboard, which is why there are two.** App page h1s used
`title` (32px/500) and it was wrong twice over. Measured on `/portfolio`: 32px made the label the largest
thing on the screen, half again the headline figure it introduces (the value renders at 24px), so the
caption outranked the number the page exists to show. And at 500 it was the only Poppins on that screen not
at 700 — a display face one step lighter than everything around it reads as a *different font*, not as the
same font at a lower rank, which is exactly how it was reported. App titles are now **`text-xl font-bold`**
(24px/700): a 1.5× jump down to the panel headers, and below the headline number where a label belongs.
About's section h2s and Auth keep `title` — marketing is where 32px/500 works.

**Poppins has no variable face on Google Fonts** — `wght@300..700` returns an HTML error page, not CSS.
Weights are therefore enumerated (`wght@500;700`) and *only those two exist at runtime*: 500 section
`h2`, 700 hero and panel header. A heading given a weight that is not in that list does not fail loudly;
CSS font matching substitutes the nearest available one it has. Adding a heading weight means editing
the `<link>` first — `font-light` on a heading today would render at 500, not 300.

Three deliberate departures:

- `--text-*: initial` is **mandatory**. In v4 that namespace means *font size*, but the source design system
  names two colours `--text-body`/`--text-muted`. They are renamed `--color-text-*` here.
- `--radius-*` and `--shadow-*` are wiped then redefined, so the system's "one radius, one shadow" rule
  can't be violated — `shadow-lg` does not compile. The radius scale was widened upward for the dashboard
  redesign. **`rounded-full` is the exception**: it is a static utility in v4 (`calc(infinity * 1px)`), not
  read from `--radius-*`, so wiping the namespace does not remove it. Three sanctioned uses, all owned by a
  component or a single call site rather than passed through `className`: `Button`'s `pill` prop, the
  `Eyebrow` component (About's section labels), and the Landing security section's capsule heading — a
  capsule by definition, where any other radius stops being the thing.
- `--spacing: 4px` reaches every value on the 8px grid via the standard numeric scale, so arbitrary values
  like `max-w-[1200px]` have canonical forms (`max-w-300`). The linter flags these.

## AGENTS.md compliance

`AGENTS.md` is the engineering standard for this repo. One retrofit pass has been done, covering data
integrity and security: money → integer cents, `helmet`, `express-mongo-sanitize`, zod moved out of
handlers into `middleware/validate.js`, and a 300ms debounce on search.

**Knowingly still outstanding**, deferred by an explicit decision rather than overlooked:

- ~~Auth is hand-rolled JWT, not Better Auth~~ — **done**, see the Auth section. Google OAuth is still
  unconfigured, which is now a provider slot rather than a missing library.
- No `/controllers` or `/utils` on the server; no `/context` or `/components/features` on the client
- Twelve files exceed the 150-line limit (`seed.js` 872, `Landing.jsx` 589, `About.jsx` 577,
  `Portfolio.jsx` 431), and several hold multiple components in one file against one-per-file. The
  marketing pages are the worst of it: they are long because each section is a local component with the
  rationale for its layout written above it, and splitting them into a file each would scatter that.
- No `React.lazy` routes, no dynamic chart imports, no table virtualization
- No `auditLogs` collection, no `deletedAt` soft deletes, no `portfolios` collection
- `leaderboardSnapshots` is an in-memory 60s memo, not a cached collection

## Not built yet

**THERE IS A WITHDRAWAL WORKFLOW NOW, AND STILL NO CUSTODY BEHIND IT.** That distinction is the single most
important thing to know before either money path is enabled anywhere real. `/api/withdrawals` is complete —
state machine, holds, reversals, review queue, per-chain address validation — but **nothing in this
repository sends anything**: `approveWithdrawal` records that an operator sent funds by hand and what hash
came back. There is no wallet, no signing key, no chain client. Every position the product opens is still
*simulated*, and the footer on every screen says so, so a live deposit against a live payout would mean
real value in and real value out across a ledger that was never backed by a treasury. `WITHDRAWALS_ENABLED`
defaults to **false** and `DEPOSIT_DESTINATIONS` defaults to **empty**; those two defaults are what keep
the gap from being reachable by accident. What is still missing is custody, chain monitoring, and
reconciliation against an actual wallet.

The Wallet screen and the limit-order sweeper. **The admin screens exist now** — `/admin/approvals` drives
all three review queues and `/admin/featured-traders` curates the board, both behind an `adminOnly` route
and an admin-filtered nav entry. **`/admin/users` now lists every account** and is the only place that says
which of them can actually sign in. What is still missing on the admin side is stock management and
announcements; on the user side, a Wallet page listing a trader's own transactions and requests.

Shipped since: `/news`, the watchlist, candle charts, the instrument terminal, and **order execution
across all three asset classes** — `/orders` fills market buys and sells in stocks, crypto and forex
against one ledger, with fractional quantities and nanos pricing for the two classes cents could not
represent. `Order` and `Transaction` are written on every fill.

Equity candles are real on NYSE and NASDAQ via Twelve Data; the other six venues stay simulated because
no free plan sells them, not because the plumbing is missing — `candles.service.js` picks an adapter per
class and per venue.

**The Portfolio page's position chart is TradingView candles too**, on the same `TvChart` and the same
`useLiveCandles` hook the terminal uses — so the forming bar is patched from the tick stream there as well.
It had been calling the EQUITY routes (`/market/stocks/:symbol` plus a second call for candles), which
404 the moment a holding is a coin; it now goes through the one class-aware endpoint, which also makes it
one request instead of two. The holdings table keys on `${assetClass}:${symbol}` and formats quantities
through `qty()` — printing `h.shares` raw is how `0.30000000000000004` reaches the user.

The approved build plan lives at `~/.claude/plans/proud-gathering-dongarra.md`.

## Verifying UI changes

Authenticated pages can't be screenshotted by navigating alone. The pattern used during development: log in
over HTTP to get the refresh cookie, inject it into headless Chrome via CDP (`Network.setCookie`), then
navigate and `Page.captureScreenshot`. Node 22 has `fetch` and `WebSocket` globally, so this needs no
dependencies. Check layouts at 1920, 1024 and 414 — regressions here have been real and repeated.

**Log in fresh for every Chrome run.** Refresh tokens rotate on use and reuse revokes the whole family, so
replaying a saved cookie jar across two runs correctly trips `REFRESH_REUSED` — and the page then renders
*signed out* while every screenshot still looks plausible. The symptom is a probe that reports the
anonymous variant of a control; the cause is not the cookie failing to reach the server. If in doubt,
`fetch('/api/auth/refresh')` from inside the page and read the code.
