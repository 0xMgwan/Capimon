import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";
export const alt = "CAPX · Tanzanian and US shares, in shillings";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const BRAND = "#6247F5";

/**
 * Social share card. Deliberately static — a link preview is fetched by
 * crawlers with no wallet and no patience for an RPC round trip, so nothing
 * here depends on live market data.
 */
/**
 * Company logos, read from the site's own files as data URIs.
 *
 * Kept in public/og as PNG and JPEG because the renderer cannot decode WebP
 * (the format uploaded logos are stored in), and bundled rather than fetched
 * so a slow logo server can never break every link preview.
 */
async function logo(file: string) {
  try {
    const buf = await readFile(path.join(process.cwd(), "public", "og", file));
    return `data:image/${file.endsWith(".jpg") ? "jpeg" : "png"};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

export default async function OpengraphImage() {
  const [crdb, nmb, aapl, nvda, tsla] = await Promise.all(
    ["crdb.jpg", "nmb.png", "aapl.png", "nvda.png", "tsla.png"].map(logo),
  );
  const markets = [
    { flag: "Dar es Salaam", unit: "in shillings", names: [["CRDB", crdb], ["NMB", nmb]] },
    { flag: "United States", unit: "and more", names: [["AAPL", aapl], ["NVDA", nvda], ["TSLA", tsla]] },
  ] as const;
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

        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 40 }}>
          <div style={{ display: "flex", flexDirection: "column", maxWidth: 560 }}>
            <div style={{ fontSize: 66, fontWeight: 700, letterSpacing: -3, color: "#0a0a0b", lineHeight: 1.02, display: "flex", flexDirection: "column" }}>
              <span>Tanzanian &amp; US</span>
              <span>shares,</span>
              <span style={{ color: "#6b6b6b", fontStyle: "italic", fontWeight: 500 }}>in shillings.</span>
            </div>
            <div style={{ fontSize: 26, color: "#555", marginTop: 20, lineHeight: 1.35, display: "flex" }}>
              Buy from mobile money or your bank, from TSh 2,000. Settled the same day.
            </div>
          </div>

          {/* The two markets, as the product shows them. */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16, width: 500 }}>
            {markets.map((m) => (
              <div key={m.flag} style={{
                display: "flex", flexDirection: "column", borderRadius: 28, padding: "20px 24px",
                background: "#ffffff", border: "2px solid #ececec", boxShadow: "0 12px 30px rgba(0,0,0,0.06)",
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <div style={{ display: "flex", fontSize: 19, letterSpacing: 3, color: "#8a8a8a", textTransform: "uppercase" }}>
                    {m.flag}
                  </div>
                  <div style={{ display: "flex", fontSize: 19, color: "#8a8a8a" }}>{m.unit}</div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12 }}>
                  {m.names.map(([t, src]) => (
                    <div key={t} style={{
                      display: "flex", alignItems: "center", gap: 9, flexShrink: 0, fontSize: 24, fontWeight: 700,
                      color: "#0a0a0b", background: "#f4f4f2", borderRadius: 999, padding: "5px 16px 5px 5px",
                    }}>
                      {src ? (
                         
                        <img src={src} width={40} height={40} alt=""
                          style={{ width: 40, height: 40, borderRadius: 999, background: "#fff",
                            // A wide wordmark (CRDB's) is fitted, not cropped to its middle.
                            objectFit: t === "CRDB" ? "contain" : "cover" }} />
                      ) : (
                        <div style={{ display: "flex", width: 40, height: 40, borderRadius: 999, background: "#0B7D3E" }} />
                      )}
                      {t}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 24, color: "#6b6b6b" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ width: 10, height: 10, borderRadius: 999, background: "#12a150", display: "flex" }} />
            <div style={{ display: "flex" }}>One account · 1% fee · no minimum</div>
          </div>
          <div style={{ display: "flex", fontWeight: 600, color: "#0a0a0b" }}>capx.broker</div>
        </div>
      </div>
    ),
    size,
  );
}
