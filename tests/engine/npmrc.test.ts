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

describe("parseNpmrc edge cases", () => {
  it("skips comments, blank lines and lines without a value", () => {
    const config = parseNpmrc("# comment\n; also a comment\n\nnot-a-setting\nsave-exact=true\n", {});
    expect(config.values).toEqual({ "save-exact": "true" });
  });

  it("keeps everything after the first `=` in a value", () => {
    const config = parseNpmrc("//r.acme.dev/:_auth=dXNlcjpwYXNz==", {});
    expect(config.auth["//r.acme.dev/"]).toEqual({ basic: "dXNlcjpwYXNz==" });
  });

  it("reads CRLF files and double-quoted values", () => {
    const config = parseNpmrc('registry="https://r.acme.dev"\r\nsave-exact=true\r\n', {});
    expect(config.registry).toBe("https://r.acme.dev/");
    expect(config.values["save-exact"]).toBe("true");
  });

  it("expands unknown variables to nothing, so no credential is sent", () => {
    const config = parseNpmrc("//r.acme.dev/:_authToken=${MISSING}", {});
    expect(authHeaderFor(config, "https://r.acme.dev/a")).toBeUndefined();
  });

  it("keys credentials by host and port", () => {
    const config = parseNpmrc("//localhost:4873/:_authToken=local", {});
    expect(authHeaderFor(config, "http://localhost:4873/a")).toBe("Bearer local");
  });

  it("never leaks a credential to a host that only starts with the same name", () => {
    const config = parseNpmrc("//npm.acme.dev/:_authToken=t", {});
    expect(authHeaderFor(config, "https://npm.acme.dev.evil.com/a")).toBeUndefined();
  });

  it("does not change the base config it layers on", () => {
    const base = parseNpmrc("//a.dev/:_authToken=a", {});
    parseNpmrc("//a.dev/:_authToken=b", {}, base);
    expect(base.auth["//a.dev/"]?.token).toBe("a");
  });

  it("unquotes single-quoted values", () => {
    expect(parseNpmrc("registry='https://r.acme.dev'", {}).registry).toBe("https://r.acme.dev/");
  });

  it("authenticates with username and _password", () => {
    const config = parseNpmrc("//nexus.acme.dev/:username=me\n//nexus.acme.dev/:_password=cGFzcw==\n", {});
    expect(authHeaderFor(config, "https://nexus.acme.dev/react")).toBe(`Basic ${btoa("me:pass")}`);
  });
});

describe("registry URLs", () => {
  it("keeps a registry path such as Nexus groups", () => {
    const config = parseNpmrc("registry=https://nexus.acme.dev/repository/npm-group", {});
    expect(packumentUrl(config, "@acme/ui")).toBe("https://nexus.acme.dev/repository/npm-group/@acme%2fui");
  });

  it("uses the default registry for scopes without their own", () => {
    expect(registryFor(parseNpmrc("@acme:registry=https://a.dev", {}), "@other/x")).toBe(DEFAULT_REGISTRY);
  });
});
