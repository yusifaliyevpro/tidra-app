import { createFileRoute, redirect } from "@tanstack/react-router";

/** CI moved into Repos; saved notifications still link here. */
export const Route = createFileRoute("/ci")({
  beforeLoad: () => {
    throw redirect({ to: "/repos", search: { filter: "ci" } });
  },
});
