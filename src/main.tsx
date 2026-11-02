import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "./styles/app.css";
import { QueryClientProvider } from "@tanstack/react-query";
import { createRouter, RouterProvider } from "@tanstack/react-router";
import * as z from "@zod/mini";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { applyAppearance, startDesktopIntegration } from "@/app/desktop";
import { Frame } from "@/app/frame";
import { installNativeFeel, reportUnhandledErrors, revealWindow } from "@/app/native-feel";
import { RouteError } from "@/app/route-error";
import { ServicesProvider, type AppContext } from "@/app/services";
import { StartupError } from "@/app/startup-error";
import { appEnv, createTauriIo, inTauri, tauriSqlDriver } from "@/core/native";
import { createServices } from "@/services/context";
import { homeSummary } from "@/services/home";
import { registerJobs } from "@/services/jobs";
import { createProcessManager } from "@/services/processes";
import { finishInterruptedRuns } from "@/services/updates";
import { toast, toastError } from "@/ui/toast";
import { routeTree } from "./routeTree.gen";

const router = createRouter({
  routeTree,
  defaultPreload: "intent",
  scrollRestoration: true,
  defaultErrorComponent: RouteError,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

async function boot(): Promise<AppContext> {
  if (inTauri) {
    document.documentElement.classList.add("native");
    const svc = await createServices({ io: createTauriIo(await appEnv()), driver: tauriSqlDriver, preview: false });
    return { svc, processes: createProcessManager(svc) };
  }
  // Browser preview: same UI and services against in-memory SQLite and sample projects.
  const [{ createWasmDriver }, { createDemoIo }] = await Promise.all([
    import("@/preview/sqlite-wasm"),
    import("@/preview/demo-io"),
  ]);
  const svc = await createServices({ io: createDemoIo(), driver: await createWasmDriver(), preview: true });
  return { svc, processes: createProcessManager(svc) };
}

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");
const reactRoot = createRoot(root);
if (inTauri) installNativeFeel();
reportUnhandledErrors((message) => toast(message, "error"));

try {
  const app = await boot();
  await applyAppearance(app.svc);
  await finishInterruptedRuns(app.svc);
  await registerJobs(app.svc);
  app.svc.scheduler.start();
  // Known before the first render, so the onboarding gate never flashes a spinner.
  await app.svc.queryClient.prefetchQuery({
    queryKey: ["onboarded"],
    queryFn: () => app.svc.store.getLocal("onboarded", z.boolean(), false),
  });
  // The overview and sidebar counts read only local snapshots; having them ready means no spinner on launch.
  await Promise.race([
    app.svc.queryClient.prefetchQuery({ queryKey: ["home"], queryFn: () => homeSummary(app.svc) }),
    new Promise((resolve) => setTimeout(resolve, 1500)),
  ]);

  reactRoot.render(
    <StrictMode>
      <ServicesProvider value={app}>
        <QueryClientProvider client={app.svc.queryClient}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </ServicesProvider>
    </StrictMode>,
  );
  // Tray, hotkey and autostart are extras; if one fails the app still works.
  startDesktopIntegration(app.svc).catch(toastError);
} catch (error) {
  console.error(error);
  reactRoot.render(
    <Frame>
      <StartupError error={error} />
    </Frame>,
  );
}
if (inTauri) {
  revealWindow().catch(console.error);
}
