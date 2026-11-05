import { describe, expect, it } from "vitest";
import { SECRET_KEYS } from "@/core/secrets";
import type { ChangelogEntry } from "@/engine/changelog";
import { AiRefusalError, buildUpgradePrompt, summarizeUpgrade } from "@/integrations/ai";
import { aiReady, readUpgradeSummary, summarize } from "@/services/ai";
import { jsonResponse, memoryIo } from "../support/memory-io";
import { testServices } from "../support/services";

const entry = (version: string, body: string): ChangelogEntry => ({ version, title: version, body, breaking: false });

const anthropicAnswer = (text: string, stopReason = "end_turn") =>
  jsonResponse({
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: "claude-opus-5-5",
    content: [{ type: "text", text }],
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 5 },
  });

describe("buildUpgradePrompt", () => {
  it("wraps each release's notes, oldest first, and names both versions", () => {
    const prompt = buildUpgradePrompt("vite", "7.0.0", "8.0.0", [entry("7.1.0", "- a"), entry("8.0.0", "")]);
    expect(prompt).toBe(
      'Upgrade vite from 7.0.0 to 8.0.0.\n\n<release_notes>\n<release version="7.1.0">\n- a\n</release>\n\n<release version="8.0.0">\n(no notes)\n</release>\n</release_notes>',
    );
  });

  it("says when the installed version is unknown", () => {
    expect(buildUpgradePrompt("a", undefined, "1.0.0", [])).toContain("from an unknown version to 1.0.0");
  });

  it("truncates one huge release so it can't crowd out the rest", () => {
    const prompt = buildUpgradePrompt("a", "1.0.0", "2.0.0", [
      entry("2.0.0", "x".repeat(100_000)),
      entry("1.5.0", "small"),
    ]);
    expect(prompt).toContain("[truncated]");
    expect(prompt).toContain("small");
    expect(prompt.length).toBeLessThan(31_000);
  });

  it("keeps the notes near 60,000 characters however many releases there are", () => {
    const entries = Array.from({ length: 200 }, (_, i) => entry(`1.${i}.0`, "y".repeat(5_000)));
    expect(buildUpgradePrompt("a", "1.0.0", "2.0.0", entries).length).toBeLessThan(80_000);
  });
});

describe("summarizeUpgrade", () => {
  it("asks the configured model and returns its trimmed text", async () => {
    const requests: { url: string; body: { model: string; system: { text: string }[] } }[] = [];
    const text = await summarizeUpgrade({
      config: { provider: "anthropic", model: "claude-opus-5-5" },
      apiKey: "sk-test",
      prompt: "Upgrade a",
      fetch: async (input, init) => {
        requests.push({
          url: new Request(input).url,
          body: JSON.parse(typeof init?.body === "string" ? init.body : "{}"),
        });
        return anthropicAnswer("  Nothing breaking.  \n");
      },
    });
    expect(text).toBe("Nothing breaking.");
    expect(requests[0]?.url).toBe("https://api.anthropic.com/v1/messages");
    expect(requests[0]?.body.model).toBe("claude-opus-5-5");
    expect(requests[0]?.body.system[0]?.text).toContain("Breaking changes");
  });

  it("rejects an unknown provider", async () => {
    await expect(
      summarizeUpgrade({ config: { provider: "nope", model: "x" }, apiKey: "k", prompt: "p", fetch: globalThis.fetch }),
    ).rejects.toThrow('Unknown AI provider "nope".');
  });

  it("raises a refusal as its own error", async () => {
    await expect(
      summarizeUpgrade({
        config: { provider: "anthropic", model: "claude-opus-5-5" },
        apiKey: "k",
        prompt: "p",
        fetch: async () => anthropicAnswer("", "refusal"),
      }),
    ).rejects.toBeInstanceOf(AiRefusalError);
  });
});

describe("AI service", () => {
  it("needs a key for the configured provider", async () => {
    const { svc, close } = await testServices();
    expect(await aiReady(svc)).toBe(false);
    await expect(summarize(svc, { name: "a", from: "1.0.0", to: "2.0.0", entries: [] })).rejects.toThrow(
      "Add an AI API key",
    );
    await svc.setSecret(SECRET_KEYS.anthropic, "sk-test");
    expect(await aiReady(svc)).toBe(true);
    close();
  });

  it("caches each summary per package and version range", async () => {
    let calls = 0;
    const io = memoryIo({}, { fetch: async () => (calls++, anthropicAnswer("Rename foo to bar.")) });
    const { svc, close } = await testServices(io);
    await svc.setSecret(SECRET_KEYS.anthropic, "sk-test");
    const result = await summarize(svc, {
      name: "a",
      from: "1.0.0",
      to: "2.0.0",
      entries: [entry("2.0.0", "- renamed")],
    });
    const cached = await readUpgradeSummary(svc, "a", "1.0.0", "2.0.0");
    const other = await readUpgradeSummary(svc, "a", "1.5.0", "2.0.0");
    close();
    expect(result).toEqual({ text: "Rename foo to bar.", model: "claude-opus-5-5" });
    expect(cached).toEqual(result);
    expect(other).toBeUndefined();
    expect(calls).toBe(1);
  });
});

describe("buildUpgradePrompt budget", () => {
  it("shares the budget evenly across releases", () => {
    const prompt = buildUpgradePrompt("a", "1.0.0", "2.0.0", [
      entry("1.1.0", "x".repeat(40_000)),
      entry("1.2.0", "y".repeat(40_000)),
      entry("1.3.0", "z".repeat(40_000)),
    ]);
    for (const letter of ["x", "y", "z"]) expect(prompt.split(letter).length - 1).toBeGreaterThanOrEqual(20_000);
  });
});
