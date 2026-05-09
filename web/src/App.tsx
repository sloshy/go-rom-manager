import { Component } from 'solid-js'
import { Route, Router, A } from '@solidjs/router'
import { Home } from './pages/Home'
import { Editor } from './pages/Editor'
import { Settings } from './pages/Settings'
import { MappingSettings } from './pages/MappingSettings'
import { Licenses } from './pages/Licenses'

export const App: Component = () => (
  <Router root={Shell}>
    <Route path="/" component={Home} />
    <Route path="/settings" component={Settings} />
    <Route path="/licenses" component={Licenses} />
    <Route path="/mapping/:id" component={Editor} />
    <Route path="/mapping/:id/settings" component={MappingSettings} />
  </Router>
)

const Shell: Component<{ children?: any }> = (props) => (
  <div class="app-shell">
    <header class="app-header">
      <span class="brand">go-rom-manager</span>
      <span class="text-dim">// game collection manager</span>
      <A href="/licenses" class="crumbs" style={{ 'margin-left': 'auto' }}>
        [LICENSES]
      </A>
      <A href="/settings" class="crumbs">
        [SETTINGS]
      </A>
      <A href="/" class="crumbs">
        [HOME]
      </A>
    </header>
    <main class="app-main">{props.children}</main>
  </div>
)
