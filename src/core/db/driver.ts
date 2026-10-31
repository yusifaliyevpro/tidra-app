/** Minimal SQL surface: Tauri implements it in Rust, tests with `node:sqlite`, web preview with sqlite-wasm. */
export interface SqlDriver {
  /** Rows as positional arrays in select order. */
  query(sql: string, params: unknown[]): Promise<unknown[][]>;
  execute(sql: string, params: unknown[]): Promise<void>;
  /** Several statements in one transaction. */
  script(sql: string): Promise<void>;
}
