import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, waitFor } from "@solidjs/testing-library";
import { FolderBrowser } from "./FolderBrowser";

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const u = new URL(url, "http://localhost");
      const root = u.searchParams.get("root") ?? "";
      const sub = u.searchParams.get("sub") ?? "";
      const path = sub ? `${root}/${sub}` : root;
      const entries = sub
        ? []
        : [
            { name: "snes", isDir: true },
            { name: "genesis", isDir: true },
            { name: "readme.txt", isDir: false },
            { name: "thumbnail.png", isDir: false },
          ];
      return new Response(JSON.stringify({ path, entries }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch,
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("FolderBrowser", () => {
  it("fires onSelect with the active root on mount (single root case)", async () => {
    const onSelect = vi.fn();
    render(() => <FolderBrowser roots={["/configured/roms"]} onSelect={onSelect} />);
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith("/configured/roms"));
  });

  it("updates the selection when drilling into a subfolder", async () => {
    const onSelect = vi.fn();
    const { findByText } = render(() => (
      <FolderBrowser roots={["/configured/roms"]} onSelect={onSelect} />
    ));
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith("/configured/roms"));
    const dir = await findByText("snes");
    fireEvent.click(dir);
    await waitFor(() =>
      expect(onSelect).toHaveBeenLastCalledWith("/configured/roms/snes"),
    );
  });

  it("jumps back to the root when the path breadcrumb is clicked", async () => {
    const onSelect = vi.fn();
    const { findByText, getByLabelText } = render(() => (
      <FolderBrowser roots={["/configured/roms"]} onSelect={onSelect} />
    ));
    fireEvent.click(await findByText("snes"));
    await waitFor(() =>
      expect(onSelect).toHaveBeenLastCalledWith("/configured/roms/snes"),
    );

    fireEvent.click(getByLabelText("jump to root"));
    await waitFor(() =>
      expect(onSelect).toHaveBeenLastCalledWith("/configured/roms"),
    );
  });

  it("hides files and only renders directory entries", async () => {
    const { findByText, queryByText } = render(() => (
      <FolderBrowser roots={["/configured/roms"]} onSelect={() => {}} />
    ));
    await findByText("snes");
    expect(queryByText("snes")).toBeInTheDocument();
    expect(queryByText("genesis")).toBeInTheDocument();
    expect(queryByText("readme.txt")).toBeNull();
    expect(queryByText("thumbnail.png")).toBeNull();
  });

  it("re-fires onSelect with the new root when switching between multiple roots", async () => {
    const onSelect = vi.fn();
    const { findByText } = render(() => (
      <FolderBrowser
        roots={["/configured/roms", "/extra/roms"]}
        onSelect={onSelect}
      />
    ));
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith("/configured/roms"));
    fireEvent.click(await findByText("/extra/roms"));
    await waitFor(() => expect(onSelect).toHaveBeenLastCalledWith("/extra/roms"));
  });
});
