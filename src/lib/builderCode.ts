import "server-only";
import { Attribution } from "ox/erc8021";

/**
 * Base Builder Code attribution, on everything the treasury signs.
 *
 * ERC-8021: the code is appended to a transaction's calldata as a suffix that
 * contracts never read. Execution is unchanged — the extra bytes sit past the
 * end of the arguments any function decodes — and offchain indexers pick the
 * attribution up afterwards. That is what puts CAPX's onchain volume on the
 * Base dashboard.
 *
 * The suffix is built from the code rather than written out, because the
 * encoding is a marker, a schema byte, a length byte and ASCII, and a
 * hand-copied hex string is a thing that silently stops matching the code it
 * is supposed to represent.
 *
 * ## What it costs and what it cannot break
 *
 * Twenty-eight non-zero bytes, so about 448 gas on a Base transaction —
 * nothing against a swap. The one way trailing calldata can matter is a
 * contract that reads past its own arguments, which the standard ones here do
 * not; if a router is ever added that does, this is the thing to suspect.
 *
 * Attribution is a claim about who sent a transaction, not a permission.
 * Nothing about the trade changes, no funds move differently, and the code is
 * public by design — it is on every transaction for anyone to read.
 */

/** Settable per deployment; the project's own code is the default. */
export const BUILDER_CODE = (process.env.BUILDER_CODE ?? "bc_ly695041").trim();

/**
 * Null when the code is cleared, so a deployment can turn attribution off by
 * setting BUILDER_CODE empty rather than by editing this file.
 */
export const BUILDER_SUFFIX: `0x${string}` | null = BUILDER_CODE
  ? Attribution.toDataSuffix({ codes: [BUILDER_CODE] })
  : null;

/** Reads the attribution back off a transaction's input, for verification. */
export function attributionOf(data: `0x${string}`): readonly string[] {
  try {
    return Attribution.fromData(data)?.codes ?? [];
  } catch {
    return [];
  }
}

/** Whether a transaction carries this deployment's code. */
export const isAttributed = (data: `0x${string}`) =>
  !!BUILDER_CODE && attributionOf(data).includes(BUILDER_CODE);
