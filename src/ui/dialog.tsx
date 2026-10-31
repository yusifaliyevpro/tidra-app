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
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onCancel={onClose}
      className={cn(
        "m-auto max-h-[85vh] w-[520px] max-w-[92vw] rounded-lg border border-line-strong bg-surface p-0 text-fg shadow-2xl backdrop:bg-black/60",
        className,
      )}
    >
      {open ? (
        <div className="flex max-h-[85vh] flex-col">
          <div className="flex h-11 shrink-0 items-center border-b border-line pr-2 pl-4">
            <h2 id={titleId} className="font-medium">
              {title}
            </h2>
            <IconButton label="Close" className="ml-auto" icon={<X className="size-4" />} onClick={onClose} />
          </div>
          <div className="min-h-0 overflow-y-auto p-4">{children}</div>
          {footer ? (
            <div className="flex shrink-0 justify-end gap-2 border-t border-line px-4 py-3">{footer}</div>
          ) : null}
        </div>
      ) : null}
    </dialog>
  );
}
