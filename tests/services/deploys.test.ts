import { describe, expect, it } from "vitest";
import { SECRET_KEYS } from "@/core/secrets";
import { readDeploys, refreshDeploys } from "@/services/deploys";
import { jsonResponse, memoryIo } from "../support/memory-io";
import { testServices } from "../support/services";

describe("refreshDeploys", () => {
  it("asks only providers with every secret set, newest deployment first", async () => {
    const urls: string[] = [];
    const io = memoryIo(
      {},
      {
        fetch: async (input) => {
          const url = new Request(input).url;
          urls.push(url);
          if (url.includes("vercel"))
            return jsonResponse({
              deployments: [
                {
                  uid: "v1",
                  name: "web",
                  url: "web.vercel.app",
                  readyState: "READY",
                  created: Date.parse("2026-11-01T00:00:00Z"),
                },
              ],
            });
          return jsonResponse({
            result: [
              {
                name: "pages",
                latest_deployment: { id: "c1", url: "https://p.pages.dev", created_on: "2026-11-02T00:00:00Z" },
              },
            ],
          });
        },
      },
    );
    const { svc, close } = await testServices(io);
    await svc.setSecret(SECRET_KEYS.vercel, "vt");
    await svc.setSecret(SECRET_KEYS.cloudflare, "ct");
    await svc.setSecret(SECRET_KEYS.cloudflareAccount, "acc");
    await refreshDeploys(svc);
    const snapshot = await readDeploys(svc);
    close();
    expect(snapshot?.configured).toEqual(["vercel", "cloudflare"]);
    expect(snapshot?.deployments.map((d) => d.id)).toEqual(["c1", "v1"]);
    expect(urls.some((u) => u.includes("netlify"))).toBe(false);
  });

  it("keeps the other providers when one fails, naming the failing one", async () => {
    const io = memoryIo(
      {},
      {
        fetch: async (input) =>
          new Request(input).url.includes("vercel") ? new Response("{}", { status: 401 }) : jsonResponse([]),
      },
    );
    const { svc, close } = await testServices(io);
    await svc.setSecret(SECRET_KEYS.vercel, "vt");
    await svc.setSecret(SECRET_KEYS.netlify, "nt");
    const snapshot = await refreshDeploys(svc);
    close();
    expect(snapshot.errors).toEqual([{ provider: "Vercel", message: "api.vercel.com returned 401" }]);
    expect(snapshot.configured).toEqual(["vercel", "netlify"]);
  });

  it("does nothing without any provider configured", async () => {
    const { svc, close } = await testServices();
    expect(await refreshDeploys(svc)).toMatchObject({ deployments: [], errors: [], configured: [] });
    close();
  });
});
