// Entry point. Loads web/.env in development (the backend runs with web/ as its
// working directory); variables already set by the Shopify CLI or the host win.
import "dotenv/config";

import { startServer } from "./server.js";

startServer();
