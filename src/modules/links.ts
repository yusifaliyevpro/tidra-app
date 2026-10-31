export function projectLink(projectId: string) {
  return { to: "/projects/$projectId" as const, params: { projectId } };
}
