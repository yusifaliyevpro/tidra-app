import * as z from "@zod/mini";
import {
  DEFAULT_KDF,
  deriveKeyBytes,
  fromBase64,
  generateRecoveryKey,
  importAesKey,
  keyedHash,
  normalizeRecoveryKey,
  open,
  openBytes,
  randomBytes,
  seal,
  toBase64,
  type KdfParams,
} from "./crypto";

const SealedSchema = z.object({ nonce: z.string(), ciphertext: z.string() });

export const VaultHeaderSchema = z.compile(
  z.object({
    version: z.literal(1),
    kdf: z.object({
      algorithm: z.literal("argon2id"),
      memoryKiB: z.number(),
      iterations: z.number(),
      parallelism: z.number(),
    }),
    passwordSalt: z.string(),
    recoverySalt: z.string(),
    /** The data key wrapped under the password-derived key and under the recovery-key-derived key. */
    wrappedByPassword: SealedSchema,
    wrappedByRecovery: SealedSchema,
  }),
);

export type VaultHeader = z.infer<typeof VaultHeaderSchema>;

const DEK_AAD = "tidra:dek:v1";

/** An unlocked vault: encrypts rows with the data key and hashes table names so the server can't read them. */
export interface Vault {
  readonly rawKey: Uint8Array<ArrayBuffer>;
  encryptRow(
    table: string,
    id: string,
    json: string,
  ): Promise<{ tableHash: string; nonce: string; ciphertext: string }>;
  decryptRow(table: string, id: string, sealed: { nonce: string; ciphertext: string }): Promise<string>;
  tableHash(table: string): Promise<string>;
}

// Binding table and id into the AAD stops a server from swapping one row's ciphertext into another.
const rowAad = (table: string, id: string) => `tidra:row:v1:${table}:${id}`;

export async function vaultFromKey(rawKey: Uint8Array<ArrayBuffer>): Promise<Vault> {
  const key = await importAesKey(rawKey);
  const hashes = new Map<string, Promise<string>>();
  const tableHash = (table: string) => {
    let hash = hashes.get(table);
    if (!hash) {
      hash = keyedHash(rawKey, `table:${table}`);
      hashes.set(table, hash);
    }
    return hash;
  };
  return {
    rawKey,
    tableHash,
    async encryptRow(table, id, json) {
      return { tableHash: await tableHash(table), ...(await seal(key, json, rowAad(table, id))) };
    },
    decryptRow: (table, id, sealed) => open(key, sealed, rowAad(table, id)),
  };
}

async function wrapKey(secret: string, salt: Uint8Array<ArrayBuffer>, kdf: KdfParams, dek: Uint8Array<ArrayBuffer>) {
  return seal(await importAesKey(await deriveKeyBytes(secret, salt, kdf)), dek, DEK_AAD);
}

export interface CreatedVault {
  header: VaultHeader;
  vault: Vault;
  recoveryKey: string;
}

export async function createVault(password: string, kdf: KdfParams = DEFAULT_KDF): Promise<CreatedVault> {
  const dek = randomBytes(32);
  const recoveryKey = generateRecoveryKey();
  const passwordSalt = randomBytes(16);
  const recoverySalt = randomBytes(16);
  const header: VaultHeader = {
    version: 1,
    kdf: { ...kdf, algorithm: "argon2id" },
    passwordSalt: toBase64(passwordSalt),
    recoverySalt: toBase64(recoverySalt),
    wrappedByPassword: await wrapKey(password, passwordSalt, kdf, dek),
    wrappedByRecovery: await wrapKey(normalizeRecoveryKey(recoveryKey), recoverySalt, kdf, dek),
  };
  return { header, vault: await vaultFromKey(dek), recoveryKey };
}

/** Unlocks with the vault password or the recovery key; throws DecryptError for a wrong secret. */
export async function unlockVault(
  header: VaultHeader,
  secret: { password: string } | { recoveryKey: string },
): Promise<Vault> {
  const usePassword = "password" in secret;
  const salt = fromBase64(usePassword ? header.passwordSalt : header.recoverySalt);
  const text = usePassword ? secret.password : normalizeRecoveryKey(secret.recoveryKey);
  const kek = await importAesKey(await deriveKeyBytes(text, salt, header.kdf));
  const dek = await openBytes(kek, usePassword ? header.wrappedByPassword : header.wrappedByRecovery, DEK_AAD);
  return vaultFromKey(dek);
}

/** New password, same data key: only the header changes, no row is re-encrypted. */
export async function changePassword(header: VaultHeader, vault: Vault, newPassword: string): Promise<VaultHeader> {
  const salt = randomBytes(16);
  return {
    ...header,
    passwordSalt: toBase64(salt),
    wrappedByPassword: await wrapKey(newPassword, salt, header.kdf, vault.rawKey),
  };
}

export async function rotateRecoveryKey(
  header: VaultHeader,
  vault: Vault,
): Promise<{ header: VaultHeader; recoveryKey: string }> {
  const recoveryKey = generateRecoveryKey();
  const salt = randomBytes(16);
  return {
    recoveryKey,
    header: {
      ...header,
      recoverySalt: toBase64(salt),
      wrappedByRecovery: await wrapKey(normalizeRecoveryKey(recoveryKey), salt, header.kdf, vault.rawKey),
    },
  };
}

const ConnectionCodeSchema = z.compile(
  z.object({
    v: z.literal(1),
    salt: z.string(),
    kdf: VaultHeaderSchema.shape.kdf,
    nonce: z.string(),
    ciphertext: z.string(),
  }),
);

const CODE_PREFIX = "tidra-connect:";
const CODE_AAD = "tidra:connection:v1";

/** The provider id and credentials, encrypted with the vault password, as one string to paste on a new device. */
export async function encodeConnectionCode(
  connection: unknown,
  password: string,
  kdf: KdfParams = DEFAULT_KDF,
): Promise<string> {
  const salt = randomBytes(16);
  const key = await importAesKey(await deriveKeyBytes(password, salt, kdf));
  const sealed = await seal(key, JSON.stringify(connection), CODE_AAD);
  const payload = { v: 1, salt: toBase64(salt), kdf, ...sealed };
  return CODE_PREFIX + btoa(JSON.stringify(payload));
}

export class InvalidConnectionCodeError extends Error {
  constructor() {
    super("That doesn't look like a Tidra connection code.");
    this.name = "InvalidConnectionCodeError";
  }
}

export async function decodeConnectionCode(code: string, password: string): Promise<unknown> {
  const trimmed = code.trim();
  if (!trimmed.startsWith(CODE_PREFIX)) throw new InvalidConnectionCodeError();
  let payload: unknown;
  try {
    payload = JSON.parse(atob(trimmed.slice(CODE_PREFIX.length)));
  } catch {
    throw new InvalidConnectionCodeError();
  }
  if (!z.validate(ConnectionCodeSchema, payload)) throw new InvalidConnectionCodeError();
  const key = await importAesKey(await deriveKeyBytes(password, fromBase64(payload.salt), payload.kdf));
  return JSON.parse(await open(key, payload, CODE_AAD));
}
