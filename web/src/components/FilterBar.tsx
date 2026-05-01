import { Component } from "solid-js";

export interface FilterBarProps {
  value: string;
  onInput: (v: string) => void;
  placeholder?: string;
}

export const FilterBar: Component<FilterBarProps> = (props) => (
  <div class="row" style={{ "margin-bottom": "8px" }}>
    <span class="text-dim" style={{ "min-width": "60px" }}>
      FILTER &gt;
    </span>
    <input
      type="search"
      style={{ flex: 1 }}
      value={props.value}
      placeholder={props.placeholder ?? "type to filter..."}
      onInput={(e) => props.onInput(e.currentTarget.value)}
    />
  </div>
);
