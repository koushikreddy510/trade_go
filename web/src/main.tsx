import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

// The new workspace (chart, watchlists, screener, rules, positions) is the default.
// The original MCX-silver terminal stays reachable at ?view=atlas.
const root = createRoot(document.getElementById('root')!)
const atlas = new URLSearchParams(window.location.search).get('view') === 'atlas'

if (atlas) {
  void Promise.all([import('./terminal/App'), import('./terminal/styles.css')]).then(([{ App }]) => {
    root.render(<StrictMode><App /></StrictMode>)
  })
} else {
  void import('./workspace/Workspace').then(({ default: Workspace }) => {
    root.render(<StrictMode><Workspace /></StrictMode>)
  })
}
