// web/src/components/cs-global-search.js
// Global search modal — Ctrl+K — ported from web/js/search.mjs lines 34-107
import { LitElement, html, css } from 'lit';
import { theme } from '../theme.js';
import { store } from '../store.js';
import { getColor } from '../utils/colors.js';

export class CsGlobalSearch extends LitElement {
  static styles = [theme, css`
    :host { display: none; }
    :host(.open) { display: block; }

    .overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.6);
      z-index: 1000;
      display: flex;
      align-items: flex-start;
      justify-content: center;
      padding-top: 80px;
    }

    .modal {
      width: 600px;
      max-width: 90vw;
      background: var(--ctp-mantle);
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      box-shadow: 0 24px 64px rgba(0, 0, 0, 0.5);
      overflow: hidden;
    }

    .search-input-wrap {
      display: flex;
      align-items: center;
      padding: 0 16px;
      border-bottom: 1px solid var(--border);
      gap: 10px;
    }

    .search-icon {
      color: var(--text-muted);
      font-size: 16px;
      flex-shrink: 0;
    }

    input {
      flex: 1;
      padding: 14px 0;
      background: transparent;
      border: none;
      outline: none;
      color: var(--text-primary);
      font-size: var(--font-size-base);
      font-family: var(--font-sans);
    }
    input::placeholder { color: var(--text-muted); }

    .esc-hint {
      font-size: var(--font-size-xs);
      color: var(--text-muted);
      background: var(--ctp-surface0);
      padding: 2px 6px;
      border-radius: 3px;
      font-family: var(--font-mono);
      flex-shrink: 0;
    }

    .results {
      max-height: 420px;
      overflow-y: auto;
      padding: 8px 0;
    }

    .results::-webkit-scrollbar { width: 4px; }
    .results::-webkit-scrollbar-track { background: transparent; }
    .results::-webkit-scrollbar-thumb { background: var(--ctp-surface1); border-radius: 2px; }

    .section-title {
      font-size: var(--font-size-xs);
      text-transform: uppercase;
      letter-spacing: 0.8px;
      color: var(--text-muted);
      font-weight: 600;
      padding: 8px 16px 4px;
    }

    .result-item {
      padding: 8px 16px;
      cursor: pointer;
      transition: background 0.12s;
    }
    .result-item:hover { background: var(--ctp-surface0); }

    .result-name {
      font-size: var(--font-size-base);
      color: var(--text-primary);
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .result-path {
      font-size: var(--font-size-sm);
      color: var(--text-muted);
      margin-top: 2px;
    }

    .badge {
      display: inline-block;
      font-size: 9px;
      padding: 1px 5px;
      border-radius: 3px;
      font-weight: 600;
      vertical-align: middle;
    }
    .badge-entry { background: var(--ctp-green); color: var(--ctp-crust); }
    .badge-hot { background: var(--ctp-peach); color: var(--ctp-crust); }

    .kind {
      display: inline-block;
      font-size: 9px;
      padding: 1px 5px;
      border-radius: 3px;
      font-weight: 600;
      color: var(--ctp-crust);
    }
    .kind-function, .kind-method { background: var(--ctp-blue); }
    .kind-class, .kind-struct { background: var(--ctp-mauve); }
    .kind-type { background: var(--ctp-green); }
    .kind-interface, .kind-trait { background: var(--ctp-teal); }
    .kind-const { background: var(--ctp-yellow); }
    .kind-enum { background: var(--ctp-red); }

    .module-dot {
      display: inline-block;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    .empty {
      padding: 24px 16px;
      text-align: center;
      color: var(--text-muted);
      font-size: var(--font-size-sm);
    }
  `];

  static properties = {
    _query: { state: true },
    _results: { state: true },
  };

  constructor() {
    super();
    this._query = '';
    this._results = { files: [], symbols: [], modules: [] };
    this._allFilesFlat = null;
    this._allSymbolsFlat = null;
    this._indexBuilt = false;
  }

  open() {
    this.classList.add('open');
    this._query = '';
    this._results = { files: [], symbols: [], modules: [] };
    this.updateComplete.then(() => {
      this.shadowRoot.querySelector('input')?.focus();
    });
    if (!this._indexBuilt) this._buildIndex();
  }

  close() {
    this.classList.remove('open');
  }

  _buildIndex() {
    const DATA = store.state.DATA;
    if (!DATA) return;
    const allFilesFlat = [
      ...(DATA.rootFiles || []),
      ...(DATA.modules || []).flatMap(m => m.files),
    ];
    const allSymbolsFlat = [];
    for (const f of allFilesFlat) {
      const modName = DATA.modules?.find(m => m.files.includes(f))?.name || 'root';
      for (const s of (f.symbols || [])) {
        if (s.exported) allSymbolsFlat.push({ ...s, filePath: f.path, fileName: f.name, moduleName: modName });
      }
    }
    this._allFilesFlat = allFilesFlat;
    this._allSymbolsFlat = allSymbolsFlat;
    this._indexBuilt = true;
  }

  _onInput(e) {
    const q = e.target.value.toLowerCase().trim();
    this._query = q;
    if (!q) {
      this._results = { files: [], symbols: [], modules: [] };
      return;
    }
    const DATA = store.state.DATA;

    const files = (this._allFilesFlat || []).filter(f =>
      f.name.toLowerCase().includes(q) || f.path.toLowerCase().includes(q)
    ).slice(0, 10);

    const symbols = (this._allSymbolsFlat || []).filter(s =>
      s.name.toLowerCase().includes(q)
    ).slice(0, 15);

    const modules = (DATA?.modules || []).filter(m =>
      m.name.toLowerCase().includes(q) || (m.description || '').toLowerCase().includes(q)
    ).slice(0, 5);

    this._results = { files, symbols, modules };
  }

  _onKeydown(e) {
    if (e.key === 'Escape') this.close();
  }

  _onOverlayClick(e) {
    if (e.target === e.currentTarget) this.close();
  }

  _navigateToFile(path) {
    this.close();
    this.dispatchEvent(new CustomEvent('navigate-to-file', {
      detail: { path },
      bubbles: true, composed: true,
    }));
  }

  _navigateToModule(name) {
    this.close();
    this.dispatchEvent(new CustomEvent('navigate-to-module', {
      detail: { name },
      bubbles: true, composed: true,
    }));
  }

  _renderEmpty() {
    if (this._query) {
      return html`<div class="empty">No results for "${this._query}"</div>`;
    }
    return html`<div class="empty">Type to search files and symbols across the project</div>`;
  }

  render() {
    const { files, symbols, modules } = this._results;
    const hasResults = files.length > 0 || symbols.length > 0 || modules.length > 0;

    return html`
      <div class="overlay" @click=${this._onOverlayClick} @keydown=${this._onKeydown}>
        <div class="modal">
          <div class="search-input-wrap">
            <span class="search-icon">&#128269;</span>
            <input
              type="text"
              placeholder="Search files, symbols, modules..."
              .value=${this._query}
              @input=${this._onInput}
              @keydown=${this._onKeydown}
            >
            <span class="esc-hint">Esc</span>
          </div>
          <div class="results">
            ${!hasResults ? this._renderEmpty() : html`
              ${files.length > 0 ? html`
                <div class="section-title">Files</div>
                ${files.map(f => html`
                  <div class="result-item" @click=${() => this._navigateToFile(f.path)}>
                    <div class="result-name">
                      ${f.name}
                      ${f.isEntryPoint ? html`<span class="badge badge-entry">entry</span>` : ''}
                      ${f.importedByCount > 10 ? html`<span class="badge badge-hot">${f.importedByCount}x imported</span>` : ''}
                    </div>
                    <div class="result-path">${f.path} &middot; ${f.lineCount} lines, ${(f.symbols || []).length} symbols</div>
                  </div>
                `)}
              ` : ''}

              ${symbols.length > 0 ? html`
                <div class="section-title">Symbols</div>
                ${symbols.map(s => html`
                  <div class="result-item" @click=${() => this._navigateToFile(s.filePath)}>
                    <div class="result-name">
                      <span class="kind kind-${s.kind}">${s.kind}</span>
                      ${s.name}
                    </div>
                    <div class="result-path">${s.filePath} &middot; line ${s.line}</div>
                  </div>
                `)}
              ` : ''}

              ${modules.length > 0 ? html`
                <div class="section-title">Modules</div>
                ${modules.map(m => html`
                  <div class="result-item" @click=${() => this._navigateToModule(m.name)}>
                    <div class="result-name">
                      <span class="module-dot" style="background:${getColor(m.name)}"></span>
                      ${m.name}
                    </div>
                    <div class="result-path">${m.description || ''}</div>
                  </div>
                `)}
              ` : ''}
            `}
          </div>
        </div>
      </div>
    `;
  }
}
customElements.define('cs-global-search', CsGlobalSearch);
