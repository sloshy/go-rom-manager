import { describe, expect, it } from "vitest";
import { render, fireEvent } from "@solidjs/testing-library";
import { GameColumn } from "./GameColumn";

const exampleGroups = [
  { prefix: "Example Game 1", files: ["Example Game 1 (USA).zip", "Example Game 1 (Japan).zip"] },
  { prefix: "Example Game 2", files: ["Example Game 2 (World) (Rev 2).zip"] },
];

describe("GameColumn", () => {
  it("renders all groups in source mode", () => {
    const { getByText } = render(() => (
      <GameColumn
        title="SOURCE"
        side="source"
        groups={exampleGroups}
        isFileSelected={() => false}
      />
    ));
    expect(getByText("Example Game 1")).toBeInTheDocument();
    expect(getByText("Example Game 2")).toBeInTheDocument();
  });

  it("filters groups by prefix substring", () => {
    const { getByPlaceholderText, queryByText } = render(() => (
      <GameColumn
        title="SOURCE"
        side="source"
        groups={exampleGroups}
        isFileSelected={() => false}
      />
    ));
    const filter = getByPlaceholderText("type to filter...") as HTMLInputElement;
    fireEvent.input(filter, { target: { value: "Game 2" } });
    expect(queryByText("Example Game 1")).toBeNull();
    expect(queryByText("Example Game 2")).toBeInTheDocument();
  });

  it("renders extra (orange) files separately on destination side", () => {
    const { getByText } = render(() => (
      <GameColumn
        title="DEST"
        side="destination"
        groups={exampleGroups}
        extraFiles={["systems.txt"]}
        isFileSelected={() => false}
      />
    ));
    expect(getByText("EXTRA FILES (NO SOURCE COUNTERPART)")).toBeInTheDocument();
  });

  it("renders to-be-removed (red) files separately on destination side", () => {
    const { getByText, container } = render(() => (
      <GameColumn
        title="DEST"
        side="destination"
        groups={exampleGroups}
        filesToRemove={["Example Game 3 (USA).zip"]}
        isFileSelected={() => false}
      />
    ));
    expect(getByText("TO BE REMOVED ON SYNC")).toBeInTheDocument();
    expect(container.querySelector(".game-row.is-removing")).not.toBeNull();
  });

  it("does not render extras or removals in source mode", () => {
    const { queryByText } = render(() => (
      <GameColumn
        title="SOURCE"
        side="source"
        groups={exampleGroups}
        extraFiles={["systems.txt"]}
        filesToRemove={["Example Game 3 (USA).zip"]}
        isFileSelected={() => false}
      />
    ));
    expect(queryByText("EXTRA FILES (NO SOURCE COUNTERPART)")).toBeNull();
    expect(queryByText("TO BE REMOVED ON SYNC")).toBeNull();
  });

  it("filters removals and extras by the same query as groups", () => {
    const { getByPlaceholderText, queryAllByText } = render(() => (
      <GameColumn
        title="DEST"
        side="destination"
        groups={[]}
        filesToRemove={["alpha.zip", "beta.zip"]}
        extraFiles={["gamma.txt"]}
        isFileSelected={() => false}
      />
    ));
    const filter = getByPlaceholderText("type to filter...") as HTMLInputElement;
    fireEvent.input(filter, { target: { value: "alpha" } });
    expect(queryAllByText("alpha.zip").length).toBeGreaterThan(0);
    expect(queryAllByText("beta.zip").length).toBe(0);
    expect(queryAllByText("gamma.txt").length).toBe(0);
  });
});
