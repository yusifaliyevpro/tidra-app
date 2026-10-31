import { useMutation } from "@tanstack/react-query";
import { Copy, Download } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useSyncStatus } from "@/app/queries";
import { useServices } from "@/app/services";
import {
  changeVaultPassword,
  connectionCode,
  createSync,
  disconnectSync,
  newRecoveryKey,
  probeDatabase,
  restoreFromCode,
  restoreSync,
  runSync,
} from "@/services/sync";
import { DecryptError } from "@/sync/crypto";
import { SYNC_PROVIDERS, findSyncProvider } from "@/sync/registry";
import { Badge } from "@/ui/badge";
import { Button } from "@/ui/button";
import { Dialog } from "@/ui/dialog";
import { Field, Input, Select, Textarea } from "@/ui/field";
import { ErrorNote, Note } from "@/ui/layout";
import { Mono } from "@/ui/misc";
import { TimeAgo } from "@/ui/time";
import { toast, toastError } from "@/ui/toast";

const MIN_PASSWORD = 12;

const friendly = (error: Error | null) =>
  !error
    ? undefined
    : error instanceof DecryptError
      ? "That password or recovery key doesn't unlock this vault."
      : error.message;

/** Shown once after creating a vault; the recovery key is never stored anywhere Tidra can read again. */
function RecoveryKit({ kit, onClose }: { kit: Kit; onClose: () => void }) {
  const text = [
    "Tidra recovery kit",
    "",
    "Keep this somewhere safe, like your password manager. Anyone with the connection code and your vault password can read your synced data.",
    "",
    kit.recoveryKey ? `Recovery key (replaces the vault password): ${kit.recoveryKey}` : "",
    kit.connectionCode
      ? `Connection code (database address and token, encrypted with your vault password):\n${kit.connectionCode}`
      : "",
  ].join("\n");

  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "tidra-recovery-kit.txt";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title="Save your recovery kit"
      footer={
        <>
          <Button
            icon={<Copy className="size-4" />}
            onClick={() => void navigator.clipboard.writeText(text).then(() => toast("Copied."))}
          >
            Copy
          </Button>
          <Button icon={<Download className="size-4" />} onClick={download}>
            Download .txt
          </Button>
          <Button variant="primary" onClick={onClose}>
            I saved it
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 text-sm">
        <p className="text-muted">
          Tidra can't show the recovery key again. Without it and without your password, synced data can't be decrypted.
        </p>
        {kit.recoveryKey ? (
          <Field label="Recovery key">
            {() => (
              <Mono className="rounded-md border border-line bg-raised p-2.5 text-base break-all select-text">
                {kit.recoveryKey}
              </Mono>
            )}
          </Field>
        ) : null}
        {kit.connectionCode ? (
          <Field label="Connection code" hint="Paste it on a new device with your vault password.">
            {() => <Textarea readOnly value={kit.connectionCode} className="h-24" />}
          </Field>
        ) : null}
      </div>
    </Dialog>
  );
}

function PasswordPair({
  password,
  confirm,
  onPassword,
  onConfirm,
}: {
  password: string;
  confirm: string;
  onPassword: (v: string) => void;
  onConfirm: (v: string) => void;
}) {
  const tooShort = password.length > 0 && password.length < MIN_PASSWORD;
  const mismatch = confirm.length > 0 && confirm !== password;
  return (
    <>
      <Field
        label="Vault password"
        error={tooShort ? `Use at least ${MIN_PASSWORD} characters.` : undefined}
        hint="Never stored or sent anywhere."
      >
        {(id) => (
          <Input
            id={id}
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => onPassword(e.target.value)}
          />
        )}
      </Field>
      <Field label="Repeat password" error={mismatch ? "The passwords don't match." : undefined}>
        {(id) => (
          <Input
            id={id}
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => onConfirm(e.target.value)}
          />
        )}
      </Field>
    </>
  );
}

type Kit = { recoveryKey?: string; connectionCode?: string };
type Config = Record<string, string>;

function ConnectForm({ onKit }: { onKit: (kit: Kit) => void }) {
  const [mode, setMode] = useState<"credentials" | "code">("credentials");
  return mode === "code" ? (
    <CodeConnect onBack={() => setMode("credentials")} />
  ) : (
    <DatabaseConnect onKit={onKit} onCode={() => setMode("code")} />
  );
}

function CodeConnect({ onBack }: { onBack: () => void }) {
  const svc = useServices();
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const connect = useMutation({
    mutationFn: () => restoreFromCode(svc, code, password),
    onSuccess: (result) => toast(`Connected. Restored ${result?.pulled ?? 0} items.`),
  });
  const error = friendly(connect.error);

  return (
    <div className="flex flex-col gap-4">
      <Field label="Connection code" hint="From your recovery kit.">
        {(id) => (
          <Textarea id={id} value={code} placeholder="tidra-connect:…" onChange={(e) => setCode(e.target.value)} />
        )}
      </Field>
      <Field label="Vault password">
        {(id) => <Input id={id} type="password" value={password} onChange={(e) => setPassword(e.target.value)} />}
      </Field>
      {error ? <ErrorNote>{error}</ErrorNote> : null}
      <div className="flex gap-2">
        <Button
          variant="primary"
          disabled={!code || !password}
          loading={connect.isPending}
          onClick={() => connect.mutate()}
        >
          Connect and restore
        </Button>
        <Button variant="ghost" onClick={onBack}>
          Enter database details instead
        </Button>
      </div>
    </div>
  );
}

/** Provider details first; probing the database decides whether to create a vault or unlock the existing one. */
function DatabaseConnect({ onKit, onCode }: { onKit: (kit: Kit) => void; onCode: () => void }) {
  const svc = useServices();
  const [providerId, setProviderId] = useState(SYNC_PROVIDERS[0]?.id ?? "");
  const [config, setConfig] = useState<Config>({});
  const [stage, setStage] = useState<"form" | "create" | "restore">("form");
  const provider = findSyncProvider(providerId);

  const probe = useMutation({
    mutationFn: () => probeDatabase(svc, providerId, config),
    onSuccess: (state) => setStage(state === "empty" ? "create" : "restore"),
  });
  const error = friendly(probe.error);
  const codeLink = (
    <Button variant="ghost" onClick={onCode}>
      I have a connection code
    </Button>
  );

  return (
    <div className="flex flex-col gap-4">
      <Field label="Provider" hint={provider?.description}>
        {(id) => (
          <Select
            id={id}
            value={providerId}
            onChange={(e) => {
              setProviderId(e.target.value);
              setConfig({});
              setStage("form");
            }}
          >
            {SYNC_PROVIDERS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </Select>
        )}
      </Field>
      {provider?.fields.map((field) => (
        <Field key={field.key} label={field.label}>
          {(id) => (
            <Input
              id={id}
              type={field.secret ? "password" : "text"}
              placeholder={field.placeholder}
              value={config[field.key] ?? ""}
              onChange={(e) => {
                setConfig({ ...config, [field.key]: e.target.value.trim() });
                setStage("form");
              }}
            />
          )}
        </Field>
      ))}
      {provider?.setupSql ? (
        <details className="text-sm">
          <summary className="text-muted">Setup SQL to run once in the {provider.label} SQL editor</summary>
          <Textarea readOnly value={provider.setupSql} className="mt-2 h-56" />
        </details>
      ) : null}

      {stage === "create" ? (
        <CreateVault providerId={providerId} config={config} onKit={onKit} extra={codeLink} />
      ) : null}
      {stage === "restore" ? <UnlockVault providerId={providerId} config={config} extra={codeLink} /> : null}
      {stage === "form" ? (
        <>
          {error ? <ErrorNote>{error}</ErrorNote> : null}
          <div className="flex gap-2">
            <Button
              variant="primary"
              disabled={!provider?.fields.every((f) => config[f.key])}
              loading={probe.isPending}
              onClick={() => probe.mutate()}
            >
              Connect
            </Button>
            {codeLink}
          </div>
        </>
      ) : null}
    </div>
  );
}

function CreateVault({
  providerId,
  config,
  onKit,
  extra,
}: {
  providerId: string;
  config: Config;
  onKit: (kit: Kit) => void;
  extra: ReactNode;
}) {
  const svc = useServices();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const create = useMutation({
    mutationFn: () => createSync(svc, providerId, config, password),
    onSuccess: (result) => onKit({ recoveryKey: result.recoveryKey, connectionCode: result.connectionCode }),
  });
  const error = friendly(create.error);

  return (
    <>
      <Note>New database. Choose a vault password.</Note>
      <PasswordPair password={password} confirm={confirm} onPassword={setPassword} onConfirm={setConfirm} />
      {error ? <ErrorNote>{error}</ErrorNote> : null}
      <div className="flex gap-2">
        <Button
          variant="primary"
          disabled={password.length < MIN_PASSWORD || password !== confirm}
          loading={create.isPending}
          onClick={() => create.mutate()}
        >
          Create vault and sync
        </Button>
        {extra}
      </div>
    </>
  );
}

function UnlockVault({ providerId, config, extra }: { providerId: string; config: Config; extra: ReactNode }) {
  const svc = useServices();
  const [password, setPassword] = useState("");
  const [recoveryKey, setRecoveryKey] = useState("");
  const restore = useMutation({
    mutationFn: () => restoreSync(svc, providerId, config, recoveryKey ? { recoveryKey } : { password }),
    onSuccess: (result) => toast(`Connected. Restored ${result?.pulled ?? 0} items.`),
  });
  const error = friendly(restore.error);

  return (
    <>
      <Note>This database has a vault. Unlock it to restore.</Note>
      <Field label="Vault password">
        {(id) => <Input id={id} type="password" value={password} onChange={(e) => setPassword(e.target.value)} />}
      </Field>
      <Field label="Or recovery key">
        {(id) => (
          <Input id={id} value={recoveryKey} placeholder="TIDRA-…" onChange={(e) => setRecoveryKey(e.target.value)} />
        )}
      </Field>
      {error ? <ErrorNote>{error}</ErrorNote> : null}
      <div className="flex gap-2">
        <Button
          variant="primary"
          disabled={!password && !recoveryKey}
          loading={restore.isPending}
          onClick={() => restore.mutate()}
        >
          Unlock and restore
        </Button>
        {extra}
      </div>
    </>
  );
}

function ConnectedPanel({ onKit }: { onKit: (kit: Kit) => void }) {
  const svc = useServices();
  const { data: status } = useSyncStatus();
  const [dialog, setDialog] = useState<"password" | "code" | undefined>();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  const sync = useMutation({ mutationFn: () => runSync(svc), onError: toastError });
  const disconnect = useMutation({
    mutationFn: () => disconnectSync(svc),
    onSuccess: () => toast("Sync disconnected. Local data is kept."),
  });
  const rotate = useMutation({
    mutationFn: () => newRecoveryKey(svc),
    onSuccess: (recoveryKey) => onKit({ recoveryKey }),
    onError: toastError,
  });
  const change = useMutation({
    mutationFn: () => changeVaultPassword(svc, password),
    onSuccess: (code) => {
      setDialog(undefined);
      onKit({ connectionCode: code });
    },
    onError: toastError,
  });
  const showCode = useMutation({
    mutationFn: () => connectionCode(svc, password),
    onSuccess: (code) => {
      setDialog(undefined);
      onKit({ connectionCode: code });
    },
  });
  const close = () => {
    setDialog(undefined);
    setPassword("");
    setConfirm("");
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge tone="ok">connected</Badge>
        <span>{findSyncProvider(status?.provider ?? "")?.label}</span>
        {status?.lastSync ? (
          <span className="text-muted">
            Last sync <TimeAgo value={status.lastSync} />
            {status.lastResult ? ` · ${status.lastResult.pushed} sent, ${status.lastResult.pulled} received` : ""}
          </span>
        ) : null}
      </div>
      {status?.lastError ? <ErrorNote>{status.lastError}</ErrorNote> : null}
      {status?.lastResult?.rejected ? (
        <ErrorNote>{status.lastResult.rejected} items could not be decrypted and were skipped.</ErrorNote>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button loading={sync.isPending} onClick={() => sync.mutate()}>
          Sync now
        </Button>
        <Button onClick={() => setDialog("code")}>Show connection code</Button>
        <Button onClick={() => setDialog("password")}>Change vault password</Button>
        <Button loading={rotate.isPending} onClick={() => rotate.mutate()}>
          New recovery key
        </Button>
        <Button variant="danger" loading={disconnect.isPending} onClick={() => disconnect.mutate()}>
          Disconnect
        </Button>
      </div>
      <Dialog
        open={dialog === "password"}
        onClose={close}
        title="Change vault password"
        footer={
          <Button
            variant="primary"
            disabled={password.length < MIN_PASSWORD || password !== confirm}
            loading={change.isPending}
            onClick={() => change.mutate()}
          >
            Change password
          </Button>
        }
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted">
            Other devices keep syncing. Your old connection code stops working; you get a new one.
          </p>
          <PasswordPair password={password} confirm={confirm} onPassword={setPassword} onConfirm={setConfirm} />
        </div>
      </Dialog>
      <Dialog
        open={dialog === "code"}
        onClose={close}
        title="Show connection code"
        footer={
          <Button variant="primary" disabled={!password} loading={showCode.isPending} onClick={() => showCode.mutate()}>
            Show code
          </Button>
        }
      >
        <div className="flex flex-col gap-3">
          <Field label="Vault password" error={friendly(showCode.error)}>
            {(id) => <Input id={id} type="password" value={password} onChange={(e) => setPassword(e.target.value)} />}
          </Field>
        </div>
      </Dialog>
    </div>
  );
}

export function SyncSettings() {
  const { data: status } = useSyncStatus();
  const [kit, setKit] = useState<Kit>();
  return (
    <>
      {status?.connected ? <ConnectedPanel onKit={setKit} /> : <ConnectForm onKit={setKit} />}
      {kit ? <RecoveryKit kit={kit} onClose={() => setKit(undefined)} /> : null}
    </>
  );
}
