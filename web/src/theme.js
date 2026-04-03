// web/src/theme.js
// Catppuccin Mocha palette as a Lit CSSResult for sharing across components

import { css } from 'lit';

export const theme = css`
  :host {
    /* Catppuccin Mocha */
    --ctp-crust: #11111b;
    --ctp-mantle: #181825;
    --ctp-base: #1e1e2e;
    --ctp-surface0: #313244;
    --ctp-surface1: #45475a;
    --ctp-surface2: #585b70;
    --ctp-overlay0: #6c7086;
    --ctp-overlay1: #7f849c;
    --ctp-subtext0: #a6adc8;
    --ctp-text: #cdd6f4;
    --ctp-lavender: #b4befe;
    --ctp-blue: #89b4fa;
    --ctp-sapphire: #74c7ec;
    --ctp-sky: #89dceb;
    --ctp-teal: #94e2d5;
    --ctp-green: #a6e3a1;
    --ctp-yellow: #f9e2af;
    --ctp-peach: #fab387;
    --ctp-maroon: #eba0ac;
    --ctp-red: #f38ba8;
    --ctp-mauve: #cba6f7;
    --ctp-pink: #f5c2e7;
    --ctp-flamingo: #f2cdcd;
    --ctp-rosewater: #f5e0dc;

    /* Semantic aliases */
    --bg-primary: var(--ctp-base);
    --bg-secondary: var(--ctp-mantle);
    --bg-graph: var(--ctp-crust);
    --border: var(--ctp-surface0);
    --text-primary: var(--ctp-text);
    --text-secondary: var(--ctp-subtext0);
    --text-muted: var(--ctp-overlay0);
    --accent: var(--ctp-blue);
    --accent-secondary: var(--ctp-mauve);

    /* Typography */
    --font-sans: 'Segoe UI', -apple-system, BlinkMacSystemFont, sans-serif;
    --font-mono: 'JetBrains Mono', 'Fira Code', 'Consolas', monospace;
    --font-size-xs: 9px;
    --font-size-sm: 11px;
    --font-size-base: 13px;
    --font-size-lg: 15px;

    /* Spacing */
    --radius-sm: 4px;
    --radius-md: 6px;
    --radius-lg: 8px;
    --radius-xl: 12px;
  }
`;
