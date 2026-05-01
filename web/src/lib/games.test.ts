import { describe, expect, it } from "vitest";
import { autoSelect, groupFiles, parseName } from "./games";

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
});
