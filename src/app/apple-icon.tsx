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
          <path d="M43 12.95A22 22 0 1 0 43 51.05" fill="none" stroke="#0a0a0b" strokeWidth="9.5" />
          <path d="M22 27.6H44V19l17 13-17 13v-8.6H22Z" fill="#6247F5" />
        </svg>
      </div>
    ),
    size,
  );
}
