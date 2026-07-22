import { describe, it, expect } from "vitest";
import type { SettingsJson, Workspace } from "../src/types.js";

describe("smoke", () => {
  it("compiles and runs", () => {
    const s: SettingsJson = { permissions: { additionalDirectories: [] } };
    const w: Workspace = { name: "demo", path: "/tmp/demo", dirs: [], missing: 0 };
    expect(s.permissions?.additionalDirectories).toEqual([]);
    expect(w.name).toBe("demo");
  });
});
