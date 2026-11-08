import { lazy, Suspense, useSyncExternalStore } from "react";
import { issueDraft } from "@/services/issue-draft";
import { useGhState } from "./queries";

const ReportIssueDialog = lazy(() => import("@/modules/report-issue").then((m) => ({ default: m.ReportIssueDialog })));

/** Checks gh in the background from launch; the dialog itself loads the first time it opens. */
export function IssueReporter() {
  const { open } = useSyncExternalStore(issueDraft.subscribe, issueDraft.snapshot);
  useGhState();
  return open ? (
    <Suspense fallback={null}>
      <ReportIssueDialog />
    </Suspense>
  ) : null;
}
