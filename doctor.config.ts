import { defineConfig } from "react-doctor/api";

export default defineConfig({
  ignore: {
    files: ["src/routeTree.gen.ts", "src-tauri/**", "drizzle/**", "tests/**"],
  },
  rules: {
    // Services invalidate the query cache themselves (svc.queryClient), because background jobs change the same
    // data outside React; mutations call those services rather than repeating the invalidation.
    "react-doctor/query-mutation-missing-invalidation": "off",
  },
});
