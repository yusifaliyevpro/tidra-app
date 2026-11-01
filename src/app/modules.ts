import {
  Activity,
  Bot,
  Boxes,
  FolderGit2,
  GitBranch,
  GitPullRequest,
  LayoutDashboard,
  Package,
  Rocket,
  ScrollText,
  Settings,
  ShieldAlert,
  SquareTerminal,
  Wrench,
  Workflow,
  type LucideIcon,
} from "lucide-react";

export interface ModuleDef {
  id: string;
  title: string;
  path: string;
  icon: LucideIcon;
  /** `g` then this key jumps to the module. */
  key: string;
  group: "main" | "github" | "more";
}

/** Sidebar order and keyboard shortcuts; routes live in `src/routes`. */
export const MODULES: ModuleDef[] = [
  { id: "home", title: "Overview", path: "/", icon: LayoutDashboard, key: "h", group: "main" },
  { id: "projects", title: "Projects", path: "/projects", icon: FolderGit2, key: "p", group: "main" },
  { id: "security", title: "Security", path: "/security", icon: ShieldAlert, key: "s", group: "main" },
  { id: "changelogs", title: "Changelogs", path: "/changelogs", icon: ScrollText, key: "l", group: "main" },
  { id: "actions", title: "Actions", path: "/actions", icon: Workflow, key: "a", group: "main" },
  { id: "git", title: "Git", path: "/git", icon: GitBranch, key: "g", group: "main" },
  { id: "inbox", title: "Pull requests", path: "/inbox", icon: GitPullRequest, key: "i", group: "github" },
  { id: "ci", title: "CI", path: "/ci", icon: Activity, key: "c", group: "github" },
  { id: "bots", title: "Bot PRs", path: "/bots", icon: Bot, key: "b", group: "github" },
  { id: "deploys", title: "Deploys", path: "/deploys", icon: Rocket, key: "r", group: "more" },
  { id: "packages", title: "My packages", path: "/packages", icon: Package, key: "k", group: "more" },
  { id: "toolchain", title: "Toolchain", path: "/toolchain", icon: Wrench, key: "t", group: "more" },
  { id: "scripts", title: "Scripts", path: "/scripts", icon: SquareTerminal, key: "x", group: "more" },
  { id: "settings", title: "Settings", path: "/settings", icon: Settings, key: ",", group: "more" },
];

export const MODULE_ICON_FALLBACK = Boxes;
