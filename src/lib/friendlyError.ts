/**
 * Turns an internal refusal into something a customer can act on.
 *
 * The messages these replace were written for whoever would have to fix the
 * problem, and they are good messages for that — "0.45 USDC can reach the
 * treasury (0.42 on-chain, 0.02 in the omnibus), a further 2.00 sits in the
 * nTZS settlement float" tells the desk exactly where the money is. It tells
 * a customer that something has gone wrong in a place they have never heard
 * of, using three words for their own balance.
 *
 * So the raw text is kept — on the order row, in the desk's tables, in the
 * mail that goes to ops — and this is what is shown on a receipt. Every entry
 * answers the only two questions the reader has: did my money move, and what
 * do I do now.
 *
 * Anything unrecognised is returned as it is. A wrong plain-English guess
 * would be worse than an honest technical sentence, and a message nobody has
 * written a rule for is usually a message worth reading.
 */
type Rule = { match: RegExp; say: string };

const RULES: Rule[] = [
  {
    // The float that backs balances but cannot be transferred out.
    match: /settlement float|can reach the treasury|in the omnibus/i,
    say: "CAPX could not reach enough settled funds to place this trade just now. Nothing was taken from your balance. This usually clears within a few minutes — try again shortly.",
  },
  {
    match: /insufficient|balance is|you hold/i,
    say: "There was not enough in your balance for this. Nothing was taken.",
  },
  {
    match: /no route available|return amount is not enough|INSUFFICIENT_OUTPUT|slippage/i,
    say: "The market moved while this was being placed, so it was not filled. Nothing was taken from your balance. Try again in a moment.",
  },
  {
    match: /oracle mark|refusing to trade|price impact/i,
    say: "The price available was too far from the published mark, so CAPX refused the trade rather than fill it badly. Nothing was taken from your balance.",
  },
  {
    match: /reverted|nonce|gas|rpc|timeout|fetch failed/i,
    say: "This did not go through on the network. Nothing was taken from your balance. Try again shortly.",
  },
  {
    match: /no published price|price is unavailable|shilling rate/i,
    say: "The price for this security is not available right now, so nothing was traded. Try again shortly.",
  },
  {
    match: /trading is paused|solvenc/i,
    say: "Buying is paused while CAPX reconciles its holdings. Selling is unaffected, and this will reopen shortly.",
  },
  {
    match: /not verified|verify your identity|kyc/i,
    say: "Your account needs to be verified before this can go through.",
  },
];

export function friendlyError(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const text = raw.trim();
  if (!text) return null;
  for (const rule of RULES) if (rule.match.test(text)) return rule.say;
  return text;
}

/**
 * Whether the plain-English version is standing in for something longer.
 *
 * The receipt offers the original underneath when it is, because somebody
 * writing to support should be able to quote the thing the desk will
 * recognise.
 */
export function wasRewritten(raw: string | null | undefined): boolean {
  if (!raw) return false;
  return RULES.some((r) => r.match.test(raw));
}
