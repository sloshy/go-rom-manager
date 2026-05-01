import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { editor } from "./editor";

let lastSyncBody: { intended: string[]; manualGroups: Record<string, string> } | null = null;

type LoadFixture = {
  destFiles: string[];
  manualGroups?: Record<string, string>;
};

let nextLoad: LoadFixture = { destFiles: ["Example Game 1 (USA).zip"] };

beforeEach(() => {
  lastSyncBody = null;
  nextLoad = { destFiles: ["Example Game 1 (USA).zip"] };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = typeof url === "string" ? url : (url as URL).toString();
      if (u.endsWith("/sync") && init?.method === "POST") {
        lastSyncBody = JSON.parse(init.body as string);
        return new Response(JSON.stringify({ copied: [], deleted: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (u.includes("/api/mappings/")) {
        const detail = {
          mapping: {
            id: "x",
            name: "test",
            sourcePath: "/s",
            destPath: "/d",
            manualGroups: nextLoad.manualGroups ?? {},
          },
          sourceFiles: ["Example Game 1 (USA).zip", "Example Game 1 (Japan).zip", "Example Game 2 (USA).zip"],
          destFiles: nextLoad.destFiles,
          sourceGroups: [
            { prefix: "Example Game 1", files: ["Example Game 1 (USA).zip", "Example Game 1 (Japan).zip"] },
            { prefix: "Example Game 2", files: ["Example Game 2 (USA).zip"] },
          ],
        };
        return new Response(JSON.stringify(detail), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("", { status: 404 });
    }) as typeof fetch,
  );
});

afterEach(() => vi.unstubAllGlobals());

describe("editor", () => {
  it("derives initial selected set from source ∩ dest", async () => {
    nextLoad = { destFiles: ["Example Game 1 (USA).zip", "leftover.txt"] };
    await editor.load("x");
    // "leftover.txt" has no source counterpart → not selected, surfaces as orange.
    expect(editor.isFileSelected("Example Game 1 (USA).zip")).toBe(true);
    expect(editor.isFileSelected("leftover.txt")).toBe(false);
    expect(editor.extraFiles()).toEqual(["leftover.txt"]);
  });

  it("toggleFile flips selection state for that filename", async () => {
    await editor.load("x");
    expect(editor.isFileSelected("Example Game 1 (USA).zip")).toBe(true);

    editor.toggleFile("Example Game 1 (USA).zip");
    expect(editor.isFileSelected("Example Game 1 (USA).zip")).toBe(false);

    editor.toggleFile("Example Game 1 (USA).zip");
    expect(editor.isFileSelected("Example Game 1 (USA).zip")).toBe(true);
  });

  it("filesToRemove lists deselected dest files that have a source counterpart", async () => {
    await editor.load("x");
    editor.toggleFile("Example Game 1 (USA).zip");
    expect(editor.filesToRemove()).toEqual(["Example Game 1 (USA).zip"]);
    expect(editor.extraFiles()).toEqual([]);
  });

  it("clearFiles removes every passed filename from the selected set", async () => {
    nextLoad = { destFiles: ["Example Game 1 (USA).zip", "Example Game 1 (Japan).zip"] };
    await editor.load("x");
    expect(editor.isFileSelected("Example Game 1 (USA).zip")).toBe(true);
    expect(editor.isFileSelected("Example Game 1 (Japan).zip")).toBe(true);

    editor.clearFiles(["Example Game 1 (USA).zip", "Example Game 1 (Japan).zip"]);
    expect(editor.isFileSelected("Example Game 1 (USA).zip")).toBe(false);
    expect(editor.isFileSelected("Example Game 1 (Japan).zip")).toBe(false);
  });

  it("togglePrefix clears the group when any file is selected, otherwise auto-picks", async () => {
    nextLoad = { destFiles: [] };
    await editor.load("x");
    // Nothing selected — togglePrefix should auto-pick the best variant.
    editor.togglePrefix(["Example Game 1 (USA).zip", "Example Game 1 (Japan).zip"]);
    expect(editor.isFileSelected("Example Game 1 (USA).zip")).toBe(true);
    expect(editor.isFileSelected("Example Game 1 (Japan).zip")).toBe(false);

    // Now any file selected — togglePrefix should clear them.
    editor.togglePrefix(["Example Game 1 (USA).zip", "Example Game 1 (Japan).zip"]);
    expect(editor.isFileSelected("Example Game 1 (USA).zip")).toBe(false);
  });

  it("sync sends the flat intended list and manualGroups", async () => {
    await editor.load("x");
    editor.toggleFile("Example Game 1 (USA).zip"); // deselect
    editor.toggleFile("Example Game 2 (USA).zip"); // newly select

    await editor.sync();

    expect(lastSyncBody).not.toBeNull();
    expect(lastSyncBody!.intended.sort()).toEqual(["Example Game 2 (USA).zip"]);
  });

  it("rehydrates from disk after sync — no persisted selection state", async () => {
    await editor.load("x");
    expect(editor.isFileSelected("Example Game 1 (USA).zip")).toBe(true);

    // User deselects in memory.
    editor.toggleFile("Example Game 1 (USA).zip");
    expect(editor.isFileSelected("Example Game 1 (USA).zip")).toBe(false);

    // The reload (after sync) reflects new dest contents — pretend the
    // server actually deleted the file. The editor must rebuild "selected"
    // from disk, not from any stale persisted JSON.
    nextLoad = { destFiles: [] };
    await editor.sync();

    expect(editor.isFileSelected("Example Game 1 (USA).zip")).toBe(false);
    expect(editor.filesToRemove()).toEqual([]);
    expect(editor.extraFiles()).toEqual([]);
  });
});
