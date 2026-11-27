import helmet from "helmet";

/**
 * Baseline security headers for every response.
 *
 * The app's HTML is embedded in the Shopify admin, so framing is controlled by
 * the per-shop `frame-ancestors` policy from `shopify.cspHeaders()` rather than
 * X-Frame-Options, and Helmet's default CSP (which forbids framing and inline
 * styles) is left off for documents.
 *
 * @param {{ isProduction: boolean }} options
 */
export function securityHeaders({ isProduction }) {
  return helmet({
    contentSecurityPolicy: false,
    frameguard: false,
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
    // Only meaningful over HTTPS; local development may run on plain HTTP.
    strictTransportSecurity: isProduction ? { maxAge: 63_072_000, includeSubDomains: true } : false,
  });
}

/**
 * JSON API responses are never rendered or framed, so they get the strictest
 * possible policy.
 */
export const apiContentSecurityPolicy = helmet.contentSecurityPolicy({
  useDefaults: false,
  directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] },
});
