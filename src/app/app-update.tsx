import { useMutation, useQuery } from "@tanstack/react-query";
import { relaunch } from "@tauri-apps/plugin-process";
import type { Update } from "@tauri-apps/plugin-updater";
import { ArrowDownToLine } from "lucide-react";
import { useState } from "react";
import { inTauri } from "@/core/native";
import { checkSilently, progressTracker } from "@/services/app-update";
import { Button } from "@/ui/button";
import { toastError } from "@/ui/toast";

const CHECK_EVERY_MS = 6 * 3_600_000;

export function useAppUpdate() {
  return useQuery({
    queryKey: ["app-update"],
    queryFn: checkSilently,
    enabled: inTauri && !import.meta.env.DEV,
    refetchInterval: CHECK_EVERY_MS,
    refetchIntervalInBackground: true,
    staleTime: CHECK_EVERY_MS,
  });
}

/** Shown next to the search bar only when a newer version is out; installs it and restarts. */
export function AppUpdateButton() {
  const { data: update } = useAppUpdate();
  const [percent, setPercent] = useState<number>();
  const install = useMutation({
    mutationFn: async (target: Update) => {
      const track = progressTracker();
      await target.downloadAndInstall((event) => setPercent(track(event)));
      await relaunch();
    },
    onError: (error) => {
      setPercent(undefined);
      toastError(error);
    },
  });
  if (!update) return null;
  return (
    <Button
      size="sm"
      variant="primary"
      className="no-drag"
      title={`Tidra ${update.version} is available`}
      icon={<ArrowDownToLine className="size-3.5" />}
      loading={install.isPending}
      onClick={() => install.mutate(update)}
    >
      {install.isPending
        ? percent === undefined
          ? "Updating…"
          : `Updating ${percent}%`
        : `Update to ${update.version}`}
    </Button>
  );
}
