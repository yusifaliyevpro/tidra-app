import { readFileSync } from "node:fs";
import * as z from "@zod/mini";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const { version } = z.object({ version: z.string() }).parse(JSON.parse(read("package.json")));
const links = [...read("README.md").matchAll(/releases\/download\/[^"\s)]+/g)].map((match) => match[0]);

describe("README download links", () => {
  // Release files carry the version in their names, so bumping package.json means updating these links too.
  it("point at the installers of the version in package.json", () => {
    expect(links).toHaveLength(5);
    expect(links).toEqual([
      `releases/download/v${version}/Tidra_${version}_x64-setup.exe`,
      `releases/download/v${version}/Tidra_${version}_universal.dmg`,
      `releases/download/v${version}/Tidra_${version}_amd64.AppImage`,
      `releases/download/v${version}/Tidra_${version}_amd64.deb`,
      `releases/download/v${version}/Tidra-${version}-1.x86_64.rpm`,
    ]);
  });
});
