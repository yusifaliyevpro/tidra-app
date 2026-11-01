import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Search, Square, X } from "lucide-react";
import type { ReactNode } from "react";
import { inTauri } from "@/core/native";
import { Kbd } from "@/ui/layout";
import { acceleratorKeys } from "./accelerator";

function WindowButton({
  label,
  onClick,
  children,
  danger,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`flex h-10 w-11 items-center justify-center text-muted transition-colors no-drag hover:text-fg ${danger ? "hover:bg-[#c42b1c] hover:text-white" : "hover:bg-hover"}`}
    >
      {children}
    </button>
  );
}

/** Window chrome for the frameless window; without `onSearch` it only offers dragging and the window buttons. */
export function Titlebar({
  onSearch,
  searchShortcut = "",
  tools,
}: {
  onSearch?: () => void;
  searchShortcut?: string;
  tools?: ReactNode;
}) {
  const win = inTauri ? getCurrentWindow() : undefined;
  return (
    <div data-tauri-drag-region className="flex h-10 shrink-0 items-center drag">
      <div className="flex w-[208px] shrink-0 items-center gap-2 pl-4" data-tauri-drag-region>
        <img src="/logo.svg" alt="" className="size-4" draggable={false} />
        <span className="text-sm font-medium text-muted" data-tauri-drag-region>
          Tidra
        </span>
      </div>
      {onSearch ? (
        <div className="flex flex-1 justify-center self-stretch" data-tauri-drag-region>
          <button
            type="button"
            onClick={onSearch}
            className="my-auto flex h-7 w-full max-w-[440px] items-center gap-2 rounded-md border border-line bg-white/[0.03] px-2.5 text-sm text-faint transition-colors no-drag hover:border-line-strong hover:text-muted"
          >
            <Search className="size-3.5" />
            <span>Search projects, packages and commands</span>
            <span className="ml-auto flex gap-0.5">
              {acceleratorKeys(searchShortcut).map((key) => (
                <Kbd key={key}>{key}</Kbd>
              ))}
            </span>
          </button>
        </div>
      ) : (
        <div className="flex-1 self-stretch" data-tauri-drag-region />
      )}
      <div className="flex items-center gap-1 pl-3">{tools}</div>
      {win ? (
        <div className="flex">
          <WindowButton label="Minimize" onClick={() => void win.minimize()}>
            <Minus className="size-3.5" />
          </WindowButton>
          <WindowButton label="Maximize" onClick={() => void win.toggleMaximize()}>
            <Square className="size-3" />
          </WindowButton>
          <WindowButton label="Close to tray" onClick={() => void win.hide()} danger>
            <X className="size-4" />
          </WindowButton>
        </div>
      ) : (
        <div className="w-[132px]" />
      )}
    </div>
  );
}
