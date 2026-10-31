import { cn } from "cn";
import { useState } from "react";
import { acceleratorFromEvent, acceleratorKeys } from "@/app/accelerator";
import { Kbd } from "@/ui/layout";

/** Click, then press the keys. Esc cancels, Backspace clears. */
export function ShortcutInput({
  id,
  value,
  onChange,
}: {
  id?: string;
  value: string;
  onChange: (accelerator: string) => void;
}) {
  const [recording, setRecording] = useState(false);
  const keys = acceleratorKeys(value);

  return (
    <button
      id={id}
      type="button"
      onClick={() => setRecording(true)}
      onBlur={() => setRecording(false)}
      onKeyDown={(event) => {
        if (!recording) return;
        event.preventDefault();
        if (event.key === "Escape") return setRecording(false);
        if (event.key === "Backspace" || event.key === "Delete") {
          setRecording(false);
          return onChange("");
        }
        const accelerator = acceleratorFromEvent(event);
        if (accelerator) {
          setRecording(false);
          onChange(accelerator);
        }
      }}
      className={cn(
        "flex h-7 min-w-40 items-center justify-end gap-1 rounded-md border border-line-strong bg-surface px-2 text-sm",
        recording && "border-accent/60",
      )}
    >
      {recording ? (
        <span className="text-muted">Press keys…</span>
      ) : keys.length > 0 ? (
        keys.map((key) => <Kbd key={key}>{key}</Kbd>)
      ) : (
        <span className="text-faint">Off</span>
      )}
    </button>
  );
}
