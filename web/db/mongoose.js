import mongoose from "mongoose";

mongoose.set("strictQuery", true);
// Fail fast instead of buffering queries while the database is unreachable.
mongoose.set("bufferCommands", false);

/**
 * Opens the application's MongoDB connection (timers, rate-limit counters) and
 * logs connection state changes. Startup fails if the server can't be reached
 * within `serverSelectionTimeoutMs`.
 *
 * @param {{
 *   uri: string, dbName: string, maxPoolSize: number, serverSelectionTimeoutMs: number,
 *   logger: import("pino").Logger,
 * }} options
 */
export async function connectDatabase({
  uri,
  dbName,
  maxPoolSize,
  serverSelectionTimeoutMs,
  logger,
}) {
  const log = logger.child({ component: "mongodb" });
  const connection = mongoose.connection;

  connection.on("disconnected", () => log.warn("MongoDB disconnected"));
  connection.on("reconnected", () => log.info("MongoDB reconnected"));
  connection.on("error", (error) => log.error({ err: error }, "MongoDB connection error"));

  await mongoose.connect(uri, {
    dbName,
    maxPoolSize,
    serverSelectionTimeoutMS: serverSelectionTimeoutMs,
    socketTimeoutMS: 45_000,
    appName: "n-helixo-timer",
  });
  log.info({ dbName }, "Connected to MongoDB");
  return connection;
}

/**
 * Creates each model's collection and brings its indexes in line with the
 * schema (adding new ones, dropping ones no longer declared). Runs after the
 * connection is open, so index problems fail startup instead of surfacing later.
 */
export async function syncModelIndexes(models) {
  for (const model of models) {
    // eslint-disable-next-line no-await-in-loop -- few models; keeps errors attributable
    await model.createCollection();
    // eslint-disable-next-line no-await-in-loop
    await model.syncIndexes();
  }
}

/** Round-trips to the server; used by the readiness probe. */
export async function pingDatabase(connection = mongoose.connection) {
  if (connection.readyState !== 1) throw new Error("MongoDB is not connected");
  await connection.db.admin().ping();
}

export async function disconnectDatabase() {
  await mongoose.disconnect();
}
