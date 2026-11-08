import type { HomeSummary, ProjectHealth } from "./home";

export type TaskKind =
  | "advisory"
  | "ci"
  | "deploy"
  | "pulls-failing"
  | "review"
  | "major"
  | "uncommitted"
  | "unpushed"
  | "release"
  | "minor";

export type TaskTarget =
  | { kind: "project"; projectId: string; tab?: "git" }
  | { kind: "security"; projectId: string }
  | { kind: "projects"; filter: "updates" }
  | { kind: "inbox" }
  | { kind: "changelogs" }
  | { kind: "url"; url: string };

export interface HomeTask {
  key: string;
  kind: TaskKind;
  /** Rendered as before, bold subject, after: "Critical advisory in **web**". */
  title: [string, string, string];
  detail?: string;
  /** The button's verb. */
  action: string;
  target: TaskTarget;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const RELEASE_WINDOW_MS = 7 * 86_400_000;

function advisoryTask(h: ProjectHealth): HomeTask | undefined {
  const { critical, high } = h.security;
  if (critical + high === 0 && !h.failsAudit) return undefined;
  const title: HomeTask["title"] =
    critical > 0
      ? [critical === 1 ? "Critical advisory in " : `${critical} critical advisories in `, h.name, ""]
      : high > 0
        ? [high === 1 ? "High advisory in " : `${high} high advisories in `, h.name, ""]
        : ["", h.name, " fails the security audit"];
  return {
    key: `advisory:${h.id}`,
    kind: "advisory",
    title,
    action: "Fix",
    target: { kind: "security", projectId: h.id },
  };
}

function groupedProjects(
  kind: "major" | "minor",
  rows: ProjectHealth[],
  count: (h: ProjectHealth) => number,
  label: string,
): HomeTask[] {
  if (rows.length === 0) return [];
  const [only] = rows;
  if (rows.length === 1 && only) {
    return [
      {
        key: `${kind}:${only.id}`,
        kind,
        title: ["", only.name, ` has ${plural(count(only), label)}`],
        action: "Review",
        target: { kind: "project", projectId: only.id },
      },
    ];
  }
  return [
    {
      key: kind,
      kind,
      title: ["", plural(rows.length, "project"), ` have ${label}s`],
      detail: rows.map((h) => h.name).join(", "),
      action: "Review",
      target: { kind: "projects", filter: "updates" },
    },
  ];
}

/** Everything on Home that wants the user, most urgent first, each with the one action that deals with it. */
export function homeTasks(home: HomeSummary, now = Date.now()): HomeTask[] {
  const byScore = home.health.toSorted((a, b) => b.score - a.score);
  const tasks: HomeTask[] = [];

  for (const h of byScore) {
    const task = advisoryTask(h);
    if (task) tasks.push(task);
  }
  for (const run of home.ci.failing) {
    tasks.push({
      key: `ci:${run.repo}`,
      kind: "ci",
      title: ["CI failing on ", run.name, ""],
      detail: run.title,
      action: "Open run",
      target: { kind: "url", url: run.url },
    });
  }
  for (const deploy of home.deploys.failing) {
    tasks.push({
      key: `deploy:${deploy.project}`,
      kind: "deploy",
      title: ["Deploy failed for ", deploy.project, ""],
      detail: deploy.provider,
      action: "Open",
      target: deploy.url ? { kind: "url", url: deploy.url } : { kind: "inbox" },
    });
  }
  if (home.myPullsFailing > 0) {
    tasks.push({
      key: "pulls-failing",
      kind: "pulls-failing",
      title: ["", plural(home.myPullsFailing, "pull request"), " of yours failing checks"],
      action: "Open",
      target: { kind: "inbox" },
    });
  }
  if (home.reviewRequests > 0) {
    tasks.push({
      key: "review",
      kind: "review",
      title: ["", plural(home.reviewRequests, "review request"), ""],
      action: "Open",
      target: { kind: "inbox" },
    });
  }
  tasks.push(
    ...groupedProjects(
      "major",
      byScore.filter((h) => h.updates.major > 0),
      (h) => h.updates.major,
      "major update",
    ),
  );
  for (const h of byScore) {
    if (h.changed > 0) {
      tasks.push({
        key: `uncommitted:${h.id}`,
        kind: "uncommitted",
        title: ["", h.name, ` has ${plural(h.changed, "uncommitted file")}`],
        detail: h.branch,
        action: "Review",
        target: { kind: "project", projectId: h.id, tab: "git" },
      });
    } else if (h.ahead > 0) {
      tasks.push({
        key: `unpushed:${h.id}`,
        kind: "unpushed",
        title: ["", h.name, ` has ${plural(h.ahead, "unpushed commit")}`],
        detail: h.branch,
        action: "Review",
        target: { kind: "project", projectId: h.id, tab: "git" },
      });
    }
  }
  for (const release of home.releases) {
    if (!release.major || now - Date.parse(release.publishedAt) > RELEASE_WINDOW_MS) continue;
    tasks.push({
      key: `release:${release.repo}@${release.tag}`,
      kind: "release",
      title: ["", release.packageName ?? release.repo, ` ${release.tag} released`],
      detail: release.usedBy.length > 0 ? `Used by ${release.usedBy.join(", ")}` : undefined,
      action: "Read notes",
      target: { kind: "changelogs" },
    });
  }
  tasks.push(
    ...groupedProjects(
      "minor",
      byScore.filter((h) => h.updates.major === 0 && h.updates.minor + h.updates.patch > 0),
      (h) => h.updates.minor + h.updates.patch,
      "update",
    ),
  );
  return tasks;
}
