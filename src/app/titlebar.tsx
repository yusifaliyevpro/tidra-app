import { getCurrentWindow } from "@tauri-apps/api/window";
import { cn } from "cn";
import { Minus, Square, X } from "lucide-react";
import type { ReactNode } from "react";
import { inTauri } from "@/core/native";

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
      className={cn(
        "flex h-7 w-9 items-center justify-center rounded-md text-muted transition-colors duration-[80ms] no-drag hover:text-fg",
        danger ? "hover:bg-[#c42b1c] hover:text-white" : "hover:bg-hover",
      )}
    >
      {children}
    </button>
  );
}

/** Minimize, maximize and close (to the tray); nothing outside the desktop app. */
export function WindowButtons({ className }: { className?: string }) {
  if (!inTauri) return null;
  const win = getCurrentWindow();
  return (
    <div className={cn("flex shrink-0 gap-0.5", className)}>
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

/** Window chrome for screens outside the shell (onboarding, startup errors): drag area, mark, window buttons. */
export function Titlebar() {
  return (
    <div data-tauri-drag-region className="flex h-10 shrink-0 items-center gap-2 pr-2 pl-4 drag">
      <img src="/logo.svg" alt="" className="size-4" draggable={false} />
      <span data-tauri-drag-region className="text-sm font-medium text-muted">
        Tidra
      </span>
      <WindowButtons className="ml-auto" />
    </div>
  );
}
