# Codesight Frontend Redesign

## Context

The codesight analysis engine is solid — tree-sitter parsing, call graphs with confidence scoring, impact analysis — but the frontend feels like a dev prototype. The current UI is a monolithic 39KB `main.mjs` with inline `onclick` handlers in template strings, a fixed 360px sidebar, and a chat panel that floats awkwardly over the graph. This redesign upgrades the frontend to a polished, familiar developer-tool aesthetic while decomposing the monolith into maintainable components.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Layout | VS Code-style (activity bar + sidebar + graph + secondary sidebar) | Familiar to every developer, proven layout for tool UIs |
| Component system | Lit web components | Fixes the monolith, no build step required, standard web components |
| Color theme | Catppuccin Mocha | Warm, soft, popular dev theme, easy on the eyes |
| Graph nodes | Info cards (icon + name + stats + badges) | High info density at a glance, scales by importance |
| Chat placement | Right secondary sidebar (slide-in) | Mirrors VS Code Copilot Chat, doesn't compete with navigation sidebar |
| Frameworks | Open to anything, chose Lit for lightweight component model | No virtual DOM overhead, compiles to standard web components |

## Architecture

### Component Tree

```
<cs-app>
├── <cs-activity-bar>          # Left icon strip (48px)
│   ├── Explorer icon (default)
│   ├── Search icon
│   ├── Tours icon
│   ├── Chat icon (bottom)
│   └── Settings icon (bottom)
├── <cs-sidebar>               # Left panel (280px, collapsible)
│   ├── Explorer tab           # Module list, file tree, stats, key files, entry points
│   ├── Search tab             # Unified search across files, symbols, modules
│   └── Tours tab              # Tour list and step-by-step navigation
├── <cs-main>                  # Center area (flex)
│   ├── <cs-breadcrumb>        # Navigation path
│   └── <cs-graph>             # Cytoscape.js wrapper with info-card nodes
├── <cs-chat>                  # Right secondary sidebar (320px, toggleable)
│   ├── Context indicator      # "Viewing: analyzer/index.mjs"
│   ├── Message thread         # SSE streaming, markdown rendering
│   └── Input area             # Textarea with send button
└── <cs-status-bar>            # Bottom bar
    ├── Module/file/symbol counts
    └── Keyboard shortcut hints
```

### State Management

Replace the global `state` object with a lightweight reactive store using Lit's context protocol:

```
AppState {
  currentLevel: 'modules' | 'subdirs' | 'files' | 'symbols'
  currentModule: string | null
  currentFile: FileInfo | null
  currentSubdir: string | null
  sidebarTab: 'explorer' | 'search' | 'tours'
  chatOpen: boolean
  sidebarCollapsed: boolean
  DATA: CodebaseData
}
```

Components subscribe to the slices they need. State changes propagate reactively — no manual DOM updates.

### File Structure

```
web/
├── index.html                 # Shell: loads Lit, Cytoscape, data.js, registers components
├── src/
│   ├── app.js                 # <cs-app> root component
│   ├── store.js               # Reactive state store
│   ├── theme.js               # Catppuccin Mocha CSS custom properties
│   ├── components/
│   │   ├── activity-bar.js    # <cs-activity-bar>
│   │   ├── sidebar.js         # <cs-sidebar> with tab switching
│   │   ├── breadcrumb.js      # <cs-breadcrumb>
│   │   ├── graph.js           # <cs-graph> Cytoscape wrapper
│   │   ├── chat.js            # <cs-chat> secondary sidebar
│   │   └── status-bar.js      # <cs-status-bar>
│   ├── panels/
│   │   ├── explorer.js        # Explorer sidebar content
│   │   ├── search.js          # Search sidebar content
│   │   └── tours.js           # Tours sidebar content
│   └── utils/
│       ├── colors.js          # Module/symbol color assignment
│       ├── html.js            # escHtml, escJs helpers
│       └── graph-styles.js    # Cytoscape style definitions
├── js/                        # (legacy, removed after migration)
└── data.js                    # Generated analysis output (unchanged)
```

## Color Theme — Catppuccin Mocha

All colors defined as CSS custom properties in `theme.js`:

```css
--ctp-base: #1e1e2e;        /* Main background */
--ctp-mantle: #181825;       /* Activity bar, status bar */
--ctp-crust: #11111b;        /* Graph background */
--ctp-surface0: #313244;     /* Borders, dividers */
--ctp-surface1: #45475a;     /* Inactive icons, subtle backgrounds */
--ctp-overlay0: #6c7086;     /* Placeholder text, muted labels */
--ctp-subtext0: #a6adc8;     /* Section headers, secondary text */
--ctp-text: #cdd6f4;         /* Primary text */
--ctp-blue: #89b4fa;         /* Functions, primary accent, active items */
--ctp-mauve: #cba6f7;        /* Classes, chat accent */
--ctp-green: #a6e3a1;        /* Types, interfaces */
--ctp-yellow: #f9e2af;       /* Constants */
--ctp-pink: #f38ba8;         /* Enums */
--ctp-peach: #fab387;        /* Warnings, entry point badges */
--ctp-lavender: #b4befe;     /* Hover states, highlights */
```

## Graph Nodes — Info Cards

### Module Nodes
- Card with rounded corners (8px radius), `--ctp-base` background, `--ctp-surface0` border
- Header row: colored icon square (14px, module's assigned color) + module name (semibold)
- Stats line: "12 files · 4.2k lines" in `--ctp-overlay0`
- Symbol badges row: `5 fn` (blue bg), `2 cls` (mauve bg) — compact, pill-shaped
- Size scales with log(lineCount), min 120px, max 200px width
- On hover: border brightens to `--ctp-lavender`, subtle shadow glow

### File Nodes
- Smaller card (min 100px width)
- Header: language indicator (TS/JS/PY in accent color) + filename
- Subtitle: line count and export count
- Entry point files get a peach diamond indicator
- Key files (high import count) get a subtle glow

### Symbol Nodes
- Compact pill shape with monospace font
- Colored left border by kind (blue=function, mauve=class, green=type, yellow=const)
- Name only, kind inferred from color

### Edges
- Curved bezier style (unchanged)
- Default: low opacity (0.2), module's assigned color
- On connected node hover: opacity increases to 0.8, color shifts to `--ctp-blue`
- Width mapped to import weight (log scale)
- Arrow heads: triangle, scaled to edge width

## Layout Details

### Activity Bar (48px, left)
- Dark background (`--ctp-mantle`)
- Icon buttons: 24x24, rounded 4px, `--ctp-surface1` default, `--ctp-text` when active
- Active indicator: 2px left border in `--ctp-blue`
- Icons top-aligned except settings (bottom-aligned)
- Tabs: Explorer (default), Search, Tours — top-aligned. Chat and Settings — bottom-aligned.

### Sidebar (280px, collapsible)
- Background: `--ctp-base`
- Right border: 1px `--ctp-surface0`
- Collapsible via activity bar double-click or keyboard shortcut (Ctrl+B)
- Smooth width transition (200ms ease)
- Content switches based on active tab:
  - **Explorer**: Module list sorted by size, stats cards, key files, entry points, guided tours
  - **Search**: Search input with results grouped by type (files, symbols, modules)
  - **Tours**: Tour list with step navigation, descriptions

### Graph Area (flex, center)
- Background: `--ctp-crust` with subtle dot grid pattern
- Breadcrumb bar at top inside graph area
- Full Cytoscape.js instance, unchanged API
- Idea layer (top 25%) preserved when idea structure exists, hidden otherwise

### Chat — Right Secondary Sidebar (320px)
- Slides in from right with 200ms ease transition
- Left border: 1px `--ctp-mauve` (subtle accent to distinguish from left sidebar)
- Header: "Chat" title + close button (X)
- Context bar: shows current navigation state ("Viewing: analyzer/index.mjs")
- Message thread: user messages in `--ctp-surface0` bubbles, assistant in bordered cards
- Input: textarea at bottom, send on Enter (Shift+Enter for newline)
- Toggle: Ctrl+/ keyboard shortcut, or a chat icon in the activity bar (bottom, above settings)
- Preserves current SSE streaming implementation

### Status Bar (24px, bottom)
- Background: `--ctp-mantle`
- Top border: 1px `--ctp-surface0`
- Left: module count, file count, symbol count
- Right: keyboard shortcut hints ("Ctrl+/ Chat", "Ctrl+K Search")
- Font size: 11px, color: `--ctp-overlay0`

## Interactions

### Hover
- Node: border brightens, connected edges highlight, dimmed nodes at 15% opacity
- Tooltip: richer content — name, explanation preview (if LLM), stats, top exports

### Click / Drill-down
- Click module → animate layout transition to file view
- Click file → animate to symbol view
- Breadcrumb updates with each drill level
- Cytoscape `cose` layout with 400ms animation (current behavior preserved)
- Sidebar explorer updates to show detail for selected item

### Keyboard
- `Arrow keys`: navigate between nodes (focus ring)
- `Enter`: drill into focused node
- `Escape`: go back one level / close chat / close search
- `Ctrl+/`: toggle chat sidebar
- `Ctrl+K`: focus search
- `Ctrl+B`: toggle left sidebar
- `?`: show keyboard shortcut overlay

## Migration Strategy

The rewrite replaces the existing `web/js/` directory. The approach:

1. Set up Lit (via CDN or npm, no build step needed for dev)
2. Create the shell (`<cs-app>`) with layout CSS
3. Port each panel one at a time: activity bar → sidebar → graph → chat → status bar
4. Port the Cytoscape integration (styles, event handlers, layout configs)
5. Port the data flow (module/file/symbol rendering, drill-down navigation)
6. Delete old `web/js/` files

### What Does NOT Change
- `data.js` loading pattern — still `window.CODEBASE_DATA`
- `serve.mjs` — no backend changes
- Analysis pipeline — no changes to `src/`
- Cytoscape.js library — same version, same API
- Chat SSE protocol — same `/api/chat` endpoint

## Verification

1. **Visual**: Open the UI, verify Catppuccin Mocha colors, VS Code layout structure
2. **Navigation**: Click through module → file → symbol drill-down, verify breadcrumb
3. **Graph**: Verify info-card nodes render with correct stats, hover highlights work
4. **Sidebar tabs**: Switch between Explorer, Search, Tours — verify content renders
5. **Chat**: Open/close right sidebar, send a message (requires running serve.mjs with LLM configured)
6. **Keyboard**: Test Ctrl+/, Ctrl+K, Ctrl+B, Escape, Enter navigation
7. **Responsiveness**: Resize browser window, verify layout adapts (sidebar collapse at narrow widths)
8. **Data compatibility**: Load existing `data.js` output, verify all data displays correctly
9. **Run against codesight itself**: `node analyze.mjs . && node serve.mjs` — verify it visualizes its own codebase correctly
