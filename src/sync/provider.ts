import type { VaultHeader } from "./vault";

/** What a provider stores per row: everything but the ordering fields is opaque ciphertext. */
export interface EncryptedRow {
  tableHash: string;
  id: string;
  nonce: string;
  ciphertext: string;
  hlc: string;
  deleted: boolean;
  deviceId: string;
}

export interface ProviderField {
  key: string;
  label: string;
  placeholder?: string;
  secret?: boolean;
}

export type ConnectionConfig = Record<string, string>;

export interface SyncConnection {
  /** Creates tables if the provider allows it; providers that can't (Supabase) report what to run instead. */
  ensureSchema(): Promise<void>;
  readHeader(): Promise<VaultHeader | undefined>;
  writeHeader(header: VaultHeader): Promise<void>;
  /** Rows with an HLC greater than `since`, oldest first, at most `limit`. */
  pull(since: string, limit: number): Promise<EncryptedRow[]>;
  /** Upserts rows; the provider keeps whichever version has the greater HLC. */
  push(rows: EncryptedRow[]): Promise<void>;
}

export interface SyncProvider {
  id: string;
  label: string;
  description: string;
  fields: ProviderField[];
  /** SQL the user runs once in the provider's console when the app can't create tables itself. */
  setupSql?: string;
  connect(config: ConnectionConfig, fetcher: typeof fetch): SyncConnection;
}

export class SyncSetupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SyncSetupError";
  }
}
