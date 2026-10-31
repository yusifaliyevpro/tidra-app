import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { MODULES } from "./modules";

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

/** Ctrl+K opens the palette; `g` then a module key navigates, like Linear and GitHub. */
export function useGlobalShortcuts(openPalette: () => void) {
  const navigate = useNavigate();
  useEffect(() => {
    let pendingG = 0;
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        openPalette();
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey || isTyping(event.target)) return;
      if (pendingG && Date.now() - pendingG < 1200) {
        const target = MODULES.find((m) => m.key === event.key.toLowerCase());
        pendingG = 0;
        if (target) {
          event.preventDefault();
          void navigate({ to: target.path });
        }
        return;
      }
      if (event.key === "g") pendingG = Date.now();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate, openPalette]);
}

/** j/k/Enter navigation for a list of ids; the caller decides what selecting and opening mean. */
export function useListKeys(options: {
  ids: string[];
  selected: string | undefined;
  onSelect: (id: string) => void;
  onOpen?: (id: string) => void;
  onToggle?: (id: string) => void;
}) {
  const { ids, selected, onSelect, onOpen, onToggle } = options;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || isTyping(event.target) || ids.length === 0) return;
      const index = selected ? ids.indexOf(selected) : -1;
      const move = (delta: number) => {
        const next = ids[Math.min(ids.length - 1, Math.max(0, index + delta))];
        if (next) {
          event.preventDefault();
          onSelect(next);
          document.querySelector(`[data-row-id="${CSS.escape(next)}"]`)?.scrollIntoView({ block: "nearest" });
        }
      };
      if (event.key === "j" || event.key === "ArrowDown") move(1);
      else if (event.key === "k" || event.key === "ArrowUp") move(-1);
      else if (event.key === "Enter" && selected && onOpen) {
        event.preventDefault();
        onOpen(selected);
      } else if (event.key === " " && selected && onToggle) {
        event.preventDefault();
        onToggle(selected);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ids, selected, onSelect, onOpen, onToggle]);
}
