import { ImageResponse } from "next/og";

export const runtime = "nodejs";

/**
 * App icons for the manifest, drawn from the same mark as the Apple icon.
 * `maskable` adds the safe-zone padding Android crops into circles and squircles.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const size = url.searchParams.get("size") === "192" ? 192 : 512;
  const maskable = url.searchParams.get("maskable") === "1";
  const mark = Math.round(size * (maskable ? 0.56 : 0.74));
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#ffffff" }}>
        <svg width={mark} height={mark} viewBox="0 0 64 64">
          <path d="M43 12.95A22 22 0 1 0 43 51.05" fill="none" stroke="#0a0a0b" strokeWidth="9.5" />
          <path d="M22 27.6H44V19l17 13-17 13v-8.6H22Z" fill="#6247F5" />
        </svg>
      </div>
    ),
    { width: size, height: size, headers: { "cache-control": "public, max-age=86400, immutable" } },
  );
}
