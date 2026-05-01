import { describe, expect, it, vi } from "vitest";
import { render, fireEvent } from "@solidjs/testing-library";
import { FilterBar } from "./FilterBar";

describe("FilterBar", () => {
  it("calls onInput as user types", () => {
    const fn = vi.fn();
    const { getByPlaceholderText } = render(() => (
      <FilterBar value="" onInput={fn} placeholder="search..." />
    ));
    const input = getByPlaceholderText("search...") as HTMLInputElement;
    fireEvent.input(input, { target: { value: "Example" } });
    expect(fn).toHaveBeenCalledWith("Example");
  });

  it("renders the controlled value", () => {
    const { getByPlaceholderText } = render(() => (
      <FilterBar value="initial" onInput={() => {}} placeholder="search..." />
    ));
    const input = getByPlaceholderText("search...") as HTMLInputElement;
    expect(input.value).toBe("initial");
  });
});
