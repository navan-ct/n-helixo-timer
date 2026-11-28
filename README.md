# N Helixo Timer

A Shopify embedded app that adds countdown timers to product pages.

## Features

- **Countdown timers**: a fixed start and end, the same for every shopper, scheduled in the shop's time zone.
- **Evergreen timers**: a fixed duration (1 minute to 365 days) that starts on each shopper's first visit.
- Target all products, specific products, or specific collections.
- Color, size and urgency effect (pulse or shake in the final hour), with a live preview.
- Impression analytics on the home page.
- A theme app block that shows the timer on product pages.

## Tech stack

- **Backend**: Node, Express, MongoDB (Mongoose)
- **Admin**: React 19, Polaris web components, App Bridge
- **Storefront**: Preact widget in a theme app extension

## Setup

Requirements: Node 20.19+, a Shopify Partner account with a development store, and a MongoDB database (Atlas or local).

1. Install dependencies. The root, backend, admin and widget are separate packages:

   ```bash
   npm install && npm --prefix web install && npm --prefix web/frontend install && npm --prefix widget install
   ```

2. Create `web/.env` and set `MONGODB_URI`. The Shopify CLI provides the other variables in development. On Atlas, add your IP to the access list.

   ```bash
   cp web/.env.example web/.env
   ```

3. If you're using your own Shopify app instead of the one in `shopify.app.toml`, link it:

   ```bash
   npm run shopify app config link
   ```

4. Start the app, then install it on your dev store from the URL the CLI prints:

   ```bash
   npm run dev
   ```

5. On the app's home page, click **Add to product page**, save the theme, and create a timer.

## Scripts

| Command          | Description                                                 |
| ---------------- | ----------------------------------------------------------- |
| `npm run dev`    | Run the app locally with the Shopify CLI                    |
| `npm test`       | Backend, admin and widget tests (Vitest)                    |
| `npm run lint`   | ESLint                                                      |
| `npm run format` | Prettier                                                    |
| `npm run check`  | Lint, format check and tests                                |
| `npm run deploy` | Build the widget and deploy the app config and extension    |

Backend tests use an in-memory MongoDB, which downloads a MongoDB binary on the first run.

## Project structure

```
web/                      Express backend
  timers/                 Timer model, validation and service
  storefront/             Storefront API (served through the app proxy)
  analytics/              Impression tracking
web/frontend/             Admin UI
widget/                   Storefront widget source
extensions/timer-widget/  Theme app extension (Timer block and built widget)
```

## How it works

- The admin calls the backend's `/api` routes, authenticated with App Bridge session tokens. Every query is scoped to the shop.
- The Timer block renders a `<helixo-timer>` element with the product and collection IDs. The widget fetches matching timers through Shopify's app proxy (`/apps/n-helixo-timer/*` → `/api/storefront/*`), and the backend verifies the proxy signature.
- The backend caches each shop's live timers in memory for 30 seconds and clears the cache when a timer changes. The widget caches responses in `localStorage` and refreshes about once a minute.
- The widget is split into a small loader (about 3.5 KB gzipped) and a Preact UI bundle that only loads when there's a timer to show.
- Impressions are buffered in memory and written to MongoDB every 10 seconds as daily counts per timer.

## Decisions and assumptions

- **One timer per block.** When several timers apply, product targets beat collections, collections beat all products, and the one ending soonest wins among equals.
- **Timers are served through the app proxy**, so timer names and targeting stay on the server, and admin changes show up without editing the theme.
- **Evergreen timers are tracked per browser.** The start time is saved in `localStorage`, so a shopper who clears storage or switches devices gets a new timer. This keeps customer data out of the app.
- **Time zones.** Countdown times are entered in the shop's time zone and stored in UTC. A timer keeps the time zone it was created in.
- **Impressions** count when at least half of a timer is visible for one second, once per page view, and only if the shopper allows analytics (Shopify's Customer Privacy API). Failed writes are dropped rather than retried, to avoid double counting.
- **Built for a single instance.** Rate limits, the timer cache and the impression buffer live in memory. Several instances work, but rate limits then need a shared store (such as Redis), and timer changes take up to 30 seconds to reach other instances.
- **Polaris web components** instead of Polaris React, following Shopify's current guidance.
- **MongoDB** stores timers, impressions and Shopify sessions.
- Up to 200 timers per shop, and 100 targeted products or collections per timer.
- English only.
- The built widget files are committed, since they're what the extension ships.

## Deployment

1. Replace the `https://example.com` URLs in `shopify.app.toml` with your backend's URL.
2. Build and host the backend with Docker:

   ```bash
   docker build --build-arg SHOPIFY_API_KEY=<your-api-key> -t n-helixo-timer .
   ```

   The container listens on port 8081 and needs `MONGODB_URI`, `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SCOPES` and `HOST`. Optional variables are listed in `web/.env.example`. Use `/healthz` for liveness and `/readyz` for readiness checks.

3. Deploy the app config and theme extension:

   ```bash
   npm run deploy
   ```
