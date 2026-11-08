import { cn } from "cn";
import { X } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { IconButton } from "./button";

/** Native <dialog> as a modal: focus trapping, Esc and the backdrop come from the platform. */
export function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions -- Esc already closes it; this adds backdrop clicks
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onCancel={onClose}
      // A click on the backdrop lands on the <dialog> itself; clicks inside land on its content.
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      className={cn(
        "m-auto max-h-[85vh] w-[520px] max-w-[92vw] animate-dialog-in rounded-xl border border-line-strong bg-raised p-0 text-fg shadow-dialog backdrop:bg-scrim",
        className,
      )}
    >
      {open ? (
        <div className="flex max-h-[85vh] flex-col">
          <div className="flex h-12 shrink-0 items-center pr-2 pl-[18px]">
            <h2 id={titleId} className="text-lg font-medium">
              {title}
            </h2>
            <IconButton label="Close" className="ml-auto" icon={<X className="size-4" />} onClick={onClose} />
          </div>
          <div className="min-h-0 overflow-y-auto overscroll-contain px-[18px] pt-1 pb-4">{children}</div>
          {footer ? (
            <div className="flex shrink-0 justify-end gap-2 border-t border-line px-3.5 py-3">{footer}</div>
          ) : null}
        </div>
      ) : null}
    </dialog>
  );
}
