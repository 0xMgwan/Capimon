export const usd = (n: number, dp = 2) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: dp, maximumFractionDigits: dp });

/**
 * Picks the unit *after* rounding, so 999,983 reads as $1.00M rather than $1000.0K.
 */
function unit(n: number, dp: number) {
  const abs = Math.abs(n);
  for (const [div, suffix] of [[1e9, "B"], [1e6, "M"], [1e3, "K"]] as const) {
    if (abs >= div * 0.9995) return { v: n / div, suffix, dp };
  }
  return { v: n, suffix: "", dp };
}

export function compactUsd(n: number) {
  const { v, suffix } = unit(n, 2);
  if (!suffix) return usd(n);
  return `$${v.toFixed(2)}${suffix}`;
}

export function compact(n: number, dp = 2) {
  const u = unit(n, dp);
  return `${u.v.toFixed(dp)}${u.suffix}`;
}

export const pct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;

export const short = (a?: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");

export function ago(ts: number) {
  const s = Math.max(0, Math.floor(Date.now() / 1000) - ts);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/**
 * Whether the underlying US session is live — which is not whether CAPX trades.
 *
 * B20 tokens trade on Aerodrome around the clock; it is the Chainlink
 * total-return feed that only publishes while the underlying market is open, so
 * outside those hours the marks are frozen rather than the venue shut. Labelling
 * that "Market closed" told customers they could not trade at exactly the times
 * they most often open the app, which was untrue.
 *
 * `open` therefore means "marks are updating", and the labels say what is
 * actually frozen.
 */
export function marketSession(now = new Date()) {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false,
  });
  const parts = Object.fromEntries(f.formatToParts(now).map((p) => [p.type, p.value]));
  const day = parts.weekday as string;
  const mins = Number(parts.hour) * 60 + Number(parts.minute);
  if (day === "Sat" || day === "Sun") return { open: false, label: "Weekend · marks held" as const };
  if (mins >= 570 && mins < 960) return { open: true, label: "Marks live" as const };
  if (mins >= 240 && mins < 570) return { open: false, label: "Pre-market · marks held" as const };
  if (mins >= 960 && mins < 1200) return { open: false, label: "After hours · marks held" as const };
  return { open: false, label: "Overnight · marks held" as const };
}
