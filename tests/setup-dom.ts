import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// jsdom lays nothing out, so it has no ResizeObserver.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

afterEach(() => cleanup());
