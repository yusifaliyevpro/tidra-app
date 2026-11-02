import { describe, expect, it } from "vitest";
import { createGitHub } from "@/integrations/github";

describe("rateLimit", () => {
  it("reads the REST budget from the body of /rate_limit", async () => {
    const urls: string[] = [];
    const github = createGitHub({
      token: "t",
      fetch: async (input) => {
        urls.push(new Request(input).url);
        return Response.json(
          {
            resources: {
              core: { limit: 5000, used: 61, remaining: 4939, reset: 1_793_000_000 },
              graphql: { limit: 5000, used: 0, remaining: 5000, reset: 1_793_000_500 },
            },
          },
          { headers: { "x-ratelimit-resource": "core", "x-ratelimit-remaining": "4900" } },
        );
      },
    });
    expect(await github.rateLimit()).toEqual({ limit: 5000, remaining: 4939 });
    expect(urls).toEqual(["https://api.github.com/rate_limit"]);
  });
});
