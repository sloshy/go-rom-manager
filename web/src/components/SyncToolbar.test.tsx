import { describe, expect, it, vi } from "vitest";
import { render, fireEvent } from "@solidjs/testing-library";
import { SyncToolbar } from "./SyncToolbar";

describe("SyncToolbar", () => {
  it("renders pending diff counts", () => {
    const { getByText } = render(() => (
      <SyncToolbar toCopy={3} toDelete={1} dirty={true} onSync={() => {}} syncing={false} />
    ));
    expect(getByText("+3")).toBeInTheDocument();
    expect(getByText("-1")).toBeInTheDocument();
  });

  it("disables SYNC when there is nothing to do", () => {
    const { getByText } = render(() => (
      <SyncToolbar
        toCopy={0}
        toDelete={0}
        dirty={false}
        onSync={() => {}}
        syncing={false}
      />
    ));
    expect(getByText("SYNC")).toBeDisabled();
  });

  it("enables SYNC when there is a file diff", () => {
    const { getByText } = render(() => (
      <SyncToolbar
        toCopy={1}
        toDelete={0}
        dirty={false}
        onSync={() => {}}
        syncing={false}
      />
    ));
    expect(getByText("SYNC")).toBeEnabled();
  });

  it("enables SYNC when only manual-group/selection edits are pending (no file diff)", () => {
    const { getByText } = render(() => (
      <SyncToolbar
        toCopy={0}
        toDelete={0}
        dirty={true}
        onSync={() => {}}
        syncing={false}
      />
    ));
    expect(getByText("SYNC")).toBeEnabled();
  });

  it("disables SYNC while syncing is in progress", () => {
    const { getByText } = render(() => (
      <SyncToolbar
        toCopy={1}
        toDelete={0}
        dirty={true}
        onSync={() => {}}
        syncing={true}
      />
    ));
    expect(getByText("SYNCING...")).toBeDisabled();
  });

  it("calls onSync when SYNC is clicked", () => {
    const onSync = vi.fn();
    const { getByText } = render(() => (
      <SyncToolbar toCopy={1} toDelete={0} dirty={false} onSync={onSync} syncing={false} />
    ));
    fireEvent.click(getByText("SYNC"));
    expect(onSync).toHaveBeenCalled();
  });
});
