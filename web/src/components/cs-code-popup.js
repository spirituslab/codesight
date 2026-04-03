// web/src/components/cs-code-popup.js
import { LitElement, html, css } from 'lit';
import { theme } from '../theme.js';
import { escHtml } from '../utils/helpers.js';

export class CsCodePopup extends LitElement {
  static styles = [theme, css`
    :host { display: none; position: fixed; inset: 0; z-index: 100; }
    :host(.open) { display: block; }
    .overlay {
      position: absolute; inset: 0;
      background: rgba(0,0,0,0.5); backdrop-filter: blur(2px);
    }
    .popup {
      position: absolute; top: 50%; left: 50%;
      transform: translate(-50%, -50%);
      width: 720px; max-width: 90vw; max-height: 80vh;
      background: var(--bg-graph); border: 1px solid var(--border);
      border-radius: var(--radius-xl); overflow: hidden;
      box-shadow: 0 20px 60px rgba(0,0,0,0.6);
    }
    .header {
      display: flex; justify-content: space-between; align-items: center;
      padding: 12px 18px; background: var(--bg-primary);
      border-bottom: 1px solid var(--border);
    }
    .title { font-weight: 600; color: var(--text-primary); font-size: 14px; }
    .meta { font-size: var(--font-size-sm); color: var(--text-muted); }
    .close-btn {
      background: none; border: 1px solid var(--border);
      border-radius: var(--radius-md); color: var(--text-muted);
      padding: 3px 10px; cursor: pointer; font-size: 12px;
      transition: all 0.15s;
    }
    .close-btn:hover { color: var(--text-primary); border-color: var(--ctp-surface2); }
    .body {
      padding: 16px 0; max-height: calc(80vh - 52px); overflow-y: auto;
    }
    .body::-webkit-scrollbar { width: 8px; }
    .body::-webkit-scrollbar-thumb { background: var(--ctp-surface1); border-radius: 4px; }
    pre {
      margin: 0; padding: 0 18px;
      font-family: var(--font-mono);
      font-size: 12.5px; line-height: 1.6;
      color: var(--text-primary); white-space: pre; tab-size: 2;
    }
    .line-num {
      display: inline-block; width: 40px; text-align: right;
      padding-right: 16px; color: var(--ctp-surface2);
      user-select: none; font-size: var(--font-size-sm);
    }
  `];

  static properties = {
    symbol: { type: Object },
    filePath: { type: String },
  };

  constructor() {
    super();
    this.symbol = null;
    this.filePath = '';
  }

  open(sym, filePath) {
    this.symbol = sym;
    this.filePath = filePath;
    this.classList.add('open');
  }

  close() {
    this.classList.remove('open');
    this.symbol = null;
  }

  _onOverlayClick(e) {
    if (e.target === e.currentTarget) this.close();
  }

  render() {
    if (!this.symbol?.source) return html``;
    const lines = this.symbol.source.split('\n');
    const startLine = this.symbol.line;

    return html`
      <div class="overlay" @click=${this._onOverlayClick}>
        <div class="popup">
          <div class="header">
            <div>
              <div class="title">${this.symbol.name}</div>
              <div class="meta">${this.filePath} : line ${startLine}${this.symbol.returnType ? html` &rarr; ${this.symbol.returnType}` : ''}</div>
            </div>
            <button class="close-btn" @click=${() => this.close()}>Esc</button>
          </div>
          <div class="body">
            <pre>${lines.map((line, i) => {
              const safeContent = document.createElement('span');
              safeContent.textContent = line;
              return html`<span class="line-num">${startLine + i}</span>${safeContent.innerHTML}\n`;
            })}</pre>
          </div>
        </div>
      </div>
    `;
  }
}
customElements.define('cs-code-popup', CsCodePopup);
