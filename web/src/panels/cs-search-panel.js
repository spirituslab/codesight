// web/src/panels/cs-search-panel.js
import { LitElement, html, css } from 'lit';
import { theme } from '../theme.js';

export class CsSearchPanel extends LitElement {
  static styles = [theme, css`
    :host { display: block; }
    input {
      width: 100%; padding: 8px 12px;
      border: 1px solid var(--border); border-radius: var(--radius-md);
      background: var(--bg-graph); color: var(--text-primary);
      font-size: var(--font-size-base); outline: none;
      margin-bottom: 12px;
      box-sizing: border-box;
    }
    input:focus { border-color: var(--accent); }
    input::placeholder { color: var(--text-muted); }
    .hint { font-size: var(--font-size-sm); color: var(--text-muted); margin-bottom: 8px; }
    .shortcut { margin-top: 12px; font-size: var(--font-size-sm); color: var(--text-muted); }
    kbd {
      background: var(--ctp-surface0); padding: 1px 5px;
      border-radius: 2px; font-size: var(--font-size-xs); font-family: var(--font-mono);
    }
  `];

  _onInput(e) {
    this.dispatchEvent(new CustomEvent('filter-graph', {
      detail: { query: e.target.value.toLowerCase().trim() },
      bubbles: true, composed: true,
    }));
  }

  render() {
    return html`
      <div class="hint">Filter visible nodes</div>
      <input type="text" placeholder="Type to filter..." @input=${this._onInput}>
      <div class="shortcut"><kbd>Ctrl+K</kbd> for full project search</div>
    `;
  }
}
customElements.define('cs-search-panel', CsSearchPanel);
