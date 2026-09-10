import { describe, expect, it } from "vitest";
import type { Profile } from "@/lib/profiles";
import { findSameHostExecutor } from "./SettingsDialog";

function directProfile(id: string, host: string): Profile {
  return { id, label: id, host, relayPort: 8765 };
}

function tailnetProfile(id: string): Profile {
  return {
    id,
    label: id,
    // Every tailnet profile reports this same placeholder host — never a
    // real, shared machine (see ThemeSection's registry comment).
    host: "127.0.0.1",
    relayPort: 0,
    tailnetAuthKey: "key",
    tailnetControlUrl: "https://headscale.test",
    tailnetTarget: "100.64.0.1:8443",
  };
}

describe("findSameHostExecutor", () => {
  it("finds another profile on the same real host as a valid executor (direct mode, unchanged)", () => {
    const scoped = directProfile("a", "192.168.0.10");
    const other = directProfile("b", "192.168.0.10");
    expect(findSameHostExecutor(scoped, [scoped, other])).toBe(other);
  });

  it("never treats another tailnet profile as an executor — each is its own isolated sandbox", () => {
    const scoped = tailnetProfile("sandbox-a");
    const other = tailnetProfile("sandbox-b");
    expect(findSameHostExecutor(scoped, [scoped, other])).toBeUndefined();
  });

  it("never treats a tailnet profile as an executor for a direct profile just because they share the placeholder host", () => {
    const scoped = directProfile("direct", "127.0.0.1");
    const sandbox = tailnetProfile("sandbox-a");
    expect(findSameHostExecutor(scoped, [scoped, sandbox])).toBeUndefined();
  });
});
