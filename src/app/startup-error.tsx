import { relaunch } from "@tauri-apps/plugin-process";
import { inTauri } from "@/core/native";
import { Button } from "@/ui/button";

/** Rendered instead of the app when startup fails, so the window never stays blank. */
export function StartupError({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    <div className="flex h-full items-center justify-center bg-bg p-8">
      <div className="flex max-w-lg flex-col gap-3">
        <h1 className="text-lg font-medium">Tidra could not start</h1>
        <pre className="rounded-md border border-line bg-surface p-3 font-mono text-sm whitespace-pre-wrap text-bad select-text">
          {message}
        </pre>
        <p className="text-sm text-muted">
          If this keeps happening, please open an issue on GitHub with the message above.
        </p>
        <div>
          <Button variant="primary" onClick={() => (inTauri ? void relaunch() : location.reload())}>
            Restart
          </Button>
        </div>
      </div>
    </div>
  );
}
