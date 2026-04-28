import { describe, expect, it } from "vitest";

import { isTauriRuntime } from "./runtime";

describe("runtime", () => {
  it("isTauriRuntime returns false on web (no __TAURI__)", () => {
    const old = (globalThis as any).__TAURI__;
    delete (globalThis as any).__TAURI__;

    expect(isTauriRuntime()).toBe(false);

    (globalThis as any).__TAURI__ = old;
  });
});
