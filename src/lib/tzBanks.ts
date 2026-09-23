import "server-only";

/**
 * Every bank licensed to operate in Tanzania, with the short code a payout
 * rail is likely to know it by.
 *
 * These are candidates, not facts. The names come from the Bank of Tanzania's
 * register and are checkable; the codes follow the convention nTZS's own
 * examples use — CRDB, NMB, NBC — and the one other Tanzanian disbursement
 * API that publishes its list, where ABSA, CRDB and NMB appear in exactly
 * this form. But nobody publishes the whole mapping, and a guessed code shown
 * to somebody as a bank is how money goes to the wrong place.
 *
 * So nothing here reaches a customer until nTZS has confirmed it. The desk
 * probes each candidate against the withdrawal quote — which prices a payout
 * and moves nothing — and only codes the rail actually recognises are kept.
 * Guess in private, verify against the authority, publish what passed.
 */
export type BankCandidate = { code: string; name: string };

export const TZ_BANK_CANDIDATES: BankCandidate[] = [
  // The three nTZS names in its own documentation, so they lead.
  { code: "CRDB", name: "CRDB Bank" },
  { code: "NMB", name: "NMB Bank" },
  { code: "NBC", name: "NBC Bank" },

  { code: "ABSA", name: "Absa Bank Tanzania" },
  { code: "STANBIC", name: "Stanbic Bank Tanzania" },
  { code: "SCB", name: "Standard Chartered Bank Tanzania" },
  { code: "CITI", name: "Citibank Tanzania" },
  { code: "EXIM", name: "Exim Bank Tanzania" },
  { code: "DTB", name: "Diamond Trust Bank Tanzania" },
  { code: "IMBANK", name: "I&M Bank Tanzania" },
  { code: "KCB", name: "KCB Bank Tanzania" },
  { code: "EQUITY", name: "Equity Bank Tanzania" },
  { code: "AZANIA", name: "Azania Bank" },
  { code: "AKIBA", name: "Akiba Commercial Bank" },
  { code: "AMANA", name: "Amana Bank" },
  { code: "MKOMBOZI", name: "Mkombozi Commercial Bank" },
  { code: "MAENDELEO", name: "Maendeleo Bank" },
  { code: "TCB", name: "Tanzania Commercial Bank" },
  { code: "LETSHEGO", name: "Letshego Bank Tanzania" },
  { code: "ACCESS", name: "Access Bank Tanzania" },
  { code: "BOA", name: "Bank of Africa Tanzania" },
  { code: "ECOBANK", name: "Ecobank Tanzania" },
  { code: "UBA", name: "UBA Tanzania" },
  { code: "HABIB", name: "Habib African Bank" },
  { code: "BOB", name: "Bank of Baroda Tanzania" },
  { code: "BOI", name: "Bank of India Tanzania" },
  { code: "CBA", name: "NCBA Bank Tanzania" },
  { code: "NCBA", name: "NCBA Bank Tanzania" },
  { code: "GTBANK", name: "Guaranty Trust Bank Tanzania" },
  { code: "FINCA", name: "FINCA Microfinance Bank" },
  { code: "SELCOM", name: "Selcom Microfinance Bank" },
  { code: "DCB", name: "DCB Commercial Bank" },
  { code: "MWANGA", name: "Mwanga Hakika Bank" },
  { code: "UCHUMI", name: "Uchumi Commercial Bank" },
  { code: "YETU", name: "Yetu Microfinance Bank" },
  { code: "CANARA", name: "Canara Bank Tanzania" },
  { code: "ICB", name: "International Commercial Bank" },
  { code: "ABC", name: "African Banking Corporation" },
  { code: "EFC", name: "EFC Tanzania Microfinance Bank" },
  { code: "KILIMANJARO", name: "Kilimanjaro Co-operative Bank" },
  { code: "MUCOBA", name: "Mucoba Bank" },
  { code: "TIB", name: "TIB Development Bank" },
];
