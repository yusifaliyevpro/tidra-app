import type { IssueDraft } from "./issues";

/** Whether Report an issue is open, and the draft it keeps when closed by mistake. */
export interface IssueDraftState {
  open: boolean;
  draft: IssueDraft;
  /** Recent errors (toast ids) the user unchecked; they may hold private data. */
  skippedErrors: number[];
}

const EMPTY: IssueDraft = { title: "", body: "", kind: "bug", screenshots: [] };

let state: IssueDraftState = { open: false, draft: EMPTY, skippedErrors: [] };
const listeners = new Set<() => void>();
const set = (next: IssueDraftState) => {
  state = next;
  for (const listener of listeners) listener();
};

export const issueDraft = {
  snapshot: () => state,
  subscribe: (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  open: () => set({ ...state, open: true }),
  close: () => set({ ...state, open: false }),
  edit: (patch: Partial<IssueDraft>) => set({ ...state, draft: { ...state.draft, ...patch } }),
  toggleError: (id: number) =>
    set({
      ...state,
      skippedErrors: state.skippedErrors.includes(id)
        ? state.skippedErrors.filter((e) => e !== id)
        : [...state.skippedErrors, id],
    }),
  clear: () => set({ open: false, draft: EMPTY, skippedErrors: [] }),
};
