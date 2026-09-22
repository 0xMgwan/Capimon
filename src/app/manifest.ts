import type { MetadataRoute } from "next";

/**
 * The home-screen app.
 *
 * Without a manifest, iOS guessed the app's extent from whatever page it was
 * added from — add it from /markets and every other page counted as leaving
 * the app, so it opened in a browser sheet with an X and a toolbar. Declaring
 * the whole site as the scope, and the home page as the start, makes every
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
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    categories: ["finance", "business"],
    icons: [
      { src: "/api/app-icon?size=192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/api/app-icon?size=512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/api/app-icon?size=512&maskable=1", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Markets", url: "/markets" },
      { name: "Portfolio", url: "/portfolio" },
    ],
  };
}
