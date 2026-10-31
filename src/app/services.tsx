import { createContext, use, type ReactNode } from "react";
import type { Services } from "@/services/context";
import type { ProcessManager } from "@/services/processes";

export interface AppContext {
  svc: Services;
  processes: ProcessManager;
}

const Context = createContext<AppContext | null>(null);

export function ServicesProvider({ value, children }: { value: AppContext; children: ReactNode }) {
  return <Context value={value}>{children}</Context>;
}

export function useApp(): AppContext {
  const value = use(Context);
  if (!value) throw new Error("useApp must be used inside ServicesProvider");
  return value;
}

export const useServices = () => useApp().svc;
