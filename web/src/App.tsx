import { Component } from "solid-js";
import { Route, Router, A } from "@solidjs/router";
import { Home } from "./pages/Home";
import { Editor } from "./pages/Editor";

export const App: Component = () => (
  <Router root={Shell}>
    <Route path="/" component={Home} />
    <Route path="/mapping/:id" component={Editor} />
  </Router>
);

const Shell: Component<{ children?: any }> = (props) => (
  <div class="app-shell">
    <header class="app-header">
      <span class="brand">go-rom-manager</span>
      <span class="text-dim">// game collection manager</span>
      <A href="/" class="crumbs" style={{ "margin-left": "auto" }}>
        [HOME]
      </A>
    </header>
    <main class="app-main">{props.children}</main>
  </div>
);
