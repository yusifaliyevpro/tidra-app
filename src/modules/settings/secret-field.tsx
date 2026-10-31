import { useMutation } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useSecretPresence } from "@/app/queries";
import { useServices } from "@/app/services";
import type { SecretKey } from "@/core/secrets";
import { Button } from "@/ui/button";
import { Input } from "@/ui/field";
import { toastError } from "@/ui/toast";
import { SettingRow } from "./rows";

/** A keychain-backed setting row: the value is never read back into the UI, only whether one is saved. */
export function SecretField({
  secretKey,
  label,
  description,
  placeholder,
  secret = true,
  extra,
}: {
  secretKey: SecretKey;
  label: string;
  description?: ReactNode;
  placeholder?: string;
  secret?: boolean;
  extra?: ReactNode;
}) {
  const svc = useServices();
  const { data: presence } = useSecretPresence([secretKey]);
  const saved = presence?.[secretKey] ?? false;
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");

  const save = useMutation({
    mutationFn: (next: string | undefined) => svc.setSecret(secretKey, next),
    onSuccess: () => {
      setEditing(false);
      setValue("");
    },
    onError: toastError,
  });

  if (saved && !editing) {
    return (
      <SettingRow label={label} description={description}>
        <span className="flex items-center gap-1.5 text-sm text-muted">
          <Check className="size-3.5 text-ok" />
          Saved
        </span>
        <Button size="sm" onClick={() => setEditing(true)}>
          Replace
        </Button>
        <Button size="sm" variant="ghost" loading={save.isPending} onClick={() => save.mutate(undefined)}>
          Remove
        </Button>
      </SettingRow>
    );
  }

  return (
    <SettingRow label={label} description={description}>
      {(id) => (
        <>
          <Input
            id={id}
            type={secret ? "password" : "text"}
            autoComplete="off"
            value={value}
            placeholder={placeholder}
            className="w-56"
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && value.trim()) save.mutate(value.trim());
              if (e.key === "Escape" && editing) setEditing(false);
            }}
          />
          {extra}
          <Button size="sm" disabled={!value.trim()} loading={save.isPending} onClick={() => save.mutate(value.trim())}>
            Save
          </Button>
        </>
      )}
    </SettingRow>
  );
}
