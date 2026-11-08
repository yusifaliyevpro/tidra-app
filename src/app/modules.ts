import {
  Boxes,
  FolderGit2,
  GitPullRequest,
  House,
  Package,
  Rocket,
  ScrollText,
  Settings,
  ShieldAlert,
  SquareTerminal,
  Wrench,
  GitBranch,
  type LucideIcon,
} from "lucide-react";

export interface ModuleDef {
  id: string;
  title: string;
  path: string;
  icon: LucideIcon;
  /** `g` then this key jumps to the module. */
  key: string;
  group: "main" | "tools" | "settings";
}

/** Sidebar order and keyboard shortcuts; routes live in `src/routes`. */
export const MODULES: ModuleDef[] = [
  { id: "home", title: "Home", path: "/", icon: House, key: "h", group: "main" },
  { id: "projects", title: "Projects", path: "/projects", icon: FolderGit2, key: "p", group: "main" },
  { id: "repos", title: "Repos", path: "/repos", icon: GitBranch, key: "r", group: "main" },
  { id: "security", title: "Security", path: "/security", icon: ShieldAlert, key: "s", group: "main" },
  { id: "changelogs", title: "Changelogs", path: "/changelogs", icon: ScrollText, key: "l", group: "main" },
  { id: "inbox", title: "Pull requests", path: "/inbox", icon: GitPullRequest, key: "i", group: "main" },
  { id: "deploys", title: "Deploys", path: "/deploys", icon: Rocket, key: "d", group: "tools" },
  { id: "packages", title: "Packages", path: "/packages", icon: Package, key: "k", group: "tools" },
  { id: "toolchain", title: "Toolchain", path: "/toolchain", icon: Wrench, key: "t", group: "tools" },
  { id: "scripts", title: "Scripts", path: "/scripts", icon: SquareTerminal, key: "x", group: "tools" },
  { id: "settings", title: "Settings", path: "/settings", icon: Settings, key: ",", group: "settings" },
];

export const MODULE_ICON_FALLBACK = Boxes;
