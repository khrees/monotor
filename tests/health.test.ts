import { describe, expect, it } from "bun:test";
import { createApp } from "../src/app";
import { createMonoCache } from "../src/lib/mono";

function mockFetcher(xml: string) {
  return async () =>
    new Response(xml, { status: 200, headers: { "Content-Type": "application/xml" } });
}

describe("health & root", () => {
  const app = createApp(createMonoCache());

  it("GET / returns service info", async () => {
    const res = await app.handle(new Request("http://localhost/"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe("mono-uptime");
    expect(body.endpoints).toContain("/api/uptime");
  });

  it("GET /health", async () => {
    const res = await app.handle(new Request("http://localhost/health"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(typeof body.uptime).toBe("number");
  });

  it("404 for unknown route", async () => {
    const res = await app.handle(new Request("http://localhost/unknown-xyz"));
    expect(res.status).toBe(404);
  });
});
