import { useMutation } from "@tanstack/react-query";
import { relaunch } from "@tauri-apps/plugin-process";
import { useState } from "react";
import { useServices } from "@/app/services";
import { inTauri } from "@/core/native";
import { deleteAllData } from "@/services/reset";
import { Button } from "@/ui/button";
import { Dialog } from "@/ui/dialog";
import { toastError } from "@/ui/toast";
import { SettingRow } from "./rows";

export function DeleteAllData() {
  const svc = useServices();
  const [confirming, setConfirming] = useState(false);
  const erase = useMutation({
    mutationFn: async () => {
      await deleteAllData(svc);
      if (inTauri) await relaunch();
      else location.assign("/");
    },
    onError: toastError,
  });

  return (
    <SettingRow label="Delete all data" description="Projects, settings and saved tokens on this device">
      <Button size="sm" variant="danger" onClick={() => setConfirming(true)}>
        Delete
      </Button>
      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Delete all data?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button variant="danger" loading={erase.isPending} onClick={() => erase.mutate()}>
              Delete and restart
            </Button>
          </>
        }
      >
        <p className="text-muted">
          Tidra restarts at setup. Your project folders and anything in a sync database are not touched.
        </p>
      </Dialog>
    </SettingRow>
  );
}
