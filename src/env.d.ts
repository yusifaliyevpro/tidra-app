interface ImportMetaEnv {
  /** Set by the Tauri CLI while it builds or runs the desktop app; absent for `pnpm web`. */
  readonly TAURI_ENV_PLATFORM?: string;
}
