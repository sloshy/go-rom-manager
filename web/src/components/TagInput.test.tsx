import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { TagInput } from "./TagInput";

describe("TagInput", () => {
  it("renders one chip per item", () => {
    const { getByText } = render(() => (
      <TagInput items={[".rvz", ".cso"]} onChange={() => {}} />
    ));
    expect(getByText(".rvz")).toBeInTheDocument();
    expect(getByText(".cso")).toBeInTheDocument();
  });

  it("commits the draft as a chip when a comma is typed", () => {
    const [items, setItems] = createSignal<string[]>([]);
    const { getByRole } = render(() => (
      <TagInput items={items()} onChange={setItems} />
    ));
    const input = getByRole("textbox") as HTMLInputElement;
    fireEvent.input(input, { target: { value: "rvz," } });
    expect(items()).toEqual(["rvz"]);
    // Field cleared after commit.
    expect(input.value).toBe("");
  });

  it("commits multiple chips from a comma-separated paste", () => {
    const [items, setItems] = createSignal<string[]>([]);
    const { getByRole } = render(() => (
      <TagInput items={items()} onChange={setItems} />
    ));
    const input = getByRole("textbox") as HTMLInputElement;
    fireEvent.input(input, { target: { value: "rvz,cso,chd" } });
    // Last segment ("chd") stays in the draft, only "rvz" and "cso" commit.
    expect(items()).toEqual(["rvz", "cso"]);
    expect(input.value).toBe("chd");
  });

  it("commits the draft on Enter", () => {
    const [items, setItems] = createSignal<string[]>([]);
    const { getByRole } = render(() => (
      <TagInput items={items()} onChange={setItems} />
    ));
    const input = getByRole("textbox") as HTMLInputElement;
    fireEvent.input(input, { target: { value: "bin" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(items()).toEqual(["bin"]);
  });

  it("removes the last chip on Backspace when the field is empty", () => {
    const [items, setItems] = createSignal([".rvz", ".cso"]);
    const { getByRole } = render(() => (
      <TagInput items={items()} onChange={setItems} />
    ));
    const input = getByRole("textbox") as HTMLInputElement;
    fireEvent.keyDown(input, { key: "Backspace" });
    expect(items()).toEqual([".rvz"]);
  });

  it("removes a chip when its X is clicked", () => {
    const fn = vi.fn();
    const { getByLabelText } = render(() => (
      <TagInput items={[".rvz", ".cso"]} onChange={fn} />
    ));
    fireEvent.click(getByLabelText("Remove .rvz"));
    expect(fn).toHaveBeenCalledWith([".cso"]);
  });

  it("applies the normalize callback before committing", () => {
    const [items, setItems] = createSignal<string[]>([]);
    const { getByRole } = render(() => (
      <TagInput
        items={items()}
        onChange={setItems}
        normalize={(raw) => {
          const t = raw.trim().replace(/^\./, "").toLowerCase();
          return t ? "." + t : "";
        }}
      />
    ));
    const input = getByRole("textbox") as HTMLInputElement;
    fireEvent.input(input, { target: { value: "  RVZ ," } });
    expect(items()).toEqual([".rvz"]);
  });

  it("silently drops duplicates", () => {
    const [items, setItems] = createSignal([".rvz"]);
    const { getByRole } = render(() => (
      <TagInput items={items()} onChange={setItems} />
    ));
    const input = getByRole("textbox") as HTMLInputElement;
    fireEvent.input(input, { target: { value: ".rvz," } });
    expect(items()).toEqual([".rvz"]);
  });

  it("disables removal when disabled", () => {
    const fn = vi.fn();
    const { getByLabelText, getByRole } = render(() => (
      <TagInput items={[".rvz"]} onChange={fn} disabled />
    ));
    const remove = getByLabelText("Remove .rvz") as HTMLButtonElement;
    expect(remove.disabled).toBe(true);
    expect((getByRole("textbox") as HTMLInputElement).disabled).toBe(true);
  });

  it("does not remove the last chip via Backspace when disabled", () => {
    const fn = vi.fn();
    const { getByRole } = render(() => (
      <TagInput items={[".rvz"]} onChange={fn} disabled />
    ));
    fireEvent.keyDown(getByRole("textbox"), { key: "Backspace" });
    expect(fn).not.toHaveBeenCalled();
  });

  it("commits a non-empty draft on blur", () => {
    const [items, setItems] = createSignal<string[]>([]);
    const { getByRole } = render(() => (
      <TagInput items={items()} onChange={setItems} />
    ));
    const input = getByRole("textbox") as HTMLInputElement;
    fireEvent.input(input, { target: { value: "bin" } });
    fireEvent.blur(input);
    expect(items()).toEqual(["bin"]);
    expect(input.value).toBe("");
  });

  it("clears a whitespace-only draft on blur without committing", () => {
    const fn = vi.fn();
    const { getByRole } = render(() => <TagInput items={[]} onChange={fn} />);
    const input = getByRole("textbox") as HTMLInputElement;
    fireEvent.input(input, { target: { value: "   " } });
    fireEvent.blur(input);
    expect(fn).not.toHaveBeenCalled();
    // Critical: the field is cleared even though the trimmed draft was empty,
    // so the user doesn't get stuck with stale whitespace on next focus.
    expect(input.value).toBe("");
  });

  it("clears the field even after a comma-only commit (no equals:false)", () => {
    // Regression test: previously the controlled input wouldn't sync back
    // to "" because setDraft("") to an already-empty signal was a no-op.
    const [items, setItems] = createSignal<string[]>([]);
    const { getByRole } = render(() => (
      <TagInput items={items()} onChange={setItems} />
    ));
    const input = getByRole("textbox") as HTMLInputElement;
    fireEvent.input(input, { target: { value: "rvz," } });
    fireEvent.input(input, { target: { value: "rvz," } });
    expect(input.value).toBe("");
  });

  it("commits the draft as a chip when a space is typed", () => {
    const [items, setItems] = createSignal<string[]>([]);
    const { getByRole } = render(() => (
      <TagInput items={items()} onChange={setItems} />
    ));
    const input = getByRole("textbox") as HTMLInputElement;
    fireEvent.input(input, { target: { value: "bin " } });
    expect(items()).toEqual(["bin"]);
    expect(input.value).toBe("");
  });

  it("commits multiple chips from a space-separated paste", () => {
    const [items, setItems] = createSignal<string[]>([]);
    const { getByRole } = render(() => (
      <TagInput items={items()} onChange={setItems} />
    ));
    const input = getByRole("textbox") as HTMLInputElement;
    fireEvent.input(input, { target: { value: "rvz cso chd" } });
    // Last segment ("chd") stays in the draft; only "rvz" and "cso" commit.
    expect(items()).toEqual(["rvz", "cso"]);
    expect(input.value).toBe("chd");
  });

  it("commits a quoted string containing a space as a single chip", () => {
    const [items, setItems] = createSignal<string[]>([]);
    const { getByRole } = render(() => (
      <TagInput items={items()} onChange={setItems} />
    ));
    const input = getByRole("textbox") as HTMLInputElement;
    fireEvent.input(input, { target: { value: '"my format.zip"' } });
    expect(items()).toEqual(["my format.zip"]);
    expect(input.value).toBe("");
  });

  it("keeps an unclosed quoted string in the draft", () => {
    const [items, setItems] = createSignal<string[]>([]);
    const { getByRole } = render(() => (
      <TagInput items={items()} onChange={setItems} />
    ));
    const input = getByRole("textbox") as HTMLInputElement;
    fireEvent.input(input, { target: { value: '"my ext' } });
    expect(items()).toEqual([]);
    expect(input.value).toBe('"my ext');
  });
});
