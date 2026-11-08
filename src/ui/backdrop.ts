import { useEffect, useEffectEvent, type RefObject } from "react";

/** Esc already closes a modal dialog; this adds a click on the backdrop, which lands on the <dialog> itself. */
export function useBackdropClose(ref: RefObject<HTMLDialogElement | null>, onClose: () => void) {
  const close = useEffectEvent(onClose);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const onClick = (event: MouseEvent) => {
      if (event.target === el) close();
    };
    el.addEventListener("click", onClick);
    return () => el.removeEventListener("click", onClick);
  }, [ref]);
}
