import { useQuery } from "@tanstack/react-query";
import { createRootRoute, Navigate, Outlet, useRouterState } from "@tanstack/react-router";
import * as z from "@zod/mini";
import { Frame } from "@/app/frame";
import { RouteError } from "@/app/route-error";
import { useServices } from "@/app/services";
import { Shell } from "@/app/shell";
import { Spinner } from "@/ui/spinner";

export const Route = createRootRoute({
  component: Root,
  errorComponent: (props) => (
    <Frame>
      <RouteError {...props} />
    </Frame>
  ),
});

function Root() {
  const svc = useServices();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const { data: onboarded, isPending } = useQuery({
    queryKey: ["onboarded"],
    queryFn: () => svc.store.getLocal("onboarded", z.boolean(), false),
  });

  if (isPending) {
    return (
      <Frame>
        <div className="flex h-full items-center justify-center">
          <Spinner />
        </div>
      </Frame>
    );
  }
  if (pathname === "/onboarding") {
    return (
      <Frame>
        <Outlet />
      </Frame>
    );
  }
  if (!onboarded) return <Navigate to="/onboarding" />;
  return <Shell />;
}
