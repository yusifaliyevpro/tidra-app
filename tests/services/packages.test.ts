import { describe, expect, it } from "vitest";
import { SECRET_KEYS } from "@/core/secrets";
import { NPM_USERNAME_SETTING, readPackages, refreshPackages } from "@/services/packages";
import { jsonResponse, memoryIo } from "../support/memory-io";
import { testServices } from "../support/services";

const days = (counts: number[]) => ({
  downloads: counts.map((downloads, i) => ({ day: `2026-10-${10 + i}`, downloads })),
});

describe("refreshPackages", () => {
  it("does nothing until an npm username is set", async () => {
    const { svc, close } = await testServices();
    expect(await refreshPackages(svc)).toBeUndefined();
    close();
  });

  it("adds weekly downloads and GitHub stars, most downloaded first", async () => {
    const io = memoryIo(
      {},
      {
        fetch: async (input) => {
          const url = new Request(input).url;
          if (url.includes("/-/v1/search"))
            return jsonResponse({
              objects: [
                { package: { name: "small", version: "1.0.0" } },
                { package: { name: "big", version: "2.0.0", links: { repository: "https://github.com/me/big" } } },
              ],
            });
          if (url.endsWith("last-month/small")) return jsonResponse(days([1, 1, 1, 1, 1, 1, 1, 1]));
          if (url.endsWith("last-month/big")) return jsonResponse(days([100, 100, 100, 100, 100, 100, 100]));
          return jsonResponse({
            full_name: "me/big",
            default_branch: "main",
            stargazers_count: 42,
            open_issues_count: 3,
            html_url: "https://github.com/me/big",
          });
        },
      },
    );
    const { svc, close } = await testServices(io);
    await svc.store.setSetting(NPM_USERNAME_SETTING, "me");
    await svc.setSecret(SECRET_KEYS.github, "ghp_test");
    await refreshPackages(svc);
    const snapshot = await readPackages(svc);
    close();
    expect(snapshot?.packages.map((p) => [p.name, p.weekly, p.stars, p.openIssues])).toEqual([
      ["big", 700, 42, 3],
      ["small", 7, undefined, undefined],
    ]);
  });

  it("records a failed search instead of throwing", async () => {
    const io = memoryIo({}, { fetch: async () => Promise.reject(new Error("offline")) });
    const { svc, close } = await testServices(io);
    await svc.store.setSetting(NPM_USERNAME_SETTING, "me");
    const snapshot = await refreshPackages(svc);
    close();
    expect(snapshot).toMatchObject({ username: "me", packages: [], error: "offline" });
  });
});
