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
          <g fill="#0a0a0b">
            <path d="M9 50h8l2.6-12h-8z" />
            <path d="M21 50h8l2.6-19.9h-8z" />
            <path d="M33 50h8l2.6-27.7h-8z" />
            <rect x="7" y="52.6" width="50" height="4.6" />
          </g>
          <path d="M45 50h8l2.6-37.1h-8z" fill="#6247F5" />
        </svg>
      </div>
    ),
    { width: size, height: size, headers: { "cache-control": "public, max-age=86400, immutable" } },
  );
}
