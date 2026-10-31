interface Toast {
  id: number;
  message: string;
  tone: "info" | "error";
}

let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

export function dismiss(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

export function toast(message: string, tone: Toast["tone"] = "info") {
  const id = nextId++;
  toasts = [...toasts.slice(-3), { id, message, tone }];
  emit();
  setTimeout(() => dismiss(id), tone === "error" ? 8000 : 4000);
}

export const toastError = (error: unknown) => toast(error instanceof Error ? error.message : String(error), "error");

export function subscribeToasts(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const currentToasts = () => toasts;
