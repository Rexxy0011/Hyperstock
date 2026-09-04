import { User } from "../models/User.js";
import { SEED_CASH_CENTS } from "../config/env.js";

const PERIOD_DAYS = { weekly: 7, monthly: 30 };

/** Memoised per period — the pipeline is cheap but not free, and the board
 *  does not need to be fresher than the 15s quote refresh anyway. */
const cache = new Map();
const TTL_MS = 60_000;

function baselineDate(period) {
  const days = PERIOD_DAYS[period];
  if (!days) return null;
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return new Date(d.getTime() - days * 86_400_000);
}

/** UTC midnight today — snapshots strictly before this are yesterday's mark. */
function startOfTodayUtc() {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/**
 * Ranks every trader by live portfolio value.
 *
 * Starts from User rather than Holding so that traders holding only cash still
 * appear — starting from Holding would silently drop them off the board.
 *
 * Period returns need a historical baseline, which is why PortfolioSnapshot
 * exists: weekly/monthly returns cannot be derived from current state alone.
 */
async function computeBoard(period) {
  const since = baselineDate(period);

  // Annotated because Mongoose types sort direction as the literal -1 | 1,
  // which a plain JS object literal widens to `number`.
  /** @type {import('mongoose').PipelineStage[]} */
  const pipeline = [
    { $match: { role: "user", status: { $ne: "Suspended" } } },

    // Value each user's positions at the mirrored USD price on Stock.
    {
      $lookup: {
        from: "holdings",
        let: { uid: "$_id" },
        pipeline: [
          { $match: { $expr: { $eq: ["$userId", "$$uid"] } } },
          {
            $lookup: {
              from: "stocks",
              localField: "symbol",
              foreignField: "symbol",
              as: "s",
            },
          },
          /**
           * TWO PRICE SOURCES, because a holding is no longer necessarily an
           * equity. This used to be `$unwind: '$s'`, which does not merely fail
           * to value a crypto position — it DELETES it from the pipeline, so a
           * trader half in Bitcoin ranked as though that half did not exist.
           * Exactly the failure the board already avoids by starting from
           * `User` rather than `Holding`.
           *
           * `marketprices` is the Mongo-side mirror of the vendor cache, which
           * a `$lookup` cannot otherwise see. See models/MarketPrice.js.
           */
          {
            $lookup: {
              from: "marketprices",
              let: {
                cls: { $ifNull: ["$assetClass", "stocks"] },
                sym: "$symbol",
              },
              pipeline: /** @type {any} */ ([
                {
                  $match: {
                    $expr: {
                      $and: [
                        { $eq: ["$assetClass", "$$cls"] },
                        { $eq: ["$symbol", "$$sym"] },
                      ],
                    },
                  },
                },
                { $project: { _id: 0, priceUsdNanos: 1, exchange: 1 } },
              ]),
              as: "m",
            },
          },
          {
            $addFields: {
              _s: { $first: "$s" },
              _m: { $first: "$m" },
            },
          },
          {
            $addFields: {
              // Nanos, so a sub-cent coin is not valued at zero. An equity's
              // nanos is its cents figure times 10^7 and therefore exact.
              _priceNanos: {
                $ifNull: [
                  "$_m.priceUsdNanos",
                  {
                    $multiply: [
                      { $ifNull: ["$_s.priceUsdCents", 0] },
                      10000000,
                    ],
                  },
                ],
              },
            },
          },
          // Replaces what `$unwind` used to do: a holding neither source can
          // price is still dropped, rather than being valued at nothing.
          { $match: { _priceNanos: { $gt: 0 } } },
          {
            $addFields: {
              /**
               * `$round` is load-bearing, not tidying. Without it this returns
               * a float and the board's ordering would rest on binary
               * representation; with it, an equity lands on exactly
               * `shares x priceUsdCents` — the integer this computed before —
               * so the seeded ranks the tests pin do not move.
               */
              _valueCents: {
                $round: [
                  {
                    $divide: [
                      { $multiply: ["$shares", "$_priceNanos"] },
                      10000000,
                    ],
                  },
                  0,
                ],
              },
            },
          },
          {
            $project: {
              _id: 0,
              symbol: 1,
              // Carried so the board can report how many venues a trader spans
              // without a second pass over holdings.
              exchange: { $ifNull: ["$_s.exchange", "$_m.exchange"] },
              valueCents: "$_valueCents",
              // Position return against its stored cost basis, not against a
              // derived per-share average — the basis is the figure actually paid.
              returnPct: {
                $cond: [
                  { $gt: ["$costBasisCents", 0] },
                  {
                    $multiply: [
                      {
                        $divide: [
                          { $subtract: ["$_valueCents", "$costBasisCents"] },
                          "$costBasisCents",
                        ],
                      },
                      100,
                    ],
                  },
                  0,
                ],
              },
            },
          },
        ],
        as: "h",
      },
    },
    {
      $addFields: {
        holdingsValueCents: { $sum: "$h.valueCents" },
        best: {
          $first: { $sortArray: { input: "$h", sortBy: { returnPct: -1 } } },
        },

        // Split the book into winning and losing positions, by VALUE rather
        // than by count: "3 of 5 up" says nothing if the two losers hold most
        // of the money. The bar is meant to show how much of the book is green.
        winValueCents: {
          $sum: {
            $map: {
              input: "$h",
              as: "p",
              in: {
                $cond: [{ $gte: ["$$p.returnPct", 0] }, "$$p.valueCents", 0],
              },
            },
          },
        },
        wins: {
          $size: {
            $filter: {
              input: "$h",
              as: "p",
              cond: { $gte: ["$$p.returnPct", 0] },
            },
          },
        },
        positions: { $size: "$h" },
      },
    },
    {
      $addFields: {
        portfolioValueCents: {
          $add: ["$cashBalanceCents", "$holdingsValueCents"],
        },
      },
    },

    // Yesterday's mark, for the day-over-day figure the board leads with. This
    // is separate from the weekly/monthly baseline below because it is needed
    // for every period, including all-time.
    {
      $lookup: {
        from: "portfoliosnapshots",
        let: { uid: "$_id" },
        pipeline:
          /** @type {import('mongoose').PipelineStage.FacetPipelineStage[]} */ ([
            {
              $match: {
                $expr: {
                  $and: [
                    { $eq: ["$userId", "$$uid"] },
                    { $lt: ["$date", startOfTodayUtc()] },
                  ],
                },
              },
            },
            { $sort: { date: -1 } },
            { $limit: 1 },
            { $project: { _id: 0, portfolioValueCents: 1 } },
          ]),
        as: "prevDay",
      },
    },
    {
      $addFields: {
        // Falling back to the seed grant yields the trader's actual return since
        // signup, rather than locking them at 0 until their first midnight passes.
        dayBaseValueCents: {
          $ifNull: [
            { $first: "$prevDay.portfolioValueCents" },
            SEED_CASH_CENTS,
          ],
        },
      },
    },
    {
      $addFields: {
        dayChangeCents: {
          $subtract: ["$portfolioValueCents", "$dayBaseValueCents"],
        },
        dayChangePct: {
          $cond: [
            { $gt: ["$dayBaseValueCents", 0] },
            {
              $multiply: [
                {
                  $divide: [
                    {
                      $subtract: ["$portfolioValueCents", "$dayBaseValueCents"],
                    },
                    "$dayBaseValueCents",
                  ],
                },
                100,
              ],
            },
            0,
          ],
        },
      },
    },

    // Baseline for weekly/monthly. All-time measures against the signup grant.
    ...(since
      ? [
          {
            $lookup: {
              from: "portfoliosnapshots",
              let: { uid: "$_id" },
              // Annotated separately: a nested pipeline's sort direction widens
              // to `number`, which does not satisfy Mongoose's -1 | 1 literal.
              pipeline:
                /** @type {import('mongoose').PipelineStage.FacetPipelineStage[]} */ ([
                  {
                    $match: {
                      $expr: {
                        $and: [
                          { $eq: ["$userId", "$$uid"] },
                          { $lte: ["$date", since] },
                        ],
                      },
                    },
                  },
                  { $sort: { date: -1 } },
                  { $limit: 1 },
                  { $project: { _id: 0, portfolioValueCents: 1 } },
                ]),
              as: "baseline",
            },
          },
          {
            $addFields: {
              baseValueCents: {
                $ifNull: [
                  { $first: "$baseline.portfolioValueCents" },
                  SEED_CASH_CENTS,
                ],
              },
            },
          },
        ]
      : [{ $addFields: { baseValueCents: SEED_CASH_CENTS } }]),

    {
      $addFields: {
        returnPct: {
          $cond: [
            { $gt: ["$baseValueCents", 0] },
            {
              $multiply: [
                {
                  $divide: [
                    { $subtract: ["$portfolioValueCents", "$baseValueCents"] },
                    "$baseValueCents",
                  ],
                },
                100,
              ],
            },
            0,
          ],
        },
      },
    },

    {
      $setWindowFields: {
        sortBy: { dayChangePct: -1 },
        output: { rank: { $rank: {} } },
      },
    },
    {
      $project: {
        _id: 0,
        userId: "$_id",
        username: 1,
        displayName: 1,
        rank: 1,
        trades: "$tradeCount",
        portfolioValueCents: "$portfolioValueCents",
        returnPct: { $round: ["$returnPct", 2] },
        dayChangeCents: "$dayChangeCents",
        dayChangePct: { $round: ["$dayChangePct", 2] },
        exchanges: { $size: { $setUnion: ["$h.exchange", []] } },
        wins: "$wins",
        positions: "$positions",
        winSharePct: {
          $round: [
            {
              $cond: [
                { $gt: ["$holdingsValueCents", 0] },
                {
                  $multiply: [
                    { $divide: ["$winValueCents", "$holdingsValueCents"] },
                    100,
                  ],
                },
                0,
              ],
            },
            1,
          ],
        },
        best: {
          symbol: "$best.symbol",
          returnPct: { $round: [{ $ifNull: ["$best.returnPct", 0] }, 2] },
        },
      },
    },
    { $sort: { rank: 1 } },
  ];

  return User.aggregate(pipeline);
}

async function getBoard(period) {
  const hit = cache.get(period);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.rows;

  const rows = await computeBoard(period);
  cache.set(period, { rows, at: Date.now() });
  return rows;
}

/** Clears the memo — called after an order fills so rank reacts immediately. */
export function invalidateLeaderboard() {
  cache.clear();
}

/**
 * The COMPUTED figures for a specific set of accounts, indexed by id.
 *
 * `/soap/users` needs each trader's real portfolio value and return so an
 * operator editing a row starts from what the board actually shows rather than
 * from an empty box. Running a second aggregation for that would be two owners
 * of one pipeline — and the two would drift, which on this screen means an
 * admin typing a "correction" against a number the leaderboard never displayed.
 *
 * So it reads the SAME memo the board reads. Usually a cache hit, and identical
 * by construction.
 *
 * PRE-MERGE, DELIBERATELY. These are the account's own computed figures, not
 * what the board currently displays for it — an already-overridden trader must
 * still be editable against reality, or each edit would compound on the last
 * and the original value would be unrecoverable.
 */
/**
 * Where a given figure would land on the board.
 *
 * IT IS COMPUTED HERE BECAUSE THE CLIENT CANNOT DO IT. The obvious version —
 * count the rows above this value in the leaderboard the admin already has —
 * is wrong, and wrong in a way that looks plausible: `/leaderboard` caps
 * `limit` at 100, so a trader ranked 190 was measured against a list that
 * stopped at 100 and the preview cheerfully reported rank 101. Every account
 * below the cut got the same meaningless answer. Raising the cap to fix a
 * preview would be widening a public endpoint for the admin's convenience.
 *
 * THE TRADER BEING EDITED IS EXCLUDED, AND NOT ONLY BY USER ID. Saving replaces
 * their row rather than adding one, so leaving it in ranks them against
 * themselves. The subtlety is that an ALREADY-overridden trader is on the board
 * as a curated row whose `userId` is the FeaturedTrader document's id, not
 * theirs — matching on the user id alone would miss it and report a rank one
 * too low for exactly the traders most likely to be edited again.
 */
export async function rankForValue(
  valueCents,
  { excludeUserId = null, period = "alltime" } = {}
) {
  const [computed, featured] = await Promise.all([
    getBoard(period),
    listActiveFeatured(),
  ]);

  const ownCurated = featured.find(
    (f) => String(f.userId) === String(excludeUserId)
  );
  const skip = new Set([String(excludeUserId), String(ownCurated?._id ?? "")]);

  const rows = mergeFeatured(computed, featured);
  const above = rows.filter(
    (r) => !skip.has(String(r.userId)) && r.portfolioValueCents > valueCents
  ).length;

  return { rank: above + 1, totalTraders: rows.length };
}

export async function computedRowsFor(userIds, period = "alltime") {
  const want = new Set(userIds.map(String));
  if (!want.size) return new Map();

  const rows = await getBoard(period);
  return new Map(
    rows
      .filter((r) => want.has(String(r.userId)))
      .map((r) => [String(r.userId), r])
  );
}

export async function getLeaderboard({
  period = "alltime",
  limit = 50,
  userId = null,
} = {}) {
  const computed = await getBoard(period);

  // `name` is what a row renders; `username` stays available as the handle.
  const decorate = (r) => {
    const name = r.displayName || r.username;
    return {
      ...r,
      userId: String(r.userId),
      name,
      avatarLetter: name[0].toUpperCase(),
    };
  };

  /**
   * Curated rows are merged AFTER the memo and BEFORE the slice.
   *
   * After, because the memo caches the aggregation over real accounts and an
   * admin edit has to show on the next poll rather than up to a minute later —
   * this collection is small and indexed, so reading it per request is cheaper
   * than invalidating a 208-row pipeline on every keystroke in the admin.
   *
   * Before, because the slice and the pinned `you` row both depend on final
   * position: merging afterwards would rank a signed-in trader against a board
   * that is not the one they are looking at.
   */
  const featured = await listActiveFeatured();
  const rows = mergeFeatured(computed.map(decorate), featured);

  const top = rows.slice(0, limit);

  // The design pins the signed-in user's own row beneath the top N (rank 128).
  let you = null;
  if (userId) {
    // Already decorated by the merge. A trader whose row has been overridden by
    // a curated one is deliberately not found here: their own row is no longer
    // on the board, so pinning it underneath would show them twice.
    const mine = rows.find(
      (r) => !r.featured && String(r.userId) === String(userId)
    );
    if (mine) you = { ...mine, you: true };
  }

  return {
    period,
    updatedAt: new Date().toISOString(),
    totalTraders: rows.length,
    top,
    you,
  };
}
