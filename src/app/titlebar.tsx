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
  besideSearch,
  tools,
}: {
  onSearch?: () => void;
  searchShortcut?: string;
  /** Sits right of the search box, e.g. the app update button. */
  besideSearch?: ReactNode;
  tools?: ReactNode;
}) {
  const win = inTauri ? getCurrentWindow() : undefined;
  return (
    // Equal side columns keep the search box centered while the update button and activity come and go.
    <div
      data-tauri-drag-region
      className="grid h-10 shrink-0 grid-cols-[minmax(320px,1fr)_minmax(0,440px)_minmax(320px,1fr)] items-center drag"
    >
      <div className="flex items-center gap-2 self-stretch pl-4" data-tauri-drag-region>
        <img src="/logo.svg" alt="" className="size-4" draggable={false} />
        <span className="text-sm font-medium text-muted" data-tauri-drag-region>
          Tidra
        </span>
      </div>
      {onSearch ? (
        <button
          type="button"
          onClick={onSearch}
          className="flex h-7 min-w-0 items-center gap-2 rounded-md border border-line bg-white/[0.03] px-2.5 text-sm text-faint transition-colors no-drag hover:border-line-strong hover:text-muted"
        >
          <Search className="size-3.5 shrink-0" />
          <span className="truncate">Search projects, packages and commands</span>
          <span className="ml-auto flex shrink-0 gap-0.5">
            {acceleratorKeys(searchShortcut).map((key) => (
              <Kbd key={key}>{key}</Kbd>
            ))}
          </span>
        </button>
      ) : (
        <div className="self-stretch" data-tauri-drag-region />
      )}
      <div className="flex min-w-0 items-center self-stretch" data-tauri-drag-region>
        {besideSearch ? <div className="flex shrink-0 items-center pl-2">{besideSearch}</div> : null}
        <div className="flex min-w-0 flex-1 items-center justify-end gap-1 pl-3" data-tauri-drag-region>
          {tools}
        </div>
        {win ? <WindowButtons win={win} /> : <div className="w-[132px] shrink-0" />}
      </div>
    </div>
  );
}

function WindowButtons({ win }: { win: ReturnType<typeof getCurrentWindow> }) {
  return (
    <div className="flex shrink-0">
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
  );
}
