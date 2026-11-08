/** Output dialogs closed while their work still ran, so the header can bring them back. */
export type DismissedWork =
  | { kind: "run"; id: string; label: string; projectId: string; path?: string }
  | { kind: "process"; id: string; label: string };

let items: DismissedWork[] = [];
const listeners = new Set<() => void>();
const emit = () => {
  for (const listener of listeners) listener();
};

export const dismissedWork = {
  snapshot: () => items,
  subscribe: (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  add: (work: DismissedWork) => {
    items = [...items.filter((w) => w.id !== work.id), work];
    emit();
  },
  remove: (id: string) => {
    if (!items.some((w) => w.id === id)) return;
    items = items.filter((w) => w.id !== id);
    emit();
  },
};
