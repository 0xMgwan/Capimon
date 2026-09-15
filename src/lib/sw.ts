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
  "How you are paying": "Unalipaje",
  "Amount": "Kiasi",
  "Amount in shillings": "Kiasi kwa shilingi",
  "Amount to withdraw": "Kiasi cha kutoa",
  "Send to mobile money": "Tuma kwenye simu ya pesa",
  "Sending to": "Inatumwa kwa",
  "They receive": "Watapokea",
  "Bank account you are sending from": "Akaunti ya benki unayotumia kutuma",
  "You have no shares to sell yet": "Bado huna hisa za kuuza",
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
  // --- how it works ---
  // Technical nouns stay in English where that is how they are actually said:
  // Chainlink, B20, multiplier, oracle. Borrowing them is natural Swahili here,
  // and inventing translations would make the page harder to read, not easier.
  "No black box.": "Hakuna siri.",
  "Just addresses.": "Ni anwani tu.",
  "CAPX is a thin, honest interface over machinery that already exists on Base. Here is exactly what it reads, and where you can check it yourself.":
    "CAPX ni kiolesura chepesi na cha kweli juu ya mfumo ambao tayari upo kwenye Base. Haya ndiyo hasa inayosoma, na mahali unapoweza kuthibitisha mwenyewe.",
  "Contracts CAPX reads": "Mikataba ambayo CAPX inasoma",
  "Straight answers": "Majibu ya moja kwa moja",
  "Base documentation": "Nyaraka za Base",
  "Every B20 address begins 0xb2. They are native precompiles on Base, not deployed bytecode.":
    "Kila anwani ya B20 huanza na 0xb2. Ni precompiles za asili kwenye Base, si bytecode iliyosambazwa.",

  "The issuer mints a B20 token": "Mtoaji hutengeneza tokeni ya B20",
  "A regulated issuer holds the underlying share and mints a matching B20 token on Base. B20 extends ERC-20 for real-world assets and is asset-agnostic. These tokens are native precompiles rather than separately deployed contracts, audited by Base and Spearbit with ongoing Cantina and HackerOne bounty coverage.":
    "Mtoaji aliyesajiliwa hushika hisa halisi na kutengeneza tokeni ya B20 inayolingana kwenye Base. B20 huongeza ERC-20 kwa ajili ya mali halisi na haijafungwa kwa aina moja ya mali. Tokeni hizi ni precompiles za asili badala ya mikataba iliyosambazwa peke yake, zilizokaguliwa na Base na Spearbit, na zina ulinzi endelevu wa zawadi kupitia Cantina na HackerOne.",

  "Chainlink publishes a total-return mark": "Chainlink huchapisha bei ya total-return",
  "Each asset has a Chainlink feed on Base reporting price × multiplier, WAD-scaled, running 24/5 and freezing through corporate actions. CAPX reads updatedAt on every round and flags a feed that has missed a session instead of showing you a confident number that isn't.":
    "Kila mali ina Chainlink feed kwenye Base inayoripoti bei × multiplier, kwa kipimo cha WAD, ikifanya kazi saa 24 kwa siku 5 na kusimama wakati wa maamuzi ya kampuni. CAPX husoma updatedAt kwa kila raundi na huonyesha alama pale feed imekosa kipindi, badala ya kukuonyesha namba inayoonekana ya uhakika kumbe si kweli.",

  "Corporate actions move the multiplier": "Maamuzi ya kampuni hubadilisha multiplier",
  "Splits and dividends do not rewrite balances. They adjust a WAD-precision multiplier, so one token is not permanently one share. CAPX applies the current multiplier everywhere a share count appears: portfolio quantities use scaledBalanceOf, and supply figures are multiplier-adjusted share-equivalents.":
    "Kugawanya hisa na gawio havibadilishi salio lako. Hurekebisha multiplier ya usahihi wa WAD, hivyo tokeni moja si hisa moja milele. CAPX hutumia multiplier ya sasa kila mahali idadi ya hisa inapoonekana: idadi za uwekezaji hutumia scaledBalanceOf, na takwimu za ugavi ni sawa na hisa baada ya kurekebishwa kwa multiplier.",

  "Policies gate transfers, not holding": "Sera hudhibiti uhamishaji, si umiliki",
  "Onchain policy registries enforce allowlists and blocklists, and a transfer to a sanctioned address reverts. Holding and secondary transfer are otherwise permissionless. KYC applies at mint and redeem with the issuer, not between wallets.":
    "Rejista za sera kwenye mnyororo hutekeleza orodha za kuruhusu na kuzuia, na uhamishaji kwenda anwani iliyozuiwa hukataliwa. Vinginevyo, kushika na kuhamisha hisa hakuhitaji ruhusa. KYC hutumika wakati wa kutengeneza na kukomboa na mtoaji, si kati ya pochi na pochi.",

  "CAPX reads, you sign": "CAPX husoma, wewe unasaini",
  "Prices, supply and balances are read straight from Base. Trades are routed by aggregating every venue on the chain: Aerodrome concentrated liquidity, Uniswap v3 and v4, PancakeSwap, because equity liquidity moves between them and no single pool tells the truth. Every fill is checked against the Chainlink mark before it is offered, and CAPX refuses to route anything more than 15% away from it.":
    "Bei, ugavi na salio husomwa moja kwa moja kutoka Base. Biashara hupitishwa kwa kukusanya kila soko kwenye mnyororo: Aerodrome concentrated liquidity, Uniswap v3 na v4, PancakeSwap, kwa sababu ukwasi wa hisa husogea kati yao na hakuna dimbwi moja linalosema ukweli wote. Kila biashara hukaguliwa dhidi ya bei ya Chainlink kabla ya kutolewa, na CAPX hukataa kupitisha lolote lililo zaidi ya asilimia 15 kutoka kwake.",

  "Is one token one share?": "Je, tokeni moja ni hisa moja?",
  "No. Redemption applies the current onchain multiplier, which absorbs splits and dividends. CAPX shows the multiplier on every asset page and adjusts every share count it displays.":
    "Hapana. Ukombozi hutumia multiplier ya sasa kwenye mnyororo, ambayo huchukua kugawanya hisa na gawio. CAPX huonyesha multiplier kwenye kila ukurasa wa hisa na hurekebisha kila idadi ya hisa inayoonyesha.",

  "Why does an asset show zero onchain supply?": "Kwa nini hisa fulani inaonyesha ugavi sifuri kwenye mnyororo?",
  "The Chainlink feed is live for all thirteen assets, but tokens are only minted as demand arrives. A supply of zero means nothing has been minted on Base yet. The mark is still real, there is just nothing to trade against.":
    "Chainlink feed inafanya kazi kwa hisa zote kumi na tatu, lakini tokeni hutengenezwa pale mahitaji yanapofika. Ugavi wa sifuri maana yake hakuna kilichotengenezwa kwenye Base bado. Bei bado ni halisi, ila hakuna cha kufanyia biashara.",

  "Why can't I trade every asset?": "Kwa nini siwezi kufanya biashara ya kila hisa?",
  "Secondary trading needs minted supply and a venue holding it. Four assets route today at roughly the oracle mark; the rest have nothing minted on Base yet, so CAPX marks them mint-only rather than inventing a fill. The markets table labels each one.":
    "Biashara ya pili inahitaji ugavi uliotengenezwa na soko linaloushika. Hisa nne zinapitishwa leo karibu na bei ya oracle; zilizobaki hazina kilichotengenezwa kwenye Base bado, hivyo CAPX huziweka alama ya kutengeneza tu badala ya kubuni biashara. Jedwali la masoko huweka alama kwa kila moja.",

  "Who can use this?": "Nani anaweza kutumia hii?",
  "Tokenized equities are not available to US persons. Connect your own wallet and CAPX holds nothing. Fund an account with Tanzanian shillings and CAPX holds those assets for you, recording your entitlement in its own ledger. That is custody, and it is the trade-off for not needing a wallet. Nothing here is investment advice.":
    "Hisa za kidijitali hazipatikani kwa watu wa Marekani. Unganisha pochi yako mwenyewe na CAPX haishiki chochote. Weka pesa kwa shilingi za Tanzania na CAPX hushika mali hizo kwa niaba yako, ikirekodi haki yako kwenye daftari lake. Hiyo ni udhamini, na ndiyo bei ya kutohitaji pochi. Hakuna chochote hapa ni ushauri wa uwekezaji.",

  "oracle-implied": "kwa makadirio ya oracle",
  "Review": "Kagua",
  "order": "agizo",
  "Search company or ticker": "Tafuta kampuni au alama",
  "Shillings": "Shilingi",
  "Tradeable": "Inanunulika",
  "No company matches": "Hakuna kampuni inayolingana",
};
