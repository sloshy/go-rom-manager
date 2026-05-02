import { describe, expect, it } from "vitest";
import { autoSelect, fileExt, fileStem, groupFiles, isAllowedExt, parseName } from "./games";

describe("parseName", () => {
  it("splits prefix and tags", () => {
    const p = parseName("Example Game 1 (USA).zip");
    expect(p.prefix).toBe("Example Game 1");
    expect(p.tags).toEqual(["USA"]);
  });

  it("returns multiple tags in order", () => {
    const p = parseName("Example Game 2 (World) (Rev 2).zip");
    expect(p.prefix).toBe("Example Game 2");
    expect(p.tags).toEqual(["World", "Rev 2"]);
  });

  it("handles untagged names", () => {
    const p = parseName("Plain Title.zip");
    expect(p.prefix).toBe("Plain Title");
    expect(p.tags).toEqual([]);
  });
});

describe("groupFiles", () => {
  it("buckets files by parsed prefix", () => {
    const groups = groupFiles([
      "Example Game 1 (USA).zip",
      "Example Game 1 (Japan).zip",
      "Example Game 2 (World).zip",
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0].prefix).toBe("Example Game 1");
    expect(groups[0].files).toHaveLength(2);
    expect(groups[1].prefix).toBe("Example Game 2");
  });

  it("honours manual group overrides", () => {
    const groups = groupFiles(
      ["Example Game 1 (USA).zip", "Some Different Title (Japan).zip"],
      { "Some Different Title (Japan).zip": "Example Game 1" },
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].files).toHaveLength(2);
  });
});

describe("autoSelect", () => {
  it("prefers USA", () => {
    expect(
      autoSelect([
        "Example Game 1 (Japan).zip",
        "Example Game 1 (USA).zip",
        "Example Game 1 (Europe).zip",
      ]),
    ).toBe("Example Game 1 (USA).zip");
  });

  it("falls back to World", () => {
    expect(
      autoSelect(["Example Game 2 (Japan).zip", "Example Game 2 (World).zip"]),
    ).toBe("Example Game 2 (World).zip");
  });

  it("picks highest revision within priority", () => {
    expect(
      autoSelect([
        "Example Game 3 (USA).zip",
        "Example Game 3 (USA) (Rev 1).zip",
        "Example Game 3 (USA) (Rev 2).zip",
      ]),
    ).toBe("Example Game 3 (USA) (Rev 2).zip");
  });

  it("excludes Demo and Proto when alternatives exist", () => {
    expect(
      autoSelect([
        "Example Game 4 (USA) (Demo).zip",
        "Example Game 4 (USA) (Proto).zip",
        "Example Game 4 (USA).zip",
      ]),
    ).toBe("Example Game 4 (USA).zip");
  });

  it("returns empty for empty input", () => {
    expect(autoSelect([])).toBe("");
  });

  it("respects a custom preference order", () => {
    const files = [
      "Example Game 1 (USA).zip",
      "Example Game 1 (Japan).zip",
      "Example Game 1 (Europe).zip",
    ];
    expect(autoSelect(files, ["Japan", "USA"])).toBe("Example Game 1 (Japan).zip");
    expect(autoSelect(files, ["Europe"])).toBe("Example Game 1 (Europe).zip");
  });

  it("falls through unmatched preferences in order", () => {
    const files = ["Example Game 1 (Japan).zip", "Example Game 1 (Europe).zip"];
    expect(autoSelect(files, ["USA", "Japan", "Europe"])).toBe("Example Game 1 (Japan).zip");
  });

  it("filters Demo/Proto regardless of preferences", () => {
    const files = ["Example Game 1 (Japan) (Demo).zip", "Example Game 1 (Japan).zip"];
    expect(autoSelect(files, ["Japan"])).toBe("Example Game 1 (Japan).zip");
  });
});

describe("fileStem / fileExt", () => {
  it("strips the trailing extension", () => {
    expect(fileStem("Game.zip")).toBe("Game");
    expect(fileStem("Sample Game (USA).rvz")).toBe("Sample Game (USA)");
  });

  it("returns the bare name when there's no extension", () => {
    expect(fileStem("README")).toBe("README");
    expect(fileExt("README")).toBe("");
  });

  it("treats leading-dot files as having no extension (stem = full name)", () => {
    expect(fileStem(".gitignore")).toBe(".gitignore");
    expect(fileExt(".gitignore")).toBe("");
  });

  it("lowercases the extension", () => {
    expect(fileExt("Game.RVZ")).toBe(".rvz");
  });

  it("treats compound extensions as a single token", () => {
    expect(fileExt("Example (USA).tar.gz")).toBe(".tar.gz");
    expect(fileExt("Example (USA).tar.bz2")).toBe(".tar.bz2");
    expect(fileExt("Example (USA).tar.xz")).toBe(".tar.xz");
    expect(fileExt("Example (USA).tar.zst")).toBe(".tar.zst");
    expect(fileStem("Example (USA).tar.gz")).toBe("Example (USA)");
  });

  it("stem + ext round-trips for both simple and compound extensions", () => {
    for (const f of ["Game.zip", "Sample (USA).rvz", "Archive (World).tar.gz"]) {
      expect(fileStem(f) + fileExt(f)).toBe(f);
    }
  });

  it("compound extension match is case-insensitive", () => {
    expect(fileExt("Example.TAR.GZ")).toBe(".tar.gz");
    expect(fileStem("Example.TAR.GZ")).toBe("Example");
  });
});

describe("isAllowedExt", () => {
  it("matches case-insensitively against a normalized allow list", () => {
    expect(isAllowedExt("Game.RVZ", [".rvz"])).toBe(true);
    expect(isAllowedExt("Game.zip", [".rvz", ".cso"])).toBe(false);
  });

  it("returns false for empty allow list", () => {
    expect(isAllowedExt("Game.rvz", [])).toBe(false);
  });
});
