/**
 * Security headers for every route (#8).
 *
 * What the app actually loads, which is what the CSP below allows and no more:
 *   - scripts: our own /_next bundles, plus the inline bootstrap/flight
 *     scripts the App Router writes into every page (self.__next_f.push(...)).
 *     Those inline scripts are why script-src carries 'unsafe-inline'. The
 *     strict alternative is a per-request nonce from middleware, which forces
 *     every page to render dynamically; that is a separate change, tracked on
 *     #8. Even so, this policy still blocks scripts from any other host and,
 *     through connect-src, stops an injected script from sending data anywhere
 *     but our own origin.
 *   - styles: globals.css from /_next, plus inline style="" attributes React
 *     renders (the run progress bars), so style-src needs 'unsafe-inline'.
 *   - fonts: the system font stack only, nothing fetched.
 *   - images: same-origin OG/Twitter image routes, inline SVG, and data:/blob:
 *     URLs as a margin for icons and the study-pack download.
 *   - fetch: same-origin /api/* only. Moodle, the SIS and the AI provider are
 *     called from the server, never the browser.
 *   - ChatGPT/Gemini "open in" links are top-level navigations, which CSP does
 *     not govern, so they need no allowance. Clipboard writes are a
 *     permission, not a fetch, and stay allowed for our own origin.
 *
 * `next dev` needs eval for fast refresh and a websocket for HMR; those two
 * allowances are added only outside production.
 */
const isProd = process.env.NODE_ENV === "production";

const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isProd ? "" : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  `connect-src 'self'${isProd ? "" : " ws: wss:"}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-src 'none'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  // frame-ancestors is the modern control; X-Frame-Options covers browsers
  // that predate it. The login page is where a password is typed, so it must
  // never render inside someone else's frame.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()",
  },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

module.exports = nextConfig;
