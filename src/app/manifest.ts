import type { MetadataRoute } from "next";

/**
 * The home-screen app.
 *
 * Without a manifest, iOS guessed the app's extent from whatever page it was
 * added from — add it from /markets and every other page counted as leaving
 * the app, so it opened in a browser sheet with an X and a toolbar. Declaring
 * the whole site as the scope, and Markets as the start, makes every
 * page part of one standalone app however it was added.
 *
 * Paths are relative, so the app belongs to whichever origin it was installed
 * from; capx.broker redirects to www.capx.broker, and relative paths keep the
 * scope on the host that actually serves the pages.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "CAPX · Capital in Motion",
    short_name: "CAPX",
    description: "Tanzanian and US shares, in shillings.",
    /*
     * The installed app opens on the portfolio.
     *
     * Whoever added CAPX to their home screen has an account, and what they
     * open it for is their own balance — the markets are one tap from there.
     * A signed-out visitor landing here is redirected to the account screen
     * by the page itself, which is the right first step for them anyway.
     */
    start_url: "/portfolio",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    // The light theme's background, so the launch screen matches the first paint.
    background_color: "#fcfcfb",
    theme_color: "#fcfcfb",
    categories: ["finance", "business"],
    icons: [
      { src: "/api/app-icon?size=192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/api/app-icon?size=512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/api/app-icon?size=512&maskable=1", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Markets", url: "/markets" },
      { name: "Portfolio", url: "/portfolio" },
      { name: "Top traders", url: "/leaderboard" },
    ],
  };
}
