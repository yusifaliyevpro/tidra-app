import { createLimit } from "@/engine/limit";
import type { Services } from "./context";
import { refreshCi } from "./github-feed";
import { runRepoAction, type RepoGroup } from "./repos";

/** Fetches each repo's git and reloads its CI side by side, so both columns on Repos are current. */
export async function refreshRepos(svc: Services, repos: RepoGroup[]): Promise<void> {
  const limit = createLimit(4);
  const github = new Set(repos.flatMap((repo) => (repo.github ? [repo.github] : [])));
  await Promise.all([
    ...repos.map((repo) => limit(() => runRepoAction(svc, repo, "fetch").catch(() => undefined))),
    github.size > 0 ? refreshCi(svc, github) : undefined,
  ]);
}
