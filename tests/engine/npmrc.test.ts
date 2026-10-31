import { describe, expect, it } from "vitest";
import { authHeaderFor, DEFAULT_REGISTRY, packumentUrl, parseNpmrc, registryFor } from "@/engine/npmrc";

const env = { NPM_TOKEN: "secret-token", GH_TOKEN: "gh-token" };

describe("parseNpmrc", () => {
  const config = parseNpmrc(
    [
      "# comment",
      "; also a comment",
      "@acme:registry=https://npm.pkg.github.com",
      "//npm.pkg.github.com/:_authToken=${GH_TOKEN}",
      "//registry.npmjs.org/:_authToken=${NPM_TOKEN}",
      "save-exact=true",
      "minimum-release-age=1440",
    ].join("\n"),
    env,
  );

  it("routes scoped packages to their registry", () => {
    expect(registryFor(config, "@acme/ui")).toBe("https://npm.pkg.github.com/");
    expect(registryFor(config, "react")).toBe(DEFAULT_REGISTRY);
  });

  it("expands environment variables in tokens", () => {
    expect(authHeaderFor(config, "https://npm.pkg.github.com/@acme%2fui")).toBe("Bearer gh-token");
    expect(authHeaderFor(config, "https://registry.npmjs.org/react")).toBe("Bearer secret-token");
  });

  it("keeps other settings as plain values", () => {
    expect(config.values["save-exact"]).toBe("true");
    expect(config.values["minimum-release-age"]).toBe("1440");
  });

  it("encodes the slash of scoped names in packument URLs", () => {
    expect(packumentUrl(config, "@types/node")).toBe("https://registry.npmjs.org/@types%2fnode");
  });
});

describe("layering", () => {
  it("lets the project file override the user file", () => {
    const user = parseNpmrc("registry=https://user.example/\n//user.example/:_authToken=u", {});
    const project = parseNpmrc("registry=https://project.example", {}, user);
    expect(project.registry).toBe("https://project.example/");
    expect(authHeaderFor(project, "https://user.example/a")).toBe("Bearer u");
  });

  it("prefers the most specific credential path", () => {
    const config = parseNpmrc("//host.dev/:_authToken=root\n//host.dev/npm/private/:_authToken=deep", {});
    expect(authHeaderFor(config, "https://host.dev/npm/private/pkg")).toBe("Bearer deep");
    expect(authHeaderFor(config, "https://host.dev/other/pkg")).toBe("Bearer root");
    expect(authHeaderFor(config, "https://elsewhere.dev/pkg")).toBeUndefined();
  });
});
