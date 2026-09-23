import type { Metadata } from "next";
import { LegalPage, type Section } from "@/components/LegalPage";

export const metadata: Metadata = {
  title: "Terms of service",
  description: "The agreement between you and CAPX: what we hold, what we do not, and what can go wrong.",
};

const SECTIONS: Section[] = [
  {
    h: "Who we are, and what we are not",
    p: [
      "CAPX is operated by NEDA Labs, a company registered in Tanzania. We provide an interface to tokenised equities issued on the Base blockchain, and a custodial account funded in Tanzanian shillings.",
      "CAPX is not a bank, a broker-dealer, a securities exchange, an investment adviser or a fund manager. We do not give investment advice, we do not recommend securities, and nothing on this platform should be read as a recommendation to buy or sell anything.",
      "We are not currently licensed by the Capital Markets and Securities Authority. If that changes, these terms change with it.",
    ],
  },
  {
    h: "What an account is",
    p: [
      "There are two ways to hold assets through CAPX, and they are meaningfully different.",
      "If you connect your own wallet, you keep your own keys. CAPX holds nothing, signs nothing and cannot move your assets. We only read the blockchain and show you what is there.",
      "If you fund an account with shillings, the account is custodial. CAPX holds the assets and records what you are owed in its own ledger. Your balance is a claim against us, not a token in your possession. This is the trade-off for not needing a wallet, and you should understand it before you deposit.",
    ],
  },
  {
    h: "Eligibility",
    p: [
      "You must be at least eighteen years old and legally able to enter a contract.",
      "Tokenised equities are not available to United States persons. By opening an account you confirm you are not one.",
      "We may refuse, suspend or close an account where we are required to, where identity cannot be verified, or where we reasonably believe the account is being used unlawfully.",
    ],
  },
  {
    h: "Verifying your identity",
    p: [
      "Before you can use a custodial account fully you must verify your identity by submitting a photograph of a government-issued document and a photograph of yourself taken at the time.",
      "You confirm that the documents you submit are genuine, are yours, and have not been altered. Submitting someone else's document, or a forged one, is a criminal offence and will result in the account being closed and reported.",
      "We may ask for further information at any time where we are required to by anti-money-laundering rules.",
    ],
  },
  {
    h: "Deposits, withdrawals and settlement",
    p: [
      "Deposits are made by mobile money or bank transfer in Tanzanian shillings and are credited once they clear. Settlement is in nTZS, a shilling-denominated stablecoin.",
      "Withdrawals are paid to the mobile money number on your account and are subject to a minimum amount, shown at the time.",
      "We do not guarantee that a deposit, withdrawal or trade will complete at a particular time. Mobile money networks, banks and blockchains all fail sometimes, and when they do we will tell you what happened rather than leave you guessing.",
    ],
  },
  {
    h: "Prices and how trades are executed",
    p: [
      "Tanzanian securities are priced from the Dar es Salaam Stock Exchange's own published figures — the live session price while the market is open, and the last published close when it is not. US equities are priced from Chainlink total-return feeds read from the blockchain.",
      "A price shown before you confirm an order is indicative. The price you receive is the one recorded at execution.",
      "We may refuse to execute an order, including where an asset has no market, where the available price is too far from the reference mark to be fair to you, or where client assets are not fully backed.",
    ],
  },
  {
    h: "Fees",
    p: [
      "CAPX charges 1% on the cash side of each trade, shown on the ticket before you confirm. There is no separate custody or account fee.",
      "Network fees on the blockchain are paid by CAPX for custodial accounts. If you connect your own wallet, you pay your own network fees.",
      "We will tell you before a fee changes. A change never applies to a trade already placed.",
    ],
  },
  {
    h: "What backs your balance",
    p: [
      "Every share recorded against a custodial account is backed by a token CAPX holds, and every shilling by a shilling in the settlement account. Both are published and can be checked by anyone at capx.broker/proof.",
      "Tokenised Tanzanian securities are additionally backed by shares held in custody, with the custody position published on the blockchain. Where that attestation expires or is withdrawn, issuance stops automatically.",
      "If client assets are ever not fully backed, new orders are refused until they are. That is enforced in code, not by policy.",
    ],
  },
  {
    h: "What your holding carries, and what it does not",
    p: [
      "A holding in a CAPX account is a representation, on the blockchain, of the underlying share. The share itself is held by a custodian or a special purpose vehicle, and the register at the exchange shows that entity rather than you. What you hold is exposure to its price, not registered shareholding.",
      "For Tanzanian securities, no dividends are passed through to your account and no voting or other governance rights attach to your holding. Where a dividend is paid on shares held in custody against CAPX tokens, it is received by the custodian and is not distributed to accounts. Your return, if any, comes from the price of the share.",
      "For US shares, the token is issued by a third party against shares held by its own custodian or special purpose vehicle, and dividends are carried through: they are reflected by an on-chain multiplier applied to the token rather than paid to you as cash, so the value reaches you without a payment arriving in your account. That is how those tokens work; it is not something CAPX decides. No voting rights attach there either.",
      "Neither kind of holding carries a right to attend a general meeting, to vote, to receive shareholder communications, or to be entered on the issuer's register. If those rights matter to you, buy the share itself through a licensed broker instead.",
    ],
  },
  {
    h: "Risks you are accepting",
    p: [
      "The value of shares can fall as well as rise, and you may get back less than you put in. Past performance tells you nothing about future returns.",
      "A tokenised US share is not permanently one share. Splits and dividends adjust an on-chain multiplier rather than your balance.",
      "This platform depends on things outside our control: the Base blockchain, the nTZS stablecoin, mobile money operators, the Dar es Salaam Stock Exchange's data, and price oracles. Any of them failing can delay or prevent a trade, a deposit or a withdrawal.",
      "Smart contracts can contain defects even when audited. The regulatory position of tokenised securities in Tanzania is still developing and may change in ways that affect this service.",
      "For a custodial account, you are exposed to CAPX as a counterparty. If CAPX became insolvent you would be a creditor, and the published backing is what you would be claiming against.",
    ],
  },
  {
    h: "Your responsibilities",
    p: [
      "Keep your password and your phone secure. Anyone with access to them can move your money.",
      "Keep your contact details current. We use them to reach you about deposits, withdrawals and your account.",
      "Do not use CAPX to launder money, evade sanctions, or on behalf of someone whose identity we have not verified.",
    ],
  },
  {
    h: "Suspension and closing an account",
    p: [
      "You may close your account at any time by withdrawing your balance and asking us to close it. Some records are kept afterwards where the law requires it.",
      "We may suspend an account where we reasonably suspect fraud, where a court or regulator requires it, or where verification has failed. Where we can tell you why, we will.",
    ],
  },
  {
    h: "Liability",
    p: [
      "Nothing in these terms limits our liability for fraud, for death or personal injury caused by negligence, or for anything else that cannot lawfully be excluded.",
      "Subject to that, we are not liable for losses caused by market movements, by your own decisions, or by failures of the third-party networks this service depends on.",
    ],
  },
  {
    h: "Changes, law and disputes",
    p: [
      "We may change these terms. Where a change materially affects you we will tell you before it takes effect, and continuing to use the account means you accept it.",
      "These terms are governed by the laws of the United Republic of Tanzania, and the courts of Tanzania have jurisdiction.",
      "If something has gone wrong, write to us first at support@capimon.app. Most problems are faster to fix than to argue about.",
    ],
  },
];

export default function TermsPage() {
  return (
    <LegalPage
      eyebrow="Legal"
      title="Terms of service"
      updated="Last updated 15 September 2026"
      intro="These terms are the agreement between you and CAPX. They are written to be read, not to be skipped, and they say plainly what we hold on your behalf and what can go wrong."
      sections={SECTIONS}
    />
  );
}
