import { ImageResponse } from "next/og";

export const runtime = "nodejs";
export const alt = "CAPX — capital markets in motion";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const BRAND = "#6247F5";

/**
 * Social share card. Deliberately static — a link preview is fetched by
 * crawlers with no wallet and no patience for an RPC round trip, so nothing
 * here depends on live market data.
 */
export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%", height: "100%", display: "flex", flexDirection: "column",
          justifyContent: "space-between", background: "#ffffff", padding: 72,
          fontFamily: "sans-serif",
        }}
      >
        {/* Soft brand wash, mirroring the hero */}
        <div style={{
          position: "absolute", top: -160, left: -120, width: 620, height: 620,
          borderRadius: 999, background: "rgba(98,71,245,0.16)", filter: "blur(80px)", display: "flex",
        }} />
        <div style={{
          position: "absolute", bottom: -200, right: -140, width: 640, height: 640,
          borderRadius: 999, background: "rgba(52,209,191,0.14)", filter: "blur(90px)", display: "flex",
        }} />

        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <svg width="72" height="72" viewBox="0 0 64 64">
            <path d="M43 12.95A22 22 0 1 0 43 51.05" fill="none" stroke="#0a0a0b" strokeWidth="9.5" />
            <path d="M22 27.6H44V19l17 13-17 13v-8.6H22Z" fill={BRAND} />
          </svg>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 58, fontWeight: 700, letterSpacing: -3, color: "#0a0a0b", lineHeight: 1 }}>
              CAPX
            </div>
            <div style={{ width: 250, height: 5, background: BRAND, borderRadius: 999, marginTop: 10, display: "flex" }} />
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ fontSize: 82, fontWeight: 600, letterSpacing: -4, color: "#0a0a0b", lineHeight: 1.02 }}>
            Own the open market.
          </div>
          <div style={{ fontSize: 30, color: "#6b6b6b", marginTop: 22, maxWidth: 900, lineHeight: 1.35 }}>
            Public equities onchain as B20 tokens on Base. Live Chainlink marks, real onchain
            supply, self-custody.
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 24, color: "#6b6b6b" }}>
          <div style={{ width: 10, height: 10, borderRadius: 999, background: "#12a150", display: "flex" }} />
          <div style={{ display: "flex" }}>Live on Base · trade any hour · shillings or self-custody</div>
        </div>
      </div>
    ),
    size,
  );
}
