import http from "node:http";
import { setTimeout as delay } from "node:timers/promises";

import express from "express";
import { afterEach, describe, expect, it } from "vitest";

import { closeServer, createHttpServer, listen } from "./http-server.js";

const TIMEOUTS = { keepAliveTimeoutMs: 65_000, headersTimeoutMs: 66_000, requestTimeoutMs: 30_000 };

// Keep-alive by default, like browsers and load balancers.
const keepAlive = () => new http.Agent({ keepAlive: true });

function get(port, path, agent = keepAlive()) {
  return new Promise((resolve, reject) => {
    http
      .get({ port, path, agent }, (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => resolve({ status: res.statusCode, body }));
      })
      .on("error", reject);
  });
}

describe("http server", () => {
  let server;

  afterEach(async () => {
    if (server?.listening) await closeServer(server, { drainTimeoutMs: 100 });
  });

  it("applies production timeouts", () => {
    server = createHttpServer(express(), TIMEOUTS);
    expect(server.keepAliveTimeout).toBe(65_000);
    expect(server.headersTimeout).toBe(66_000);
    expect(server.requestTimeout).toBe(30_000);
  });

  it("rejects when the port is taken", async () => {
    server = createHttpServer(express(), TIMEOUTS);
    const { port } = await listen(server, 0);
    const other = createHttpServer(express(), TIMEOUTS);
    await expect(listen(other, port)).rejects.toMatchObject({ code: "EADDRINUSE" });
  });

  it("finishes in-flight requests and refuses new connections while draining", async () => {
    let finishSlowRequest;
    const app = express();
    app.get("/slow", (_req, res) => {
      finishSlowRequest = () => res.send("done");
    });
    server = createHttpServer(app, TIMEOUTS);
    const { port } = await listen(server, 0);

    const inFlight = get(port, "/slow");
    await delay(50);

    const closing = closeServer(server, { drainTimeoutMs: 5_000 });
    await expect(get(port, "/slow")).rejects.toMatchObject({ code: "ECONNREFUSED" });

    finishSlowRequest();
    await expect(inFlight).resolves.toEqual({ status: 200, body: "done" });
    await expect(closing).resolves.toEqual({ forced: false });
  });

  it("closes idle keep-alive connections right away", async () => {
    const app = express();
    app.get("/", (_req, res) => res.send("ok"));
    server = createHttpServer(app, TIMEOUTS);
    const { port } = await listen(server, 0);
    const agent = new http.Agent({ keepAlive: true });

    await get(port, "/", agent);
    const started = Date.now();
    await closeServer(server, { drainTimeoutMs: 5_000 });

    expect(Date.now() - started).toBeLessThan(1_000);
    agent.destroy();
  });

  it("destroys connections still busy after the drain timeout", async () => {
    const app = express();
    app.get("/hang", () => {});
    server = createHttpServer(app, TIMEOUTS);
    const { port } = await listen(server, 0);

    const hanging = get(port, "/hang").catch((error) => error);
    await delay(50);

    await expect(closeServer(server, { drainTimeoutMs: 100 })).resolves.toEqual({ forced: true });
    expect(await hanging).toMatchObject({ code: "ECONNRESET" });
  });
});
