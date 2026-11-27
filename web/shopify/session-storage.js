import { MongoDBSessionStorage } from "@shopify/shopify-app-session-storage-mongodb";

const SESSION_COLLECTION = "shopify_sessions";

/**
 * Shopify OAuth session storage in MongoDB.
 *
 * The adapter opens its own client and creates no indexes, while every
 * authenticated request looks a session up by `id` (and uninstall cleanup by
 * `shop`). Startup therefore waits for the adapter to connect and adds those
 * indexes; shutdown closes its client.
 *
 * @param {{ uri: string, dbName: string, timeoutMs: number }} options
 */
export async function createSessionStorage({ uri, dbName, timeoutMs }) {
  const storage = new MongoDBSessionStorage(uri, dbName, {
    sessionCollectionName: SESSION_COLLECTION,
  });

  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Session storage did not connect within ${timeoutMs}ms`)),
      timeoutMs,
    );
  });
  try {
    await Promise.race([storage.ready, timeout]);
  } catch (error) {
    // Don't leave a late rejection from the adapter unhandled.
    storage.ready.catch(() => {});
    await storage.client?.close().catch(() => {});
    throw error;
  } finally {
    clearTimeout(timer);
  }

  const collection = storage.client.db(dbName).collection(SESSION_COLLECTION);
  await collection.createIndexes([
    { key: { id: 1 }, name: "id_1" },
    { key: { shop: 1 }, name: "shop_1" },
  ]);

  return {
    storage,
    ping: () => storage.client.db(dbName).command({ ping: 1 }),
    close: () => storage.disconnect(),
  };
}
