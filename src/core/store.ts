import * as z from "@zod/mini";
import { and, eq } from "drizzle-orm";
import type { HttpCache } from "@/engine/registry";
import type { Clock } from "@/sync/hlc";
import type { Db } from "./db/client";
import { httpCache, kv, projectPaths, projects, settings, snapshots, watchedRepos } from "./db/schema";

export type Project = typeof projects.$inferSelect;
export type ProjectWithPath = Project & { path: string | undefined };

const now = () => new Date().toISOString();

/** Data access for everything the app stores; synced writes stamp the HLC and device so sync can merge them. */
export function createStore(db: Db, clock: Clock) {
  const stamp = () => ({ hlc: clock.tick(), deviceId: clock.deviceId });

  return {
    db,
    clock,

    async getSetting<S extends z.ZodMiniType>(key: string, schema: S, fallback: z.input<S>): Promise<z.input<S>> {
      const row = await db.query.settings.findFirst({ where: and(eq(settings.id, key), eq(settings.deleted, false)) });
      const value = row?.value;
      return z.validate(schema, value) ? value : fallback;
    },
    async setSetting(key: string, value: unknown) {
      await db
        .insert(settings)
        .values({ id: key, value, ...stamp() })
        .onConflictDoUpdate({ target: settings.id, set: { value, deleted: false, ...stamp() } });
    },

    async getLocal<S extends z.ZodMiniType>(key: string, schema: S, fallback: z.input<S>): Promise<z.input<S>> {
      const row = await db.query.kv.findFirst({ where: eq(kv.key, key) });
      const value = row?.value;
      return z.validate(schema, value) ? value : fallback;
    },
    async setLocal(key: string, value: unknown) {
      await db.insert(kv).values({ key, value }).onConflictDoUpdate({ target: kv.key, set: { value } });
    },

    /** Snapshots are written by this app version; a schema mismatch after an upgrade just means "recompute". */
    async getSnapshot<S extends z.ZodMiniType>(
      key: string,
      schema: S,
    ): Promise<{ data: z.input<S>; updatedAt: string } | undefined> {
      const row = await db.query.snapshots.findFirst({ where: eq(snapshots.key, key) });
      const data = row?.data;
      return row && z.validate(schema, data) ? { data, updatedAt: row.updatedAt } : undefined;
    },
    async setSnapshot(key: string, data: unknown) {
      const updatedAt = now();
      await db
        .insert(snapshots)
        .values({ key, data, updatedAt })
        .onConflictDoUpdate({ target: snapshots.key, set: { data, updatedAt } });
    },

    async listProjects(): Promise<ProjectWithPath[]> {
      const rows = await db
        .select()
        .from(projects)
        .leftJoin(projectPaths, eq(projectPaths.projectId, projects.id))
        .where(eq(projects.deleted, false))
        .orderBy(projects.name);
      return rows.map((row) => ({ ...row.projects, path: row.project_paths?.path }));
    },
    async getProject(id: string): Promise<ProjectWithPath | undefined> {
      const [row] = await db
        .select()
        .from(projects)
        .leftJoin(projectPaths, eq(projectPaths.projectId, projects.id))
        .where(and(eq(projects.id, id), eq(projects.deleted, false)));
      return row ? { ...row.projects, path: row.project_paths?.path } : undefined;
    },
    async addProject(input: { id: string; name: string; remote: string | null; subdir?: string; path: string }) {
      await db
        .insert(projects)
        .values({
          id: input.id,
          name: input.name,
          remote: input.remote,
          subdir: input.subdir ?? "",
          createdAt: now(),
          ...stamp(),
        })
        .onConflictDoUpdate({ target: projects.id, set: { name: input.name, deleted: false, ...stamp() } });
      await db
        .insert(projectPaths)
        .values({ projectId: input.id, path: input.path })
        .onConflictDoUpdate({ target: projectPaths.projectId, set: { path: input.path } });
    },
    async updateProject(
      id: string,
      patch: Partial<Omit<Project, "id" | "hlc" | "deviceId" | "deleted" | "createdAt">>,
    ) {
      await db
        .update(projects)
        .set({ ...patch, ...stamp() })
        .where(eq(projects.id, id));
    },
    async removeProject(id: string) {
      await db
        .update(projects)
        .set({ deleted: true, ...stamp() })
        .where(eq(projects.id, id));
      await db.delete(projectPaths).where(eq(projectPaths.projectId, id));
    },
    async setProjectPath(projectId: string, path: string) {
      await db
        .insert(projectPaths)
        .values({ projectId, path })
        .onConflictDoUpdate({ target: projectPaths.projectId, set: { path } });
    },

    async listWatchedRepos() {
      return db
        .select()
        .from(watchedRepos)
        .where(eq(watchedRepos.deleted, false))
        .orderBy(watchedRepos.owner, watchedRepos.repo);
    },
    async watchRepo(owner: string, repo: string) {
      const id = `${owner}/${repo}`.toLowerCase();
      await db
        .insert(watchedRepos)
        .values({ id, owner, repo, ...stamp() })
        .onConflictDoUpdate({ target: watchedRepos.id, set: { deleted: false, ...stamp() } });
    },
    async unwatchRepo(id: string) {
      await db
        .update(watchedRepos)
        .set({ deleted: true, ...stamp() })
        .where(eq(watchedRepos.id, id));
    },

    httpCache: {
      get: async (key) => {
        const row = await db.query.httpCache.findFirst({ where: eq(httpCache.key, key) });
        return row ? { etag: row.etag ?? undefined, body: row.body } : undefined;
      },
      set: async (key, value) => {
        const row = { etag: value.etag ?? null, body: value.body, storedAt: now() };
        await db
          .insert(httpCache)
          .values({ key, ...row })
          .onConflictDoUpdate({ target: httpCache.key, set: row });
      },
    } satisfies HttpCache,
  };
}

export type Store = ReturnType<typeof createStore>;
