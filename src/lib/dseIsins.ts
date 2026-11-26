/**
 * The ISINs the Dar es Salaam Stock Exchange publishes for its listed
 * securities, as supplied by DSE in November 2026.
 *
 * Here so that nobody types one. The CSD identifies a security by its ISIN
 * alone, the Tanzanian codes differ by a digit or two in the middle — CRDB is
 * TZ1996100305 and DCB is TZ1996100214 — and a transposition produces another
 * real security rather than an error. Transcribing twelve characters by hand,
 * once per security, into the one field that decides which shares get
 * pledged, is a step worth removing rather than being careful about.
 *
 * Every entry below passes its own check digit, which is how the
 * transcription from DSE's table was verified: a single wrong character would
 * fail `checkIsin`, and there is a test asserting all of them pass.
 *
 * It is a default, not an authority. Migration fills only securities that
 * have none, so a value set on the desk always wins — and if DSE reissues a
 * code, the desk is where it gets corrected.
 */
export const DSE_ISINS: Readonly<Record<string, string>> = {
  AFRIPRISE: "TZ1996103010",
  CRDB: "TZ1996100305",
  DSE: "TZ1996102434",
  DCB: "TZ1996100214",
  EABL: "KE0000000216",
  JATU: "TZ1996103804",
  JHL: "KE0000000273",
  KCB: "KE0000000315",
  KA: "KE0000000307",
  MBP: "TZ1996101683",
  MCB: "TZ1996102129",
  MKCB: "TZ1996101972",
  MUCOBA: "TZ1996102418",
  NMG: "KE0000000380",
  NICO: "TZ1996103077",
  NMB: "TZ1996100222",
  PAL: "TZ1996101048",
  SWALA: "TZ1996101865",
  SWIS: "TZ1996100040",
  TCCL: "TZ1996100057",
  TCC: "TZ1996100032",
  TTP: "TZ1996100065",
  TBL: "TZ1996100016",
  TOL: "TZ1996100008",
  TPCC: "TZ1996100024",
  USL: "KE0000000489",
  VODA: "TZ1996102715",
  YETU: "TZ1996102343",
} as const;
