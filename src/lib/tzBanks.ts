import "server-only";

/**
 * The canonical FI codes nTZS pays banks by.
 *
 * nTZS's disbursement rail is Selcom's, and Selcom publishes the mapping in
 * its own developer reference under Qwiksend — "List of Bank Short Names".
 * That is the authority: not the Bank of Tanzania register, which names
 * banks but not codes, and not any convention that could be inferred from
 * three examples in a sentence.
 *
 * Inferring them is exactly what went wrong before. The real codes are not
 * the abbreviations anybody would guess — CRDB is CRDBBANK, Access Bank is
 * BANCABC, Equity is EQUITYBANK, and the Co-operative Bank answers to
 * KILIMANJARO — so a list built from intuition would have been wrong in
 * most of its rows while looking entirely plausible.
 *
 * Source: developers.selcommobile.com, Qwiksend § List of Bank Short Names.
 * Every one is marked as supporting name lookup, which is what lets a payout
 * be confirmed against the account holder before it is sent.
 */
export type BankCandidate = { code: string; name: string };

export const TZ_BANK_CANDIDATES: BankCandidate[] = [
  { code: "CRDBBANK", name: "CRDB Bank" },
  { code: "NMB", name: "NMB Bank" },
  { code: "NBC", name: "NBC Bank" },
  { code: "ABSA", name: "Absa Bank" },
  { code: "STANBIC", name: "Stanbic Bank Tanzania" },
  { code: "CITIBANK", name: "Citibank Tanzania" },
  { code: "EXIMBANK", name: "Exim Bank" },
  { code: "DTB", name: "Diamond Trust Bank" },
  { code: "IMBANK", name: "I&M Bank" },
  { code: "KCB", name: "KCB Bank Tanzania" },
  { code: "EQUITYBANK", name: "Equity Bank Tanzania" },
  { code: "AZANIA", name: "Azania Bank" },
  { code: "AKIBA", name: "Akiba Commercial Bank" },
  { code: "AMANABANK", name: "Amana Bank" },
  { code: "MKOMBOZI", name: "Mkombozi Commercial Bank" },
  { code: "MAENDELEO", name: "Maendeleo Bank" },
  { code: "TCB", name: "Tanzania Commercial Bank" },
  { code: "LETSHEGO", name: "Letshego Bank Tanzania" },
  { code: "BANCABC", name: "Access Bank Tanzania" },
  { code: "BOA", name: "Bank of Africa Tanzania" },
  { code: "ECOBANK", name: "Ecobank Tanzania" },
  { code: "UBA", name: "United Bank for Africa" },
  { code: "HABIBBANK", name: "Habib African Bank" },
  { code: "BANKOFBARODA", name: "Bank of Baroda Tanzania" },
  { code: "BANKOFINDIA", name: "Bank of India Tanzania" },
  { code: "NCBA", name: "NCBA Bank Tanzania" },
  { code: "GTBANK", name: "Guaranty Trust Bank Tanzania" },
  { code: "FINCA", name: "FINCA Microfinance Bank" },
  { code: "DCBBANK", name: "DCB Commercial Bank" },
  { code: "MWANGA", name: "Mwanga Hakika Microfinance Bank" },
  { code: "MWALIMU", name: "Mwalimu Commercial Bank" },
  { code: "UCHUMI", name: "Uchumi Commercial Bank" },
  { code: "PBZ", name: "People's Bank of Zanzibar" },
  { code: "KILIMANJARO", name: "Co-operative Bank Tanzania" },
  { code: "ICB", name: "International Commercial Bank" },
  { code: "CHINADASHENG", name: "China Dasheng Bank" },
  { code: "SPSCASHIN", name: "Selcom Microfinance Bank / Selcom Pesa" },

  /*
   * The short forms nTZS's own documentation uses.
   *
   * Its examples say CRDB and Selcom's list says CRDBBANK, which cannot both
   * be the code — one of them is an alias nTZS resolves, or the docs are
   * loose. Probed alongside the rest rather than assumed either way; whichever
   * the rail accepts is the one customers are offered.
   */
  { code: "CRDB", name: "CRDB Bank" },
  { code: "EXIM", name: "Exim Bank" },
  { code: "AMANA", name: "Amana Bank" },
  { code: "EQUITY", name: "Equity Bank Tanzania" },
  { code: "DCB", name: "DCB Commercial Bank" },
  { code: "HABIB", name: "Habib African Bank" },
];
