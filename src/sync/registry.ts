import type { SyncProvider } from "./provider";
import { supabase } from "./providers/supabase";
import { turso } from "./providers/turso";

/** Every sync backend Tidra offers; a new one is a file in `providers/` plus one entry here. */
export const SYNC_PROVIDERS: SyncProvider[] = [turso, supabase];

export function findSyncProvider(id: string): SyncProvider | undefined {
  return SYNC_PROVIDERS.find((provider) => provider.id === id);
}
