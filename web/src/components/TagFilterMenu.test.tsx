import { describe, expect, it, vi } from "vitest";
import { render, fireEvent } from "@solidjs/testing-library";
import { TagFilterMenu } from "./TagFilterMenu";

describe("TagFilterMenu", () => {
  it("hides the panel until the trigger is clicked", () => {
    const { queryByText, getByText } = render(() => (
      <TagFilterMenu
        tokens={["USA", "Europe"]}
        filters={{}}
        onFilterChange={() => {}}
        filterGroupedItems={false}
        onToggleGroupedItems={() => {}}
      />
    ));
    expect(queryByText("USA")).toBeNull();
    fireEvent.click(getByText(/TAG FILTERS/));
    expect(getByText("USA")).toBeInTheDocument();
    expect(getByText("Europe")).toBeInTheDocument();
  });

  it("cycles a chip from off → positive on first click", () => {
    const fn = vi.fn();
    const { getByText } = render(() => (
      <TagFilterMenu
        tokens={["USA"]}
        filters={{}}
        onFilterChange={fn}
        filterGroupedItems={false}
        onToggleGroupedItems={() => {}}
      />
    ));
    fireEvent.click(getByText(/TAG FILTERS/));
    fireEvent.click(getByText("USA"));
    expect(fn).toHaveBeenCalledWith({ USA: "positive" });
  });

  it("cycles positive → negative", () => {
    const fn = vi.fn();
    const { getByText } = render(() => (
      <TagFilterMenu
        tokens={["USA"]}
        filters={{ USA: "positive" }}
        onFilterChange={fn}
        filterGroupedItems={false}
        onToggleGroupedItems={() => {}}
      />
    ));
    fireEvent.click(getByText(/TAG FILTERS/));
    fireEvent.click(getByText("USA"));
    expect(fn).toHaveBeenCalledWith({ USA: "negative" });
  });

  it("cycles negative → off (removes the entry)", () => {
    const fn = vi.fn();
    const { getByText } = render(() => (
      <TagFilterMenu
        tokens={["USA"]}
        filters={{ USA: "negative" }}
        onFilterChange={fn}
        filterGroupedItems={false}
        onToggleGroupedItems={() => {}}
      />
    ));
    fireEvent.click(getByText(/TAG FILTERS/));
    fireEvent.click(getByText("USA"));
    expect(fn).toHaveBeenCalledWith({});
  });

  it("shows active count in the trigger", () => {
    const { getByText } = render(() => (
      <TagFilterMenu
        tokens={["USA", "Europe", "Japan"]}
        filters={{ USA: "positive", Japan: "negative" }}
        onFilterChange={() => {}}
        filterGroupedItems={false}
        onToggleGroupedItems={() => {}}
      />
    ));
    expect(getByText("TAG FILTERS (2)")).toBeInTheDocument();
  });

  it("renders empty-state copy when no tokens are available", () => {
    const { getByText } = render(() => (
      <TagFilterMenu
        tokens={[]}
        filters={{}}
        onFilterChange={() => {}}
        filterGroupedItems={false}
        onToggleGroupedItems={() => {}}
      />
    ));
    fireEvent.click(getByText(/TAG FILTERS/));
    expect(getByText("No tags detected.")).toBeInTheDocument();
  });

  it("toggles the grouped-items checkbox", () => {
    const fn = vi.fn();
    const { getByLabelText, getByText } = render(() => (
      <TagFilterMenu
        tokens={["USA"]}
        filters={{}}
        onFilterChange={() => {}}
        filterGroupedItems={false}
        onToggleGroupedItems={fn}
      />
    ));
    fireEvent.click(getByText(/TAG FILTERS/));
    const checkbox = getByLabelText(/Filter grouped items/i, { exact: false }) as HTMLInputElement;
    fireEvent.click(checkbox);
    expect(fn).toHaveBeenCalledWith(true);
  });

  it("clears all filters when CLEAR is pressed", () => {
    const fn = vi.fn();
    const { getByText } = render(() => (
      <TagFilterMenu
        tokens={["USA"]}
        filters={{ USA: "positive" }}
        onFilterChange={fn}
        filterGroupedItems={false}
        onToggleGroupedItems={() => {}}
      />
    ));
    fireEvent.click(getByText(/TAG FILTERS/));
    fireEvent.click(getByText("CLEAR"));
    expect(fn).toHaveBeenCalledWith({});
  });
});
