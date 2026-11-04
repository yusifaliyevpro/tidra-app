import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/** Columns every synced table carries: HLC timestamp of the last write, tombstone, and the writing device. */
const synced = {
  id: text("id").primaryKey(),
  hlc: text("hlc").notNull(),
  deleted: integer("deleted", { mode: "boolean" }).notNull().default(false),
  deviceId: text("device_id").notNull(),
};

export const projects = sqliteTable("projects", {
  ...synced,
  name: text("name").notNull(),
  /** Normalized git remote (`github.com/owner/repo`), shared across devices; null for local-only repos. */
  remote: text("remote"),
  /** Folder inside the repo (`apps/web`), empty for the repo root; one repo can hold several projects. */
  subdir: text("subdir").notNull().default(""),
  /** Custom check command lines; null means auto-detect from scripts. */
  checks: text("checks", { mode: "json" }).$type<string[] | null>(),
  updateOnBranch: integer("update_on_branch", { mode: "boolean" }).notNull().default(false),
  majorPins: text("major_pins", { mode: "json" }).$type<string[] | null>(),
  createdAt: text("created_at").notNull(),
});

export const watchedRepos = sqliteTable("watched_repos", {
  ...synced,
  owner: text("owner").notNull(),
  repo: text("repo").notNull(),
});

export const settings = sqliteTable("settings", {
  ...synced,
  value: text("value", { mode: "json" }).$type<unknown>(),
});

export const dismissals = sqliteTable("dismissals", {
  ...synced,
  /** Advisory id, or `scope:key` for other dismissible items. */
  target: text("target").notNull(),
  reason: text("reason").notNull().default(""),
});

export const deployLinks = sqliteTable("deploy_links", {
  ...synced,
  projectId: text("project_id").notNull(),
  provider: text("provider").notNull(),
  externalId: text("external_id").notNull(),
  name: text("name").notNull(),
});

export const SYNCED_TABLES = { projects, watchedRepos, settings, dismissals, deployLinks } as const;
export type SyncedTableName = keyof typeof SYNCED_TABLES;

/** Where each device keeps its checkout; never synced because paths differ per machine. */
export const projectPaths = sqliteTable("project_paths", {
  projectId: text("project_id").primaryKey(),
  path: text("path").notNull(),
});

/** Computed results per module (`outdated:<project>`, `inbox`, ...) so every view renders from disk instantly. */
export const snapshots = sqliteTable("snapshots", {
  key: text("key").primaryKey(),
  data: text("data", { mode: "json" }).$type<unknown>().notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const httpCache = sqliteTable("http_cache", {
  key: text("key").primaryKey(),
  etag: text("etag"),
  body: text("body").notNull(),
  storedAt: text("stored_at").notNull(),
});

export const runs = sqliteTable("runs", {
  id: text("id").primaryKey(),
  projectId: text("project_id").notNull(),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  startedAt: text("started_at").notNull(),
  finishedAt: text("finished_at"),
  ok: integer("ok", { mode: "boolean" }),
  result: text("result", { mode: "json" }).$type<unknown>(),
  log: text("log").notNull().default(""),
});

export const notifications = sqliteTable("notifications", {
  /** Stable key so the same event never notifies twice. */
  key: text("key").primaryKey(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  route: text("route"),
  createdAt: text("created_at").notNull(),
  read: integer("read", { mode: "boolean" }).notNull().default(false),
});

export const kv = sqliteTable("kv", {
  key: text("key").primaryKey(),
  value: text("value", { mode: "json" }).$type<unknown>(),
});
