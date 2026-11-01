import * as z from "@zod/mini";
import type { Services } from "./context";

/** Bumped when a snapshot's shape changes, so old cached data is recomputed instead of misread. */
const VERSION = 1;

const isObject = (value: unknown) => typeof value === "object" && value !== null;

/** Computed data written and read only by this app; the version in the key guards against old shapes. */
// oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- T names the shape this app wrote under the key
export async function readSnapshot<T>(svc: Services, key: string): Promise<{ data: T; updatedAt: string } | undefined> {
  return svc.store.getSnapshot(`v${VERSION}:${key}`, z.custom<T>(isObject));
}

/** Several snapshots in one query, in the order of `keys`. */
// oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- T names the shape this app wrote under the keys
export async function readSnapshots<T>(svc: Services, keys: string[]): Promise<(T | undefined)[]> {
  const rows = await svc.store.getSnapshots(keys.map((key) => `v${VERSION}:${key}`));
  return keys.map((key) => {
    const data = rows.get(`v${VERSION}:${key}`)?.data;
    return z.validate(z.custom<T>(isObject), data) ? data : undefined;
  });
}

export async function writeSnapshot(svc: Services, key: string, data: object): Promise<void> {
  await svc.store.setSnapshot(`v${VERSION}:${key}`, data);
}

/** Returns a cached value younger than `maxAgeMs`, otherwise computes, stores and returns a fresh one. */
export async function cached<T extends object>(
  svc: Services,
  key: string,
  maxAgeMs: number,
  compute: () => Promise<T>,
): Promise<T> {
  const hit = await readSnapshot<T>(svc, key);
  if (hit && Date.now() - Date.parse(hit.updatedAt) < maxAgeMs) return hit.data;
  const fresh = await compute();
  await writeSnapshot(svc, key, fresh);
  return fresh;
}

export const HOUR = 3_600_000;
