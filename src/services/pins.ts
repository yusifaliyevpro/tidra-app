import * as z from "@zod/mini";
import type { Services } from "./context";

export const PINNED_SETTING = "pinnedProjects";
export const pinnedSchema = z.array(z.string());

export async function setPinned(svc: Services, projectId: string, pinned: boolean) {
  const current = await svc.store.getSetting(PINNED_SETTING, pinnedSchema, []);
  const next = pinned ? [...new Set([...current, projectId])] : current.filter((id) => id !== projectId);
  await svc.store.setSetting(PINNED_SETTING, next);
  await svc.queryClient.invalidateQueries({ queryKey: ["setting", PINNED_SETTING] });
}
