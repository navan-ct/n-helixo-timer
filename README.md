# N Helixo Timer

A Shopify embedded app for creating countdown timers that show on product pages. Merchants schedule a timer in the store's time zone, choose where it appears (all products, or specific products or collections chosen with the Shopify Resource Picker), and style it with a color, size and urgency effect. A live preview shows the result. A theme app extension block shows the timer to shoppers.

## Features

- **Home** (`web/frontend/pages/index.jsx`): one section that adds the Timer block to the product page through a theme editor deep link.
- **Countdown timers** (`web/frontend/pages/countdown-timers.jsx`, in the app nav): Polaris index table with search, status filter (active, scheduled, expired), sorting, pagination, an empty state, and edit and delete actions.
- **Create and edit modal** (`web/frontend/components/timers/TimerFormModal.jsx`):
  - Name, schedule and description.
  - Targeting with the App Bridge Resource Picker.
  - Color picker, size and urgency settings, with a live preview that mirrors the storefront widget.
  - Inline validation that mirrors the server's rules.
- **Time zones**: dates and times are entered in the shop's IANA time zone (read from the Admin API) and stored as UTC instants. A blank start means "start now".
- **Translations**: English, German and French (`web/frontend/locales`, `extensions/timer-widget/locales`).
- **Storefront widget** (`widget/`, `extensions/timer-widget/`): a Preact countdown in a theme app extension block. See [Storefront widget](#storefront-widget).

## Architecture

| Layer          | Where                                 | Notes                                                                                                                   |
| -------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Storefront     | `widget`, `extensions/timer-widget`   | Preact widget bundled into a theme app extension; data from `web/storefront` through the app proxy                       |
| UI             | `web/frontend`                        | React 19 + [Polaris web components](https://shopify.dev/docs/api/app-home/web-components) (`polaris-2.js`) + App Bridge |
| Bootstrap      | `web/index.js`, `web/server.js`       | Loads config, connects dependencies in order, starts HTTP, owns the lifecycle                                           |
| HTTP pipeline  | `web/app.js`                          | Express app built from injected dependencies (the same pipeline runs in tests)                                          |
| Config         | `web/config.js`                       | Every environment variable, validated with Zod at startup                                                               |
| API            | `web/api`, `web/timers`               | JSON API router; timer validation (Zod), service and Mongoose model                                                     |
| Shopify        | `web/shopify.js`, `web/shopify/`      | OAuth, session tokens, webhooks, session storage, Admin GraphQL adapter                                                 |
| Infrastructure | `web/lib`, `web/middleware`, `web/db` | Logging, lifecycle, HTTP server, health, security, rate limiting, errors, MongoDB                                       |

### API

All routes are under `/api/timers`. Each one requires a valid App Bridge session token and only touches the calling shop's data.

| Method | Path   | Description                                           |
| ------ | ------ | ----------------------------------------------------- |
| GET    | `/`    | List timers. Query: `query`, `status`, `sort`, `page` |
| POST   | `/`    | Create a timer                                        |
| GET    | `/:id` | Get one timer                                         |
| PUT    | `/:id` | Replace a timer                                       |
| DELETE | `/:id` | Delete a timer                                        |

Errors use one shape: `{ "error": { "code", "message", "fields"?, "requestId" } }`. Validation failures return `422`, with a message for each field in `fields`.

The storefront API is under `/api/storefront`. Shoppers reach it as `/apps/n-helixo-timer/*` on the shop's domain, and Shopify's [app proxy](https://shopify.dev/docs/apps/build/online-store/app-proxies) forwards and signs each request (`[app_proxy]` in `shopify.app.toml`). It needs no session: the signature is verified instead, and the signed `shop` scopes the data.

| Method | Path                                         | Description                                                                                   |
| ------ | -------------------------------------------- | --------------------------------------------------------------------------------------------- |
| GET    | `/timers?product=<id>&collections=<id,id,…>` | Timers for one product page in priority order, plus the server time and the refresh interval |

## Storefront widget

The **Timer** app block (`extensions/timer-widget/blocks/timer.liquid`) renders a `<helixo-timer>` element with the product's ID and collection IDs, the block settings and translated strings. Its JavaScript is built from `widget/` into two bundles in the extension's `assets/`:

- `timer-widget.js` (about 3 KB gzipped) loads on every page with the block. It's framework-free: it fetches, caches and polls the product's timers.
- `timer-widget-ui.js` (Preact and the countdown) loads only when there's a timer to show, so product pages without one don't pay for it.

**Choosing a timer.** The API returns the timers that apply to the product and are running or start within 15 minutes, ordered by priority. Product targets come first, then collections, then all products, and the timer that ends soonest wins among equals. The widget shows the first one that's running, so it switches to the next timer at the exact second without another request. Timer names and targeting are never sent to the storefront.

**Polling and caching.**

- **Server**: each shop's unexpired timers are cached in memory for 30 seconds. Concurrent requests share one query, and admin changes invalidate the cache immediately on that instance.
- **Browser**: responses are cached in `localStorage`, so repeat views (and other tabs) render instantly and skip the request while fresh. Stale data shows while a fresh copy loads.
- **Polling**: the widget refreshes on the interval the server sends (60 seconds, with jitter), only while the tab is visible.

**Edge cases.**

- **Network failures**: a request is aborted after 10 seconds. Failed requests retry with exponential backoff (honoring `Retry-After`), and again as soon as the browser is back online. Known timers keep counting down meanwhile.
- **Clock errors**: the countdown corrects the shopper's device clock against the server time.
- **Expired timers**: when a timer runs out on screen, the widget shows "This offer has ended" unless another timer takes over. When there's no timer, the block hides along with the theme's spacing around it.
- **Theme editor**: when no timer is running, it shows a sample and a short note, so merchants can see and place the block.
- **Bad data**: malformed data, a storefront password page or blocked storage never break the product page.

**Polish.** Digits roll as they change, the urgency effect (color pulse or shake) plays during the final hour, and a progress line shows the time left. It respects `prefers-reduced-motion`, and screen readers get a minute-level description.

`shopify app dev` rebuilds the widget on change (`widget/shopify.web.toml`). `npm run deploy` builds it before deploying. The built files are committed because they're what the extension ships.

## Server operations

### Configuration

`web/config.js` validates the environment once at startup. Missing or invalid values stop the process with a list of all the problems. Only settings that differ between environments are read from the environment; fixed values such as timeouts, pool size and rate limits are named constants at the top of `web/config.js`.

| Variable                                                  | Notes                                                                                 |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `MONGODB_URI`                                             | Required                                                                              |
| `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SCOPES`, `HOST` | Required. The Shopify CLI sets them (and `BACKEND_PORT`) in development               |
| `MONGODB_DB_NAME`, `PORT`, `LOG_LEVEL`                    | Optional                                                                              |
| `TRUST_PROXY`                                             | Optional. Which proxies to trust for client IPs (defaults to private networks)        |
| `SHUTDOWN_TIMEOUT_MS`, `SHUTDOWN_DELAY_MS`                | Optional. Fit these to your platform's grace period before it force-kills the process |

`web/.env.example` lists them with their defaults. In development, MongoDB settings come from `web/.env`.

### Startup and graceful shutdown

`web/server.js` starts things in order: MongoDB (and model indexes), then Shopify session storage, then the app, then the HTTP listener. Only after that does readiness report healthy. Each resource registers a cleanup step as it starts (`web/lib/lifecycle.js`).

On `SIGTERM` or `SIGINT`, or after an uncaught exception or unhandled rejection, the server:

1. Marks itself not ready, so `/readyz` returns 503, and keeps serving for `SHUTDOWN_DELAY_MS` (5s in production, 0 in development) while load balancers deregister it.
2. Sends `Connection: close` on responses, so keep-alive clients move to other instances.
3. Stops accepting connections, lets in-flight requests finish, and closes keep-alive sockets as they go idle.
4. Closes session storage and MongoDB.
5. Exits with 0 (or 1 after a fatal error).

The whole sequence is capped by `SHUTDOWN_TIMEOUT_MS`. A second signal exits immediately. If startup fails, the same steps undo whatever had already started. In development, nodemon restarts with `SIGTERM`, so restarts also shut down gracefully.

### Health probes

| Endpoint       | Purpose   | Behavior                                                                                                     |
| -------------- | --------- | ------------------------------------------------------------------------------------------------------------ |
| `GET /healthz` | Liveness  | 200 while the process serves HTTP; never checks dependencies                                                 |
| `GET /readyz`  | Readiness | 200 only when started, not stopping, and MongoDB plus session storage answer a ping within 2s; otherwise 503 |

Both probes run before auth and rate limiting, are excluded from access logs, and never expose error details.

### Logging and tracing

Logs are structured JSON from pino in production and readable output in development. Each request gets an `X-Request-Id`: a well-formed upstream ID is reused, otherwise one is generated. The ID is returned on the response, included in error bodies, and attached to every log line for that request through `req.log`. Access logs record the method, path, status, duration and shop. They don't record query strings or headers, which carry OAuth codes, HMACs and bearer tokens in Shopify flows. Shopify library logs go through the same logger.

### HTTP hardening

- **Timeouts**: `keepAliveTimeout` (65s) stays above typical load-balancer idle timeouts, and `headersTimeout` stays above that. `requestTimeout` is 30s. Shopify Admin API calls time out after 10s and retry throttled or failed calls with backoff. A timeout returns 504 and other upstream failures return 502.
- **Headers**: Helmet security headers go on every response. HSTS is sent in production. Framing is limited to the merchant's shop and the Shopify admin through Shopify's per-shop `frame-ancestors` CSP. API responses get `default-src 'none'` and `Cache-Control: no-store`. `X-Powered-By` is removed.
- **Request parsing**: query strings are parsed flat, so nested objects never reach handlers. JSON bodies are capped at 16 KB and parsed strictly. Writes must be JSON (`415` otherwise). Malformed JSON, oversized bodies and bad URL encoding return clear 4xx errors.
- **Compression and caching**: responses are gzip-compressed. In production, fingerprinted assets are cached for a year and the HTML shell is never cached.
- **Cross-origin access**: the API is same-origin and authenticates with bearer session tokens, not cookies, so CORS is deliberately not enabled and CSRF doesn't apply.

### Rate limiting

| Limiter    | Key                  | Default   |
| ---------- | -------------------- | --------- |
| API        | Shop                 | 120 / min |
| API writes | Shop                 | 30 / min  |
| OAuth      | Client IP (IPv6 /56) | 30 / min  |
| Storefront | Shop and shopper IP  | 120 / min |

Counters are kept in memory, per instance. Responses include the standard `RateLimit` headers and `Retry-After`. If you run several instances, give each limiter a shared store (for example [`rate-limit-redis`](https://www.npmjs.com/package/rate-limit-redis)) in `web/middleware/rate-limit.js`.

### Data and security

- **Input validation**: strict Zod schemas reject unknown fields and non-string values, including NoSQL operator objects. Text is sanitized: HTML tags, control characters and bidi overrides are removed, and whitespace and Unicode are normalized.
- **Resources come from Shopify**: product and collection IDs are checked against the shop through the Admin API, and titles and images come from Shopify, not from the client.
- **Data isolation**: every query is scoped to the authenticated shop. Malformed or foreign IDs return `404`.
- **Updates and limits**: updates use optimistic concurrency, so a conflicting edit returns `409`. Each shop can have up to 200 timers.
- **Sessions**: Shopify sessions are stored in MongoDB (`shopify_sessions`). Indexes are added on `id` and `shop` because every authenticated request looks a session up.
- **Webhooks**: they're verified by HMAC. The `shop/redact` webhook erases a shop's timers, and no customer data is stored.

### Docker

The `Dockerfile` builds in two stages:

1. Production dependencies are installed and the frontend is built. Pass `--build-arg SHOPIFY_API_KEY=...`.
2. The result is copied into a small runtime image. It runs as the unprivileged `node` user, with `tini` as PID 1 so `SIGTERM` reaches Node, and a `HEALTHCHECK` on `/healthz`.

## Scripts

Run from the repository root:

| Command          | What it does                                    |
| ---------------- | ----------------------------------------------- |
| `npm run dev`    | Start the app with the Shopify CLI              |
| `npm run deploy` | Build the storefront widget, then deploy        |
| `npm run lint`   | ESLint (flat config in `eslint.config.mjs`)     |
| `npm run format` | Format with Prettier (`format:check` to verify) |
| `npm test`       | Backend, admin and widget unit tests (Vitest)   |
| `npm run check`  | Lint, format check and tests together           |

Backend tests cover config, lifecycle, HTTP draining, the full app pipeline (probes, headers, limits, errors, the app shell) and the API. The API tests run against an in-memory MongoDB (`mongodb-memory-server`, which downloads a MongoDB binary on first run) with fake Shopify dependencies. Frontend tests use jsdom and Testing Library.

### Notes on Polaris web components with React

- Polaris is loaded from Shopify's CDN in `web/frontend/index.html`. Keep the script's major version in step with `@shopify/polaris-types`.
- Component events are bound with lowercase props (`oninput`, `onchange`, `onhide`, `onnextpage`). React 19 attaches `on<event>` props on custom elements as direct listeners.
- Responsive `@container` values need an `s-query-container` ancestor.

---

# Shopify App Template for Node (reference)

This is a template for building a [Shopify app](https://shopify.dev/docs/apps/getting-started) using Node and React. It contains the basics for building a Shopify app.

Rather than cloning this repo, you can use your preferred package manager and the Shopify CLI with [these steps](#installing-the-template).

## Benefits

Shopify apps are built on a variety of Shopify tools to create a great merchant experience. The [create an app](https://shopify.dev/docs/apps/getting-started/create) tutorial in our developer documentation will guide you through creating a Shopify app using this template.

The Node app template comes with the following out-of-the-box functionality:

- OAuth: Installing the app and granting permissions
- GraphQL Admin API: Querying or mutating Shopify admin data
- REST Admin API: Resource classes to interact with the API
- Shopify-specific tooling:
  - AppBridge
  - Polaris
  - Webhooks

## Tech Stack

This template combines a number of third party open-source tools:

- [Express](https://expressjs.com/) builds the backend.
- [Vite](https://vitejs.dev/) builds the [React](https://reactjs.org/) frontend.
- [React Router](https://reactrouter.com/) is used for routing. We wrap this with file-based routing.
- [TanStack Query](https://tanstack.com/query/latest) fetches and caches data from the app API.
- [`i18next`](https://www.i18next.com/) and related libraries are used to internationalize the frontend.
  - [`react-i18next`](https://react.i18next.com/) is used for React-specific i18n functionality.
  - [`i18next-resources-to-backend`](https://github.com/i18next/i18next-resources-to-backend) is used to dynamically load app translations.
  - [`@formatjs/intl-localematcher`](https://formatjs.io/docs/polyfills/intl-localematcher/) is used to match the user locale with supported app locales.
  - [`@formatjs/intl-locale`](https://formatjs.io/docs/polyfills/intl-locale) is used as a polyfill for [`Intl.Locale`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/Locale) if necessary.
  - [`@formatjs/intl-pluralrules`](https://formatjs.io/docs/polyfills/intl-pluralrules) is used as a polyfill for [`Intl.PluralRules`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/PluralRules) if necessary.

The following Shopify tools complement these third-party tools to ease app development:

- [Shopify API library](https://github.com/Shopify/shopify-node-api) adds OAuth to the Express backend. This lets users install the app and grant scope permissions.
- [App Bridge React](https://shopify.dev/docs/apps/tools/app-bridge/getting-started/using-react) adds [authentication to API requests](https://shopify.dev/docs/api/app-bridge-library/apis/resource-fetching) in the frontend and renders components outside of the App’s iFrame.
- [Polaris web components](https://shopify.dev/docs/api/app-home/web-components) provide the design system and components, so the app looks native in the Shopify admin.
- [File-based routing](https://github.com/Shopify/shopify-frontend-template-react/blob/main/Routes.jsx) makes creating new pages easier.
- [`@shopify/i18next-shopify`](https://github.com/Shopify/i18next-shopify) is a plugin for [`i18next`](https://www.i18next.com/) that allows translation files to follow the same JSON schema used by Shopify [app extensions](https://shopify.dev/docs/apps/checkout/best-practices/localizing-ui-extensions#how-it-works) and [themes](https://shopify.dev/docs/themes/architecture/locales/storefront-locale-files#usage).

## Getting started

### Requirements

1. You must [download and install Node.js](https://nodejs.org/en/download/) if you don't already have it.
1. You must [create a Shopify partner account](https://partners.shopify.com/signup) if you don’t have one.
1. You must create a store for testing if you don't have one, either a [development store](https://help.shopify.com/en/partners/dashboard/development-stores#create-a-development-store) or a [Shopify Plus sandbox store](https://help.shopify.com/en/partners/dashboard/managing-stores/plus-sandbox-store).

### Installing the template

This template can be installed using your preferred package manager:

Using yarn:

```shell
yarn create @shopify/app --template=node
```

Using npm:

```shell
npm init @shopify/app@latest -- --template=node
```

Using pnpm:

```shell
pnpm create @shopify/app@latest --template=node
```

This will clone the template and install the required dependencies.

#### Local Development

[The Shopify CLI](https://shopify.dev/docs/apps/tools/cli) connects to an app in your Partners dashboard. It provides environment variables, runs commands in parallel, and updates application URLs for easier development.

You can develop locally using your preferred package manager. Run one of the following commands from the root of your app.

Using yarn:

```shell
yarn dev
```

Using npm:

```shell
npm run dev
```

Using pnpm:

```shell
pnpm run dev
```

Open the URL generated in your console. Once you grant permission to the app, you can start development.

## Deployment

### Application Storage

This app stores session data in MongoDB using [`@shopify/shopify-app-session-storage-mongodb`](https://github.com/Shopify/shopify-app-js/tree/main/packages/apps/session-storage/shopify-app-session-storage-mongodb) (configured in `web/shopify/session-storage.js`). Sessions are kept in the `shopify_sessions` collection. See [Server operations](#server-operations) for every configuration variable.

Configuration is read from environment variables, loaded from `web/.env` in development (copy `web/.env.example`; `.env` is gitignored). Variables set by the Shopify CLI or your host take precedence:

| Variable          | Required | Description                                               |
| ----------------- | -------- | --------------------------------------------------------- |
| `MONGODB_URI`     | yes      | MongoDB connection string (URL-encode special characters) |
| `MONGODB_DB_NAME` | no       | Database name, defaults to `n_helixo_timer`               |

The backend exits on startup with a readable error if MongoDB is unreachable. On MongoDB Atlas, make sure your machine's (and later your host's) IP is on the cluster's IP access list. In production, set these as real environment variables on your host.

The database that works best for you depends on the data your app needs and how it is queried. You can run your database of choice on a server yourself or host it with a SaaS company. Here’s a short list of databases providers that provide a free tier to get started:

| Database   | Type             | Hosters                                                                                                                                                                                                                               |
| ---------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MySQL      | SQL              | [Digital Ocean](https://www.digitalocean.com/try/managed-databases-mysql), [Planet Scale](https://planetscale.com/), [Amazon Aurora](https://aws.amazon.com/rds/aurora/), [Google Cloud SQL](https://cloud.google.com/sql/docs/mysql) |
| PostgreSQL | SQL              | [Digital Ocean](https://www.digitalocean.com/try/managed-databases-postgresql), [Amazon Aurora](https://aws.amazon.com/rds/aurora/), [Google Cloud SQL](https://cloud.google.com/sql/docs/postgres)                                   |
| Redis      | Key-value        | [Digital Ocean](https://www.digitalocean.com/try/managed-databases-redis), [Amazon MemoryDB](https://aws.amazon.com/memorydb/)                                                                                                        |
| MongoDB    | NoSQL / Document | [Digital Ocean](https://www.digitalocean.com/try/managed-databases-mongodb), [MongoDB Atlas](https://www.mongodb.com/atlas/database)                                                                                                  |

To use one of these, you need to change your session storage configuration. To help, here’s a list of [SessionStorage adapter packages](https://github.com/Shopify/shopify-api-js/blob/main/packages/shopify-api/docs/guides/session-storage.md).

### Build

The frontend is a single page app. It requires the `SHOPIFY_API_KEY`, which you can find on the page for your app in your partners dashboard. Paste your app’s key in the command for the package manager of your choice:

Using yarn:

```shell
cd web/frontend/ && SHOPIFY_API_KEY=REPLACE_ME yarn build
```

Using npm:

```shell
cd web/frontend/ && SHOPIFY_API_KEY=REPLACE_ME npm run build
```

Using pnpm:

```shell
cd web/frontend/ && SHOPIFY_API_KEY=REPLACE_ME pnpm run build
```

You do not need to build the backend.

## Hosting

When you're ready to set up your app in production, you can follow [our deployment documentation](https://shopify.dev/docs/apps/deployment/web) to host your app on a cloud provider like [Heroku](https://www.heroku.com/) or [Fly.io](https://fly.io/).

When you reach the step for [setting up environment variables](https://shopify.dev/docs/apps/deployment/web#set-env-vars), you also need to set the variable `NODE_ENV=production`.

## Known issues

### Hot module replacement and Firefox

When running the app with the CLI in development mode on Firefox, you might see your app constantly reloading when you access it.
That happened in previous versions of the CLI, because of the way HMR websocket requests work.

We fixed this issue with v3.4.0 of the CLI, so after updating it, you can make the following changes to your app's `web/frontend/vite.config.js` file:

1. Change the definition `hmrConfig` object to be:

   ```js
   const host = process.env.HOST ? process.env.HOST.replace(/https?:\/\//, "") : "localhost";

   let hmrConfig;
   if (host === "localhost") {
     hmrConfig = {
       protocol: "ws",
       host: "localhost",
       port: 64999,
       clientPort: 64999,
     };
   } else {
     hmrConfig = {
       protocol: "wss",
       host: host,
       port: process.env.FRONTEND_PORT,
       clientPort: 443,
     };
   }
   ```

1. Change the `server.host` setting in the configs to `"localhost"`:

   ```js
   server: {
     host: "localhost",
     ...
   ```

### I can't get past the ngrok "Visit site" page

When you’re previewing your app or extension, you might see an ngrok interstitial page with a warning:

```text
You are about to visit <id>.ngrok.io: Visit Site
```

If you click the `Visit Site` button, but continue to see this page, then you should run dev using an alternate tunnel URL that you run using tunneling software.
We've validated that [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/run-tunnel/trycloudflare/) works with this template.

To do that, you can [install the `cloudflared` CLI tool](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/), and run:

```shell
# Note that you can also use a different port
cloudflared tunnel --url http://localhost:3000
```

Out of the logs produced by cloudflare you will notice a https URL where the domain ends with `trycloudflare.com`. This is your tunnel URL. You need to copy this URL as you will need it in the next step.

```shell
2022-11-11T19:57:55Z INF Requesting new quick Tunnel on trycloudflare.com...
2022-11-11T19:57:58Z INF +--------------------------------------------------------------------------------------------+
2022-11-11T19:57:58Z INF |  Your quick Tunnel has been created! Visit it at (it may take some time to be reachable):  |
2022-11-11T19:57:58Z INF |  https://randomly-generated-hostname.trycloudflare.com                                     |
2022-11-11T19:57:58Z INF +--------------------------------------------------------------------------------------------+
```

Below you would replace `randomly-generated-hostname` with what you have copied from the terminal. In a different terminal window, navigate to your app's root and with the URL from above you would call:

```shell
# Using yarn
yarn dev --tunnel-url https://randomly-generated-hostname.trycloudflare.com:3000
# or using npm
npm run dev --tunnel-url https://randomly-generated-hostname.trycloudflare.com:3000
# or using pnpm
pnpm dev --tunnel-url https://randomly-generated-hostname.trycloudflare.com:3000
```

## Developer resources

- [Introduction to Shopify apps](https://shopify.dev/docs/apps/getting-started)
- [App authentication](https://shopify.dev/docs/apps/auth)
- [Shopify CLI](https://shopify.dev/docs/apps/tools/cli)
- [Shopify API Library documentation](https://github.com/Shopify/shopify-api-js#readme)
- [Getting started with internationalizing your app](https://shopify.dev/docs/apps/best-practices/internationalization/getting-started)
  - [i18next](https://www.i18next.com/)
    - [Configuration options](https://www.i18next.com/overview/configuration-options)
  - [react-i18next](https://react.i18next.com/)
    - [`useTranslation` hook](https://react.i18next.com/latest/usetranslation-hook)
    - [`Trans` component usage with components array](https://react.i18next.com/latest/trans-component#alternative-usage-components-array)
  - [i18n-ally VS Code extension](https://marketplace.visualstudio.com/items?itemName=Lokalise.i18n-ally)
