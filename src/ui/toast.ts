interface ToastAction {
  label: string;
  run: () => void | Promise<void>;
}

interface Toast {
  id: number;
  message: string;
  tone: "info" | "error";
  action?: ToastAction;
}

let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

export function dismiss(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

export interface RecentError {
  id: number;
  at: string;
  message: string;
}

const RECENT_ERRORS = 10;
let errors: RecentError[] = [];

/** The last errors shown this session, newest last, for issue reports; the user picks which to send. */
export const recentErrors = (): RecentError[] => errors;

export function toast(message: string, tone: Toast["tone"] = "info", action?: ToastAction) {
  const id = nextId++;
  if (tone === "error") errors = [...errors.slice(1 - RECENT_ERRORS), { id, at: new Date().toISOString(), message }];
  toasts = [...toasts.slice(-3), { id, message, tone, action }];
  emit();
  setTimeout(() => dismiss(id), tone === "error" ? 8000 : action ? 6000 : 4000);
}

/** For reversible actions: done at once, with a few seconds to take it back. */
export const toastUndo = (message: string, undo: () => void | Promise<void>) =>
  toast(message, "info", { label: "Undo", run: undo });

export const toastError = (error: unknown) => toast(error instanceof Error ? error.message : String(error), "error");

export function subscribeToasts(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const currentToasts = () => toasts;
