import type { Metadata } from "next";
import { LegalPage, type Section } from "@/components/LegalPage";

export const metadata: Metadata = {
  title: "Privacy policy",
  description: "What CAPX collects, why, who sees it, and how long it is kept.",
};

const SECTIONS: Section[] = [
  {
    h: "What we collect",
    p: [
      "Your name, email address, phone number and national identity number, because we cannot open a regulated account without them.",
      "A photograph of an identity document and a photograph of you, submitted during verification.",
      "Your transactions: deposits, withdrawals, trades and balances. This is the ledger, and it is the record of what we owe you.",
      "Basic technical information your browser sends, such as your approximate location from your IP address, used to keep the service running and to detect fraud.",
      "We do not run advertising trackers and we do not sell anything about you.",
    ],
  },
  {
    h: "Why we collect it",
    p: [
      "To operate your account: to credit deposits to the right person, to pay withdrawals to the right number, and to show you what you own.",
      "To meet anti-money-laundering and identity obligations, which is the only reason we ask for an identity document at all.",
      "To detect and prevent fraud against you and against other customers.",
      "To contact you about your money — a deposit that cleared, a withdrawal that failed, a verification that needs attention. We do not send marketing you did not ask for.",
    ],
  },
  {
    h: "Your identity documents specifically",
    p: [
      "The document photograph and selfie are stored in our database and are visible only to CAPX staff reviewing your verification. They are not shown to other customers, they are not published, and they are never included in any page anyone else can reach.",
      "They are served only through an access-controlled route and are not indexed or cached.",
      "We keep them after a decision because the evidence for a decision has to outlive the decision, and because anti-money-laundering rules require records to be retained. We are still settling the exact retention period; when it is fixed it will be stated here.",
    ],
  },
  {
    h: "Who else sees your data",
    p: [
      "nTZS, our settlement partner, receives the identity details needed to operate your shilling wallet and to process deposits and withdrawals.",
      "Mobile money operators and banks receive the details needed to move your money.",
      "Our hosting and database providers store the data on our behalf under contract.",
      "A regulator, court or law enforcement agency where we are legally required to disclose.",
      "That is the complete list. Nobody receives your data for their own purposes.",
    ],
  },
  {
    h: "What is public",
    p: [
      "Blockchain transactions are public by nature. The treasury addresses, the tokens held, the custody attestations and the published prices can be read by anyone.",
      "Your name is not on the blockchain. Custodial holdings are recorded in our ledger, not as a transaction in your name, so a public address cannot be traced back to you through anything we publish.",
      "If you connect your own wallet instead, that wallet's activity is public in the ordinary way, and that is a property of the blockchain rather than a choice we made.",
    ],
  },
  {
    h: "Where it is kept",
    p: [
      "Data is stored on servers operated by our hosting providers, which are located outside Tanzania. Transfers out of Tanzania are made under the safeguards required by the Personal Data Protection Act, 2022.",
      "Data is encrypted in transit and at rest by those providers.",
    ],
  },
  {
    h: "How long we keep it",
    p: [
      "Account and transaction records are kept for as long as you have an account and for the period afterwards that financial record-keeping rules require.",
      "Identity documents are kept for the retention period described above.",
      "When a period ends, the data is deleted rather than archived indefinitely.",
    ],
  },
  {
    h: "Your rights",
    p: [
      "Under the Personal Data Protection Act, 2022 you may ask for a copy of the personal data we hold about you, ask us to correct it if it is wrong, and ask us to delete it.",
      "Deletion has limits we will be honest about: we cannot delete records we are legally required to keep, and we cannot delete a blockchain transaction because nobody can.",
      "You can change your name, phone number and identity number yourself in settings, until verification is approved, after which your identity number is locked to the document we checked.",
      "To exercise any of these rights, write to privacy@capimon.app. If you are not satisfied with our response you may complain to the Personal Data Protection Commission.",
    ],
  },
  {
    h: "Security",
    p: [
      "Passwords are hashed, never stored in a form we can read. Sessions expire. Administrative access requires a separate credential.",
      "No system is perfect. If we ever discover a breach affecting your data we will tell you and the Commission, promptly and specifically, rather than issuing a statement about how seriously we take security.",
    ],
  },
  {
    h: "Changes and contact",
    p: [
      "If this policy changes materially we will tell you before it takes effect.",
      "For anything about your data, write to privacy@capimon.app.",
    ],
  },
];

export default function PrivacyPage() {
  return (
    <LegalPage
      eyebrow="Legal"
      title="Privacy policy"
      updated="Last updated 15 September 2026"
      intro="This says what CAPX collects about you, why, who else sees it and how long it is kept. It is deliberately specific, because a privacy policy that could describe any company describes nothing."
      sections={SECTIONS}
    />
  );
}
