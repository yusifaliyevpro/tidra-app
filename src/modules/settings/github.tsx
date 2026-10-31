import { useMutation } from "@tanstack/react-query";
import { useServices } from "@/app/services";
import { SECRET_KEYS } from "@/core/secrets";
import { Button } from "@/ui/button";
import { ExternalLink } from "@/ui/markdown";
import { toast, toastError } from "@/ui/toast";
import { SecretField } from "./secret-field";

const TOKEN_URL =
  "https://github.com/settings/tokens/new?description=Tidra&scopes=repo,notifications,workflow,read:org";

export function GitHubSettings() {
  const svc = useServices();
  const fromCli = useMutation({
    mutationFn: async () => {
      const result = await svc.io.run("gh", ["auth", "token"]);
      const token = result.stdout.trim();
      if (result.code !== 0 || !token) throw new Error("GitHub CLI isn't signed in. Run gh auth login first.");
      await svc.setSecret(SECRET_KEYS.github, token);
    },
    onSuccess: () => toast("Using the GitHub CLI token."),
    onError: toastError,
  });

  return (
    <SecretField
      secretKey={SECRET_KEYS.github}
      label="Token"
      placeholder="ghp_…"
      description={
        <>
          repo, notifications, workflow · <ExternalLink href={TOKEN_URL}>Create</ExternalLink>
        </>
      }
      extra={
        <Button size="sm" variant="ghost" loading={fromCli.isPending} onClick={() => fromCli.mutate()}>
          Use gh CLI
        </Button>
      }
    />
  );
}
