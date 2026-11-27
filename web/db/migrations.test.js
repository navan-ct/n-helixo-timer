import mongoose from "mongoose";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { silentLogger } from "../lib/logger.js";
import { insertTimer, startDatabase } from "../test/helpers.js";
import { Timer } from "../timers/timer.model.js";

import { MIGRATIONS, runMigrations } from "./migrations.js";

let stopDatabase;

beforeAll(async () => {
  stopDatabase = await startDatabase();
});

afterAll(async () => {
  await stopDatabase();
});

beforeEach(async () => {
  await Timer.deleteMany({});
  await mongoose.connection.db.collection("migrations").deleteMany({});
});

describe("runMigrations", () => {
  it("removes the retired position field from stored timers", async () => {
    const timer = await insertTimer();
    await Timer.collection.updateOne({ _id: timer._id }, { $set: { position: "bottom" } });

    await runMigrations({ logger: silentLogger });

    const stored = await Timer.collection.findOne({ _id: timer._id });
    expect(stored).not.toHaveProperty("position");
    expect(stored.name).toBe("Seeded timer");
  });

  it("runs each migration once and records it", async () => {
    const up = vi.fn(async () => ({}));
    const migrations = [{ id: "test-once", up }];

    await runMigrations({ logger: silentLogger, migrations });
    await runMigrations({ logger: silentLogger, migrations });

    expect(up).toHaveBeenCalledTimes(1);
    const record = await mongoose.connection.db
      .collection("migrations")
      .findOne({ _id: "test-once" });
    expect(record.appliedAt).toBeInstanceOf(Date);
  });

  it("tolerates another instance recording the same migration first", async () => {
    const migrations = [
      {
        id: "test-race",
        async up(db) {
          // Simulates a concurrent instance finishing first.
          await db.collection("migrations").insertOne({ _id: "test-race", appliedAt: new Date() });
          return {};
        },
      },
    ];
    await expect(runMigrations({ logger: silentLogger, migrations })).resolves.toBeUndefined();
  });

  it("keeps migration IDs unique", () => {
    const ids = MIGRATIONS.map(({ id }) => id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
