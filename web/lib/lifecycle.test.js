import { EventEmitter } from "node:events";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createLifecycle } from "./lifecycle.js";
import { silentLogger as logger } from "./logger.js";

describe("createLifecycle", () => {
  let exit;

  beforeEach(() => {
    exit = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("tracks readiness", () => {
    const lifecycle = createLifecycle({ logger, timeoutMs: 1_000, exit });
    expect(lifecycle.state).toBe("starting");
    expect(lifecycle.isReady()).toBe(false);

    lifecycle.markReady();
    expect(lifecycle.isReady()).toBe(true);

    lifecycle.shutdown({ reason: "test" });
    expect(lifecycle.isReady()).toBe(false);
    expect(lifecycle.isShuttingDown()).toBe(true);
  });

  it("runs shutdown hooks in reverse order, then exits", async () => {
    const lifecycle = createLifecycle({ logger, timeoutMs: 1_000, exit });
    const order = [];
    lifecycle.onShutdown("database", () => order.push("database"));
    lifecycle.onShutdown("sessions", async () => order.push("sessions"));
    lifecycle.onShutdown("http", () => order.push("http"));

    await lifecycle.shutdown({ reason: "SIGTERM" });

    expect(order).toEqual(["http", "sessions", "database"]);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("keeps going when a hook fails", async () => {
    const lifecycle = createLifecycle({ logger, timeoutMs: 1_000, exit });
    const closed = vi.fn();
    lifecycle.onShutdown("database", closed);
    lifecycle.onShutdown("http", () => {
      throw new Error("boom");
    });

    await lifecycle.shutdown({ reason: "SIGTERM" });

    expect(closed).toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("only shuts down once", async () => {
    const lifecycle = createLifecycle({ logger, timeoutMs: 1_000, exit });
    const hook = vi.fn();
    lifecycle.onShutdown("http", hook);

    const first = lifecycle.shutdown({ reason: "SIGTERM" });
    const second = lifecycle.shutdown({ reason: "SIGINT", exitCode: 1 });

    expect(second).toBe(first);
    await first;
    expect(hook).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("forces exit when hooks exceed the timeout", async () => {
    vi.useFakeTimers();
    const lifecycle = createLifecycle({ logger, timeoutMs: 5_000, exit });
    lifecycle.onShutdown("stuck", () => new Promise(() => {}));

    const done = lifecycle.shutdown({ reason: "SIGTERM" });
    await vi.advanceTimersByTimeAsync(5_000);
    await done;

    expect(exit).toHaveBeenCalledWith(1);
  });

  describe("process handlers", () => {
    it("shuts down gracefully on SIGTERM and exits immediately on a second signal", async () => {
      const proc = new EventEmitter();
      const lifecycle = createLifecycle({ logger, timeoutMs: 1_000, exit });
      let release;
      lifecycle.onShutdown(
        "http",
        () =>
          new Promise((resolve) => {
            release = resolve;
          }),
      );
      lifecycle.installProcessHandlers(proc);

      proc.emit("SIGTERM");
      expect(lifecycle.isShuttingDown()).toBe(true);
      expect(exit).not.toHaveBeenCalled();

      proc.emit("SIGINT");
      expect(exit).toHaveBeenCalledWith(1);
      release();
    });

    it.each(["uncaughtException", "unhandledRejection"])(
      "shuts down with exit code 1 on %s",
      async (event) => {
        const proc = new EventEmitter();
        const lifecycle = createLifecycle({ logger, timeoutMs: 1_000, exit });
        lifecycle.installProcessHandlers(proc);

        proc.emit(event, new Error("fatal"));
        await lifecycle.shutdown({ reason: "already running" });

        expect(exit).toHaveBeenCalledWith(1);
      },
    );
  });
});
