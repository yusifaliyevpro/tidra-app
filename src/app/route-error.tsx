import { useNavigate, useRouter, type ErrorComponentProps } from "@tanstack/react-router";
import { Button } from "@/ui/button";

/** Shown in place of a screen that crashed; the shell around it keeps working. */
export function RouteError({ error, reset }: ErrorComponentProps) {
  const router = useRouter();
  const navigate = useNavigate();
  const retry = () => {
    reset();
    void router.invalidate();
  };
  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="flex w-full max-w-lg flex-col gap-3">
        <h1 className="text-lg font-medium">This screen hit an error</h1>
        <pre className="rounded-md border border-line bg-surface p-3 font-mono text-sm whitespace-pre-wrap text-bad select-text">
          {error instanceof Error ? error.message : String(error)}
        </pre>
        <p className="text-sm text-muted">
          The rest of Tidra still works. If it keeps happening, please open an issue.
        </p>
        <div className="flex gap-2">
          <Button variant="primary" onClick={retry}>
            Try again
          </Button>
          <Button
            onClick={() => {
              reset();
              void navigate({ to: "/" });
            }}
          >
            Home
          </Button>
        </div>
      </div>
    </div>
  );
}
