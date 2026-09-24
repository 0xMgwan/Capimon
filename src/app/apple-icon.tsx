import { ImageResponse } from "next/og";

export const runtime = "nodejs";
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

/** Home-screen icon. Padded so the mark survives iOS's rounded mask. */
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#ffffff" }}>
        <svg width="132" height="132" viewBox="0 0 64 64">
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
    size,
  );
}
