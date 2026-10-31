import { describe, expect, it } from "vitest";
import { DecryptError, generateRecoveryKey, normalizeRecoveryKey, type KdfParams } from "@/sync/crypto";
import {
  changePassword,
  createVault,
  decodeConnectionCode,
  encodeConnectionCode,
  InvalidConnectionCodeError,
  rotateRecoveryKey,
  unlockVault,
} from "@/sync/vault";

// Small parameters keep tests fast; production uses DEFAULT_KDF.
const FAST: KdfParams = { algorithm: "argon2id", memoryKiB: 256, iterations: 1, parallelism: 1 };

describe("recovery keys", () => {
  it("are 128-bit Crockford base32 in groups", () => {
    const key = generateRecoveryKey();
    expect(key).toMatch(/^TIDRA-([0-9A-HJKMNP-TV-Z]{5}-){5}[0-9A-HJKMNP-TV-Z]{1}$/);
    expect(generateRecoveryKey()).not.toBe(key);
  });

  it("tolerate case, spacing and look-alike characters", () => {
    expect(normalizeRecoveryKey("tidra-abcio l0")).toBe(normalizeRecoveryKey("TIDRA-ABC10-10"));
  });
});

describe("vault", () => {
  it("encrypts rows so table and id are bound to the ciphertext", async () => {
    const { vault } = await createVault("correct horse", FAST);
    const sealed = await vault.encryptRow("projects", "p1", '{"name":"secret-project"}');
    expect(sealed.ciphertext).not.toContain("secret-project");
    expect(sealed.tableHash).not.toContain("projects");
    expect(await vault.decryptRow("projects", "p1", sealed)).toBe('{"name":"secret-project"}');
    await expect(vault.decryptRow("projects", "p2", sealed)).rejects.toBeInstanceOf(DecryptError);
    await expect(vault.decryptRow("settings", "p1", sealed)).rejects.toBeInstanceOf(DecryptError);
  });

  it("uses a fresh nonce for every write", async () => {
    const { vault } = await createVault("pw", FAST);
    const a = await vault.encryptRow("t", "1", "same");
    const b = await vault.encryptRow("t", "1", "same");
    expect(a.nonce).not.toBe(b.nonce);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it("unlocks with the password or the recovery key, and rejects wrong ones", async () => {
    const { header, vault, recoveryKey } = await createVault("pw", FAST);
    const sealed = await vault.encryptRow("t", "1", "hello");
    for (const secret of [{ password: "pw" }, { recoveryKey: recoveryKey.toLowerCase() }]) {
      expect(await (await unlockVault(header, secret)).decryptRow("t", "1", sealed)).toBe("hello");
    }
    await expect(unlockVault(header, { password: "nope" })).rejects.toBeInstanceOf(DecryptError);
    await expect(unlockVault(header, { recoveryKey: generateRecoveryKey() })).rejects.toBeInstanceOf(DecryptError);
  });

  it("detects a tampered header", async () => {
    const { header } = await createVault("pw", FAST);
    const tampered = {
      ...header,
      wrappedByPassword: { ...header.wrappedByPassword, nonce: header.wrappedByRecovery.nonce },
    };
    await expect(unlockVault(tampered, { password: "pw" })).rejects.toBeInstanceOf(DecryptError);
  });

  it("changes the password and rotates the recovery key without changing the data key", async () => {
    const created = await createVault("old", FAST);
    const sealed = await created.vault.encryptRow("t", "1", "kept");

    const header = await changePassword(created.header, created.vault, "new");
    await expect(unlockVault(header, { password: "old" })).rejects.toBeInstanceOf(DecryptError);
    expect(await (await unlockVault(header, { password: "new" })).decryptRow("t", "1", sealed)).toBe("kept");

    const rotated = await rotateRecoveryKey(header, created.vault);
    await expect(unlockVault(rotated.header, { recoveryKey: created.recoveryKey })).rejects.toBeInstanceOf(
      DecryptError,
    );
    expect(
      await (await unlockVault(rotated.header, { recoveryKey: rotated.recoveryKey })).decryptRow("t", "1", sealed),
    ).toBe("kept");
  });
});

describe("connection codes", () => {
  it("round-trip with the password and hide the credentials", async () => {
    const connection = { provider: "turso", url: "libsql://db.turso.io", authToken: "very-secret-token" };
    const code = await encodeConnectionCode(connection, "pw", FAST);
    expect(code.startsWith("tidra-connect:")).toBe(true);
    expect(atob(code.slice(14))).not.toContain("very-secret-token");
    expect(await decodeConnectionCode(`  ${code}\n`, "pw")).toEqual(connection);
    await expect(decodeConnectionCode(code, "wrong")).rejects.toBeInstanceOf(DecryptError);
  });

  it("rejects text that is not a connection code", async () => {
    await expect(decodeConnectionCode("hello", "pw")).rejects.toBeInstanceOf(InvalidConnectionCodeError);
    await expect(decodeConnectionCode("tidra-connect:%%%", "pw")).rejects.toBeInstanceOf(InvalidConnectionCodeError);
  });
});
