import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Search, Square, X } from "lucide-react";
import type { ReactNode } from "react";
import { inTauri } from "@/core/native";
import { Kbd } from "@/ui/layout";

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
      className={`flex h-9 w-11 items-center justify-center text-muted transition-colors no-drag hover:text-fg ${danger ? "hover:bg-[#c42b1c] hover:text-white" : "hover:bg-hover"}`}
    >
      {children}
    </button>
  );
}

/** Window chrome for the frameless window; without `onSearch` it only offers dragging and the window buttons. */
export function Titlebar({ onSearch }: { onSearch?: () => void }) {
  const win = inTauri ? getCurrentWindow() : undefined;
  return (
    <div data-tauri-drag-region className="flex h-9 shrink-0 items-center border-b border-line drag">
      <div className="flex w-[52px] justify-center" data-tauri-drag-region>
        <img src="/logo.svg" alt="" className="size-4" draggable={false} />
      </div>
      <span className="text-sm text-muted" data-tauri-drag-region>
        Tidra
      </span>
      {onSearch ? (
        <button
          type="button"
          onClick={onSearch}
          className="mx-auto flex h-6 w-80 items-center gap-2 rounded-md border border-line bg-surface px-2 text-sm text-faint transition-colors no-drag hover:border-line-strong hover:text-muted"
        >
          <Search className="size-3.5" />
          <span>Search projects, packages, actions</span>
          <span className="ml-auto flex gap-0.5">
            <Kbd>Ctrl</Kbd>
            <Kbd>K</Kbd>
          </span>
        </button>
      ) : (
        <div className="flex-1 self-stretch" data-tauri-drag-region />
      )}
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
