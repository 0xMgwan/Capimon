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
  /*
   * Everything that matters sits in the centre 630px.
   *
   * WhatsApp's compose box, and several other apps, crop the preview to a
   * centred square; the side-by-side layout lost its headline and half its
   * logos there. Centred, the square shows the whole message and the full
   * card simply has more background either side.
   */
  const dot = (src: string | null, name: string) => (
    <div key={name} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
      {src ? (
        <img src={src} width={68} height={68} alt=""
          style={{ width: 68, height: 68, borderRadius: 999, background: "#fff", border: "2px solid #ececec",
                   objectFit: name === "CRDB" ? "contain" : "cover" }} />
      ) : (
        <div style={{ display: "flex", width: 68, height: 68, borderRadius: 999, background: "#0B7D3E" }} />
      )}
      <div style={{ display: "flex", fontSize: 18, fontWeight: 700, color: "#0a0a0b" }}>{name}</div>
    </div>
  );
  const group = (label: string, items: readonly (readonly [string, string | null])[]) => (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
      <div style={{ display: "flex", gap: 14 }}>{items.map(([n, src]) => dot(src, n))}</div>
      <div style={{ display: "flex", fontSize: 15, letterSpacing: 2.5, color: "#8a8a8a", textTransform: "uppercase" }}>{label}</div>
    </div>
  );

  return new ImageResponse(
    (
      <div style={{
        width: "100%", height: "100%", display: "flex", flexDirection: "column", alignItems: "center",
        justifyContent: "center", background: "#ffffff", fontFamily: "sans-serif", position: "relative",
      }}>
        {/* Brand washes out at the edges — the part a square crop discards. */}
        <div style={{ position: "absolute", top: -180, left: -160, width: 640, height: 640, borderRadius: 999,
          background: "rgba(98,71,245,0.16)", filter: "blur(90px)", display: "flex" }} />
        <div style={{ position: "absolute", bottom: -220, right: -160, width: 660, height: 660, borderRadius: 999,
          background: "rgba(52,209,191,0.14)", filter: "blur(90px)", display: "flex" }} />

        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <svg width="54" height="54" viewBox="0 0 64 64">
            <g fill="#0a0a0b">
              <path d="M9 50h8l2.6-12h-8z" />
              <path d="M21 50h8l2.6-19.9h-8z" />
              <path d="M33 50h8l2.6-27.7h-8z" />
              <rect x="7" y="52.6" width="50" height="4.6" />
            </g>
            <path d="M45 50h8l2.6-37.1h-8z" fill={BRAND} />
          </svg>
          <div style={{ display: "flex", fontSize: 44, fontWeight: 700, letterSpacing: -2, color: "#0a0a0b" }}>CAPX</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginTop: 26,
          fontSize: 56, fontWeight: 700, letterSpacing: -2.5, lineHeight: 1.04, color: "#0a0a0b" }}>
          <span>Tanzanian &amp; US shares,</span>
          <span style={{ color: "#6b6b6b", fontStyle: "italic", fontWeight: 500 }}>in shillings.</span>
        </div>

        <div style={{ display: "flex", alignItems: "flex-start", gap: 30, marginTop: 34 }}>
          {group("Dar es Salaam", markets[0].names)}
          <div style={{ display: "flex", width: 2, height: 76, background: "#ececec", marginTop: 4 }} />
          {group("United States", markets[1].names)}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 34, fontSize: 22, color: "#555" }}>
          <div style={{ width: 9, height: 9, borderRadius: 999, background: "#12a150", display: "flex" }} />
          <div style={{ display: "flex" }}>From TSh 2,000 · mobile money or bank · capx.broker</div>
        </div>
      </div>
    ),
    size,
  );
}
