import type { ReactNode } from "react";
import { Toaster } from "@/ui/toaster";
import { Titlebar } from "./titlebar";

/** Title bar and window buttons around screens shown outside the shell: onboarding, startup and fatal errors. */
export function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full flex-col">
      <Titlebar />
      <div className="min-h-0 flex-1 overflow-y-auto bg-bg">{children}</div>
      <Toaster />
    </div>
  );
}
