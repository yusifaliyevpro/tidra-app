import { describe, expect, it } from "vitest";
import { bumpPackageJson, bumpReadme, nextVersion } from "../../scripts/release";

describe("nextVersion", () => {
  it("bumps the patch, or the minor and resets the patch", () => {
    expect(nextVersion("1.0.3", "patch")).toBe("1.0.4");
    expect(nextVersion("1.0.3", "minor")).toBe("1.1.0");
    expect(nextVersion("1.9.9", "minor")).toBe("1.10.0");
  });

  it("refuses a version that isn't x.y.z", () => {
    expect(() => nextVersion("1.0.0-beta.1", "patch")).toThrow("isn't x.y.z");
  });
});

describe("bumpPackageJson", () => {
  it("changes only the top-level version", () => {
    const pkg = '{\n  "name": "tidra",\n  "version": "1.0.3",\n  "devEngines": { "version": "1.0.3" }\n}\n';
    expect(bumpPackageJson(pkg, "1.0.3", "1.0.4")).toBe(
      '{\n  "name": "tidra",\n  "version": "1.0.4",\n  "devEngines": { "version": "1.0.3" }\n}\n',
    );
  });
});

describe("bumpReadme", () => {
  it("moves every download link and nothing else", () => {
    const readme =
      'Since 1.0.3.\n<a href="https://github.com/o/r/releases/download/v1.0.3/Tidra_1.0.3_x64-setup.exe">x</a>\n' +
      '<a href="https://github.com/o/r/releases/download/v1.0.3/Tidra-1.0.3-1.x86_64.rpm">.rpm</a>\n';
    expect(bumpReadme(readme, "1.0.3", "1.1.0")).toBe(
      'Since 1.0.3.\n<a href="https://github.com/o/r/releases/download/v1.1.0/Tidra_1.1.0_x64-setup.exe">x</a>\n' +
        '<a href="https://github.com/o/r/releases/download/v1.1.0/Tidra-1.1.0-1.x86_64.rpm">.rpm</a>\n',
    );
  });
});
