/**
 * Who stands behind a US tokenised share, from the issuer's own prospectus.
 *
 * Not "server-only": the market page shows this to the person buying, and the
 * partner API returns it to a reseller answering their own regulator. Both
 * read it from here so the two can never say different things about the same
 * arrangement — a fact kept in two places is a fact that eventually disagrees
 * with itself.
 *
 * Every line is from the ADGM prospectus (Coinbase Onchain SPV Ltd), not from
 * the marketing pages. That distinction earns its keep in the last two
 * fields: "backed 1:1, verifiable onchain" is the copy, and it is not quite
 * what the document says.
 *
 * CAPX attests to nothing here and must not appear to. CAPX buys these tokens
 * and holds them; what CAPX answers for is its own treasury balance against
 * what its customers are owed, which is checked separately and continuously.
 * This block is the layer underneath that, and it is somebody else's.
 */
export const B20_ISSUER = {
  spv: "Coinbase Onchain SPV Ltd",
  spvDetail: "ADGM company no. 37941, incorporated 17 June 2026",
  custodian: "Alpaca Securities LLC",
  custodianDetail: "SEC-registered broker-dealer, FINRA and SIPC member",
  custody: "Segregated accounts in the issuer's name, held on trust for holders "
         + "under a deed of trust",
  auditor: "Deloitte & Touche (M.E.) LLP",
  /* There are no audited accounts yet, and saying so is the point. */
  auditStatus: "First audited accounts cover the year ending 31 December 2026",
  reconciliation: "Intraday, by Onchain Marketplace Ltd as an FSRA-authorised CSD, "
                + "against its Legal Register",
  regulator: "Financial Services Regulatory Authority, Abu Dhabi Global Market",

  /**
   * The two things an integrator or a customer would otherwise assume wrongly.
   *
   * The chain is evidence of title, not the record of it: the prospectus is
   * explicit that the issuer's Legal Register prevails over onchain data. And
   * no proof-of-reserves attestation is published — the words "attestation"
   * and "proof of reserve" do not appear in the document at all. What exists
   * is a regulated structure and an annual audit, which is a different and
   * weaker claim than a reserve feed anyone can poll.
   */
  caveat: "The issuer's Legal Register, not the chain, is the definitive record of title "
        + "and prevails over onchain data. No proof-of-reserves attestation is published: "
        + "what exists is segregated custody, intraday reconciliation by a regulated CSD, "
        + "and an annual audit.",

  prospectusUrl: (symbol: string) =>
    `https://api.coinbase.com/v1/tokenized-stocks/prospectus/${symbol}.pdf`,
} as const;
