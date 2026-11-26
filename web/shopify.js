// Loads web/.env (the backend runs with web/ as its working directory).
// Variables already set in the environment (e.g. by the Shopify CLI or your host) take precedence.
import "dotenv/config";
import { BillingInterval, LATEST_API_VERSION } from "@shopify/shopify-api";
import { shopifyApp } from "@shopify/shopify-app-express";
import { MongoDBSessionStorage } from "@shopify/shopify-app-session-storage-mongodb";
// Keep this in sync with LATEST_API_VERSION (2025-07 in @shopify/shopify-api v11).
import { restResources } from "@shopify/shopify-api/rest/admin/2025-07";

const { MONGODB_URI, MONGODB_DB_NAME = "n_helixo_timer" } = process.env;

if (!MONGODB_URI) {
  throw new Error(
    "MONGODB_URI is not set. Copy web/.env.example to web/.env and add your MongoDB connection string."
  );
}

export const sessionStorage = new MongoDBSessionStorage(
  MONGODB_URI,
  MONGODB_DB_NAME
);

// Fail fast with a readable error if MongoDB is unreachable (bad credentials, IP not allowlisted, etc.).
sessionStorage.ready
  .then(() => console.log(`Connected to MongoDB (database: ${MONGODB_DB_NAME})`))
  .catch((error) => {
    console.error(`Failed to connect to MongoDB: ${error.message}`);
    process.exit(1);
  });

// The transactions with Shopify will always be marked as test transactions, unless NODE_ENV is production.
// See the ensureBilling helper to learn more about billing in this template.
const billingConfig = {
  "My Shopify One-Time Charge": {
    // This is an example configuration that would do a one-time charge for $5 (only USD is currently supported)
    amount: 5.0,
    currencyCode: "USD",
    interval: BillingInterval.OneTime,
  },
};

const shopify = shopifyApp({
  api: {
    apiVersion: LATEST_API_VERSION,
    restResources,
    future: {
      customerAddressDefaultFix: true,
      lineItemBilling: true,
      unstable_managedPricingSupport: true,
    },
    billing: undefined, // or replace with billingConfig above to enable example billing
  },
  auth: {
    path: "/api/auth",
    callbackPath: "/api/auth/callback",
  },
  webhooks: {
    path: "/api/webhooks",
  },
  sessionStorage,
});

export default shopify;
