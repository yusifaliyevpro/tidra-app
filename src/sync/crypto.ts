export interface KdfParams {
  algorithm: "argon2id";
  memoryKiB: number;
  iterations: number;
  parallelism: number;
}

export const DEFAULT_KDF: KdfParams = { algorithm: "argon2id", memoryKiB: 64 * 1024, iterations: 3, parallelism: 1 };

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(length));
}

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Derives raw key bytes from a password; slow on purpose, so run it once per unlock. */
export async function deriveKeyBytes(
  password: string,
  salt: Uint8Array,
  params: KdfParams,
): Promise<Uint8Array<ArrayBuffer>> {
  // hash-wasm loads only when a vault is unlocked or created.
  const { argon2id } = await import("hash-wasm");
  const hash = await argon2id({
    password: password.normalize("NFKC"),
    salt,
    memorySize: params.memoryKiB,
    iterations: params.iterations,
    parallelism: params.parallelism,
    hashLength: 32,
    outputType: "binary",
  });
  return new Uint8Array(hash);
}

export function importAesKey(raw: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export interface Sealed {
  nonce: string;
  ciphertext: string;
}

/** AES-256-GCM with a fresh 96-bit nonce; `aad` binds the ciphertext to where it is stored. */
export async function seal(key: CryptoKey, plaintext: string | Uint8Array<ArrayBuffer>, aad: string): Promise<Sealed> {
  const nonce = randomBytes(12);
  const data = typeof plaintext === "string" ? encoder.encode(plaintext) : plaintext;
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce, additionalData: encoder.encode(aad) },
    key,
    data,
  );
  return { nonce: toBase64(nonce), ciphertext: toBase64(new Uint8Array(ciphertext)) };
}

export class DecryptError extends Error {
  constructor() {
    super("Could not decrypt: wrong key, or the data was changed.");
    this.name = "DecryptError";
  }
}

export async function openBytes(key: CryptoKey, sealed: Sealed, aad: string): Promise<Uint8Array<ArrayBuffer>> {
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64(sealed.nonce), additionalData: encoder.encode(aad) },
      key,
      fromBase64(sealed.ciphertext),
    );
    return new Uint8Array(plaintext);
  } catch {
    throw new DecryptError();
  }
}

export async function open(key: CryptoKey, sealed: Sealed, aad: string): Promise<string> {
  return decoder.decode(await openBytes(key, sealed, aad));
}

/** Keyed hash for values the server must compare but never read, such as table names. */
export async function keyedHash(rawKey: Uint8Array<ArrayBuffer>, value: string): Promise<string> {
  const hmacKey = await crypto.subtle.importKey("raw", rawKey, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", hmacKey, encoder.encode(value));
  return toBase64(new Uint8Array(mac)).slice(0, 22);
}

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** 128-bit recovery key as `TIDRA-XXXXX-XXXXX-...`, readable aloud and immune to O/0 and I/1 mix-ups. */
export function generateRecoveryKey(): string {
  const bytes = randomBytes(16);
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += CROCKFORD[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += CROCKFORD[(value << (5 - bits)) & 31];
  return `TIDRA-${out.match(/.{1,5}/g)?.join("-")}`;
}

/** Accepts the key however the user typed it: any case, spaces or dashes, and the usual look-alikes. */
export function normalizeRecoveryKey(input: string): string {
  return input
    .toUpperCase()
    .replace(/^TIDRA/, "")
    .replace(/[\s-]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
}
