import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { get } from "../../lib/api";
import { keys } from "../../lib/queryClient";
import { money, pct } from "../../lib/format";
import notify from "../../lib/toast";
import Avatar from "../ui/Avatar";
import { ADMIN_BASE } from "../nav/navItems";

/**
 * Activity notices: a trader, a gain, at random.
 *
 * IT RENDERS NOTHING. Like `MarketNotices`, it is a driver — it holds a timer
 * and raises toasts through the one owner in `lib/toast.js`.
 *
 * EVERY FIGURE IS REAL LEADERBOARD DATA. The name, the cash gain, the
 * percentage and the symbol all come off `/leaderboard`, which is the same
 * source the board and Landing's panel render.
 */

/**
 * Between toasts. Random inside the band so the cadence is not a metronome.
 * @type {[number, number]}
 */
const GAP_MS = [14_000, 26_000];

/** A millisecond delay somewhere inside the band. */
const rand = ([lo, hi]) => lo + Math.random() * (hi - lo);

/** Before the first toast after initial mount. */
const FIRST_MS = 3_500;

const MIN_PCT = 0.05;
const MIN_CENTS = 500;

/** `trader_094` is a seeded handle, not a name. Format it, never invent one. */
function displayName(row, t) {
  const raw = row.name ?? row.displayName ?? row.username ?? "";
  const m = /^trader_(\d+)$/.exec(raw);
  return m ? t("liveGains.trader", { id: m[1] }) : raw;
}

export default function LiveGains() {
  const { t } = useTranslation();
  const { pathname } = useLocation();

  const onAdmin =
    pathname === ADMIN_BASE || pathname.startsWith(`${ADMIN_BASE}/`);
  const onAuth = pathname === "/auth" || pathname.startsWith("/auth/");

  const { data } = useQuery({
    queryKey: keys.liveGains,
    queryFn: () => get("/leaderboard?period=today&limit=50"),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    meta: { silent: true },
  });

  // The last trader shown, so the same one cannot appear twice running.
  const lastId = useRef(/** @type {string | null} */ (null));
  const timer = useRef(
    /** @type {ReturnType<typeof setTimeout> | undefined} */ (undefined)
  );

  useEffect(() => {
    if (onAdmin || onAuth) return undefined;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches)
      return undefined;

    const pool = (data?.top ?? []).filter((r) => {
      const p = r.best?.returnPct ?? r.dayChangePct ?? 0;
      const cents = r.best?.returnCents ?? r.dayChangeCents ?? 0;
      return p >= MIN_PCT && cents >= MIN_CENTS && r.best?.symbol;
    });
    if (pool.length < 2) return undefined;

    let cancelled = false;

    const show = () => {
      if (cancelled || onAdmin || onAuth) return;

      const eligible = pool.filter((r) => r.userId !== lastId.current);
      const row = eligible[Math.floor(Math.random() * eligible.length)];
      if (!row) return;
      lastId.current = row.userId;

      const amountCents =
        row.best?.returnCents && row.best.returnCents > 0
          ? row.best.returnCents
          : row.dayChangeCents;
      const returnPct =
        row.best?.returnPct && row.best.returnPct > 0
          ? row.best.returnPct
          : row.dayChangePct;

      notify.custom(
        (tt) => (
          <div
            className={`flex items-center gap-3 rounded-md border border-cool-grey bg-white p-3 shadow-card ${
              tt.visible ? "animate-rise" : "opacity-0"
            }`}
          >
            <Avatar
              name={row.displayName || row.username || ""}
              src={row.avatarUrl}
              size={36}
            />

            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-void">
                {displayName(row, t)}
              </div>
              <div className="font-numeric text-xs tabular-nums text-text-muted">
                <span className="font-semibold text-gain">
                  {t("liveGains.summary", {
                    amount: money(amountCents, "USD", { signed: true }),
                    symbol: row.best.symbol,
                  })}
                </span>{" "}
                <span className="text-text-muted">{pct(returnPct)}</span>
              </div>
            </div>
          </div>
        ),
        { id: "live-gain", duration: 5_000 }
      );

      timer.current = setTimeout(show, rand(GAP_MS));
    };

    timer.current = setTimeout(show, FIRST_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer.current);
      notify.dismiss("live-gain");
    };
  }, [data, t, onAdmin, onAuth]);

  return null;
}
