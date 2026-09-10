import { beforeEach, describe, expect, it } from "vitest";
import { getProfiles, setProfiles } from "@/lib/profiles";
import { importProfile, parseImportProfileUrl } from "./profileImport";

beforeEach(() => {
  localStorage.clear();
});

describe("parseImportProfileUrl", () => {
  it("parses a well-formed import-profile link", () => {
    const parsed = parseImportProfileUrl(
      "ultron://import-profile?host=1.2.3.4&port=8443&label=Paired%20device&token=s3cr3t",
    );
    expect(parsed).toEqual({ host: "1.2.3.4", port: 8443, label: "Paired device", connectToken: "s3cr3t" });
  });

  it("omits connectToken when the link carries no token param", () => {
    const parsed = parseImportProfileUrl("ultron://import-profile?host=1.2.3.4&port=8443&label=Device");
    expect(parsed).toEqual({ host: "1.2.3.4", port: 8443, label: "Device", connectToken: undefined });
  });

  it("rejects a different scheme", () => {
    expect(parseImportProfileUrl("https://import-profile?host=1.2.3.4&port=8443&label=Device")).toBeNull();
  });

  it("rejects a different ultron:// action", () => {
    expect(parseImportProfileUrl("ultron://something-else?host=1.2.3.4&port=8443&label=Device")).toBeNull();
  });

  it("rejects a missing required field", () => {
    expect(parseImportProfileUrl("ultron://import-profile?port=8443&label=Device")).toBeNull();
    expect(parseImportProfileUrl("ultron://import-profile?host=1.2.3.4&label=Device")).toBeNull();
    expect(parseImportProfileUrl("ultron://import-profile?host=1.2.3.4&port=8443")).toBeNull();
  });

  it("rejects a non-numeric or non-positive port", () => {
    expect(parseImportProfileUrl("ultron://import-profile?host=1.2.3.4&port=abc&label=Device")).toBeNull();
    expect(parseImportProfileUrl("ultron://import-profile?host=1.2.3.4&port=0&label=Device")).toBeNull();
    expect(parseImportProfileUrl("ultron://import-profile?host=1.2.3.4&port=-1&label=Device")).toBeNull();
  });

  it("rejects a malformed URL outright", () => {
    expect(parseImportProfileUrl("not a url")).toBeNull();
  });
});

describe("importProfile", () => {
  it("adds a new profile to the real store and returns its id", () => {
    setProfiles([{ id: "existing", label: "Existing", host: "127.0.0.1", relayPort: 8765 }]);

    const id = importProfile({ host: "1.2.3.4", port: 8443, label: "Paired device", connectToken: "s3cr3t" });

    const added = getProfiles().find((p) => p.id === id);
    expect(added).toEqual({ id, label: "Paired device", host: "1.2.3.4", relayPort: 8443, connectToken: "s3cr3t" });
    expect(getProfiles()).toHaveLength(2);
  });

  it("generates a fresh id on every call, even for identical params", () => {
    setProfiles([]);
    const first = importProfile({ host: "1.2.3.4", port: 8443, label: "Device" });
    const second = importProfile({ host: "1.2.3.4", port: 8443, label: "Device" });
    expect(first).not.toBe(second);
    expect(getProfiles()).toHaveLength(2);
  });
});
