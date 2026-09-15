/**
 * Swahili, keyed by the English it replaces.
 *
 * Written for Tanzanian usage rather than textbook Swahili: "hisa" for shares,
 * "salio" for balance, "weka pesa" for a deposit, because that is what a
 * customer reading this already says. Financial and legal wording is the part
 * most worth a native reviewer's eye before this carries real volume.
 *
 * A missing entry falls through to English on purpose. Half a sentence in each
 * language is worse than a whole one in the wrong language.
 */
export const SW: Record<string, string> = {
  // --- navigation ---
  "Markets": "Masoko",
  "Portfolio": "Uwekezaji",
  "How it works": "Jinsi inavyofanya kazi",
  "Open account": "Fungua akaunti",
  "Open an account": "Fungua akaunti",
  "Sign in": "Ingia",
  "Sign out": "Toka",
  "Home": "Mwanzo",
  "Account": "Akaunti",
  "Settings": "Mipangilio",
  "All markets": "Masoko yote",

  // --- hero and landing ---
  "Own the open": "Miliki soko",
  "market.": "huria.",
  "US shares in dollars. Tanzanian shares in shillings. Settled against custody published on Base.":
    "Hisa za Marekani kwa dola. Hisa za Tanzania kwa shilingi. Hulipwa dhidi ya dhamana iliyochapishwa kwenye Base.",
  "Explore markets": "Tazama masoko",
  "Onchain value": "Thamani ya mnyororo",
  "Dar es Salaam": "Dar es Salaam",
  "buy in shillings": "nunua kwa shilingi",

  // --- the ticket ---
  "You pay": "Unalipa",
  "Buy": "Nunua",
  "Sell": "Uza",
  "You receive": "Unapokea",
  "Shares": "Hisa",
  "Shares sold": "Hisa zilizouzwa",
  "Price": "Bei",
  "Total cost": "Gharama jumla",
  "You receive ": "Unapokea ",
  "Spend (TZS)": "Tumia (TZS)",
  "Shares to sell": "Hisa za kuuza",
  "Receive about (TZS)": "Utapokea takriban (TZS)",
  "By amount": "Kwa kiasi",
  "By shares": "Kwa hisa",
  "All": "Zote",
  "Buy CRDB": "Nunua CRDB",
  "Sell CRDB": "Uza CRDB",
  "Placing…": "Inatuma…",
  "Indicative. Real quote on the": "Ni makadirio. Bei halisi iko kwenye",
  "asset page": "ukurasa wa hisa",
  "TZS a share": "TZS kwa hisa",
  "Dar es Salaam Stock Exchange": "Soko la Hisa la Dar es Salaam",
  "Proof of reserves": "Uthibitisho wa akiba",
  "Add money": "Weka pesa",
  "Buy shares": "Nunua hisa",
  "Sell shares": "Uza hisa",
  "Withdraw": "Toa pesa",

  // --- portfolio and wallet ---
  "Your book.": "Mali zako.",
  "Cash": "Pesa",
  "Total value": "Thamani jumla",
  "Return": "Faida",
  "held by CAPX": "inashikiliwa na CAPX",
  "Available to invest": "Pesa za kuwekeza",
  "Activity": "Shughuli",
  "Nothing yet. Add money to get started.": "Bado hakuna kitu. Weka pesa ili kuanza.",
  "after your first buy": "baada ya ununuzi wako wa kwanza",
  "Wallet": "Mkoba",
  "Deposit": "Amana",
  "invested": "zimewekezwa",

  // --- verification ---
  "Verification": "Uthibitishaji",
  "Verify your identity to keep using your account.":
    "Thibitisha utambulisho wako ili uendelee kutumia akaunti yako.",
  "Verify now": "Thibitisha sasa",
  "Try again": "Jaribu tena",
  "Your verification is being reviewed. Nothing to do.":
    "Uthibitishaji wako unakaguliwa. Hakuna la kufanya.",
  "Verification was not accepted. Please submit again.":
    "Uthibitishaji haukukubaliwa. Tafadhali wasilisha tena.",
  "Confirm it’s you.": "Thibitisha ni wewe.",
  "Two photographs: the document you hold, and you holding the phone. It takes about a minute and only has to be done once.":
    "Picha mbili: hati uliyo nayo, na wewe ukiwa umeshika simu. Inachukua takriban dakika moja na hufanyika mara moja tu.",
  "Your document.": "Hati yako.",
  "A photo of you, now.": "Picha yako, sasa hivi.",
  "National ID (NIDA)": "Kitambulisho cha Taifa (NIDA)",
  "Passport": "Paspoti",
  "Driver's licence": "Leseni ya udereva",
  "Voter's card": "Kadi ya mpiga kura",
  "Document number (optional)": "Namba ya hati (si lazima)",
  "Photograph or upload your document": "Piga picha au pakia hati yako",
  "Document attached.": "Hati imeambatishwa.",
  "Replace": "Badilisha",
  "Photo taken.": "Picha imepigwa.",
  "Retake": "Piga tena",
  "Open camera": "Fungua kamera",
  "Take photo": "Piga picha",
  "Cancel": "Ghairi",
  "Taken here rather than uploaded, so it matches the document.":
    "Inapigwa hapa badala ya kupakiwa, ili ilingane na hati.",
  "Camera access was refused. Allow it in your browser settings and try again.":
    "Ruhusa ya kamera ilikataliwa. Iruhusu kwenye mipangilio ya kivinjari kisha ujaribu tena.",
  "Submit for verification": "Wasilisha kwa uthibitishaji",
  "Submitting…": "Inawasilisha…",
  "Submitted": "Imewasilishwa",
  "Thanks. We’ll take a look.": "Asante. Tutaiangalia.",
  "Verified": "Imethibitishwa",
  "Under review": "Inakaguliwa",
  "Not accepted": "Haikukubaliwa",
  "Not started": "Haijaanza",
  "Verify your account": "Thibitisha akaunti yako",
  "Submit again": "Wasilisha tena",
  "View status": "Angalia hali",

  // --- settings ---
  "Your account.": "Akaunti yako.",
  "Display name": "Jina la kuonyesha",
  "Mobile money number": "Namba ya simu ya pesa",
  "Used for deposits and withdrawals.": "Hutumika kwa amana na kutoa pesa.",
  "Save changes": "Hifadhi mabadiliko",
  "Saving…": "Inahifadhi…",
  "Email": "Barua pepe",
  "Country": "Nchi",
  "Twenty digits. Must match the document you submit for verification.":
    "Tarakimu ishirini. Lazima ilingane na hati utakayowasilisha kwa uthibitishaji.",
  "Verified and locked to the document we checked.":
    "Imethibitishwa na imefungwa kwenye hati tuliyokagua.",
  "Language": "Lugha",

  // --- money and errors ---
  "Your balance is": "Salio lako ni",
  "You need": "Unahitaji",
  "more.": "zaidi.",
  "Could not reach the server. Nothing was placed.":
    "Imeshindwa kufikia seva. Hakuna agizo lililotumwa.",
  "Could not reach the server.": "Imeshindwa kufikia seva.",
  "Loading…": "Inapakia…",
  "oracle-implied": "kwa makadirio ya oracle",
  "Review": "Kagua",
  "order": "agizo",
  "Search company or ticker": "Tafuta kampuni au alama",
  "Shillings": "Shilingi",
  "Tradeable": "Inanunulika",
  "No company matches": "Hakuna kampuni inayolingana",
};
