import mongoose from "mongoose";

/**
 * One-off data changes, applied in order at startup. Each runs once per
 * database: applied IDs are recorded in the `migrations` collection. Several
 * instances may start together, so migrations must be idempotent; if two run
 * the same one, the second simply fails to record it and moves on.
 *
 * Add new migrations to the end and never edit or reorder applied ones.
 */
export const MIGRATIONS = [
  {
    id: "2026-11-27-remove-timer-position",
    description: "Timers no longer have a position; the theme editor places the block.",
    async up(db) {
      // The raw driver, because `position` isn't in the schema anymore.
      const { modifiedCount } = await db
        .collection("timers")
        .updateMany({ position: { $exists: true } }, { $unset: { position: "" } });
      return { modifiedCount };
    },
  },
];

const DUPLICATE_KEY = 11000;

/**
 * @param {{ logger: import("pino").Logger, connection?: import("mongoose").Connection,
 *   migrations?: typeof MIGRATIONS }} options
 */
export async function runMigrations({
  logger,
  connection = mongoose.connection,
  migrations = MIGRATIONS,
}) {
  const log = logger.child({ component: "migrations" });
  const { db } = connection;
  const applied = db.collection("migrations");
  const done = new Set(
    (await applied.find({}, { projection: { _id: 1 } }).toArray()).map(({ _id }) => _id),
  );

  for (const migration of migrations) {
    if (done.has(migration.id)) continue;
    // eslint-disable-next-line no-await-in-loop -- migrations run in order
    const result = await migration.up(db);
    try {
      // eslint-disable-next-line no-await-in-loop
      await applied.insertOne({ _id: migration.id, appliedAt: new Date() });
    } catch (error) {
      // Another instance recorded it first; the migration is idempotent.
      if (error?.code !== DUPLICATE_KEY) throw error;
    }
    log.info({ migration: migration.id, ...result }, "Applied migration");
  }
}
