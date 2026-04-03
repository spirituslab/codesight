// web/src/panels/cs-tour-panel.js
// Tour list and step navigation — ported from web/js/tour.mjs
import { LitElement, html, css } from 'lit';
import { theme } from '../theme.js';
import { store } from '../store.js';

export class CsTourPanel extends LitElement {
  static styles = [theme, css`
    :host {
      display: block;
      font-family: var(--font-sans);
      color: var(--text-primary);
      font-size: var(--font-size-base);
    }

    .empty {
      color: var(--text-muted);
      font-size: var(--font-size-sm);
      text-align: center;
      padding: 24px 0;
    }

    /* Tour list (no active tour) */
    .section-title {
      font-size: var(--font-size-xs);
      text-transform: uppercase;
      letter-spacing: 0.8px;
      color: var(--text-muted);
      font-weight: 600;
      margin: 0 0 8px;
    }

    .tour-card {
      padding: 10px 12px;
      background: var(--ctp-surface0);
      border-radius: var(--radius-md);
      cursor: pointer;
      margin-bottom: 6px;
      transition: background 0.15s;
    }
    .tour-card:hover { background: var(--ctp-surface1); }
    .tour-title { font-weight: 600; font-size: var(--font-size-sm); }
    .tour-meta { font-size: 10px; color: var(--text-muted); margin-top: 2px; }

    /* Active tour view */
    .tour-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 8px;
    }
    .tour-header h2 {
      margin: 0;
      font-size: var(--font-size-lg);
      font-weight: 600;
    }
    .exit-link {
      color: var(--text-muted);
      font-size: var(--font-size-sm);
      cursor: pointer;
      text-decoration: none;
      background: none;
      border: none;
      padding: 0;
      font-family: var(--font-sans);
    }
    .exit-link:hover { color: var(--text-secondary); text-decoration: underline; }

    .tour-desc {
      font-size: var(--font-size-sm);
      color: var(--text-secondary);
      margin-bottom: 12px;
      line-height: 1.5;
    }

    .steps-header {
      font-size: var(--font-size-xs);
      text-transform: uppercase;
      letter-spacing: 0.8px;
      color: var(--text-muted);
      font-weight: 600;
      margin: 0 0 6px;
    }

    .tour-step {
      padding: 8px 10px;
      border-radius: var(--radius-sm);
      cursor: pointer;
      margin-bottom: 4px;
      border-left: 2px solid transparent;
      transition: background 0.12s;
    }
    .tour-step:hover { background: var(--ctp-surface0); }
    .tour-step.active {
      background: var(--ctp-surface0);
      border-left-color: var(--accent);
    }

    .step-num {
      font-size: 10px;
      color: var(--text-muted);
      margin-bottom: 2px;
    }
    .step-sym {
      font-size: var(--font-size-sm);
      color: var(--text-primary);
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .step-file {
      font-size: 10px;
      color: var(--text-muted);
      margin-top: 2px;
      font-family: var(--font-mono);
    }
    .step-explain {
      font-size: var(--font-size-sm);
      color: var(--text-secondary);
      margin-top: 6px;
      line-height: 1.5;
      padding-top: 6px;
      border-top: 1px solid var(--border);
    }

    .kind {
      display: inline-block;
      font-size: 9px;
      padding: 1px 5px;
      border-radius: 3px;
      font-weight: 600;
      color: var(--ctp-crust);
      flex-shrink: 0;
    }
    .kind-function, .kind-method { background: var(--ctp-blue); }
    .kind-class, .kind-struct { background: var(--ctp-mauve); }
    .kind-type { background: var(--ctp-green); }
    .kind-interface, .kind-trait { background: var(--ctp-teal); }
    .kind-const { background: var(--ctp-yellow); }
    .kind-enum { background: var(--ctp-red); }

    .tour-nav {
      display: flex;
      gap: 8px;
      margin-top: 14px;
    }
    .tour-nav button {
      flex: 1;
      padding: 7px 0;
      background: var(--ctp-surface0);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      color: var(--text-primary);
      font-size: var(--font-size-sm);
      font-family: var(--font-sans);
      cursor: pointer;
      transition: background 0.12s;
    }
    .tour-nav button:hover:not(:disabled) { background: var(--ctp-surface1); }
    .tour-nav button:disabled {
      opacity: 0.4;
      cursor: default;
    }
  `];

  static properties = {
    _data: { state: true },
    _activeTour: { state: true },
    _activeTourStep: { state: true },
  };

  constructor() {
    super();
    this._data = null;
    this._activeTour = null;
    this._activeTourStep = 0;

    store.addEventListener('state-changed', () => {
      const s = store.state;
      this._data = s.DATA;
      this._activeTour = s.activeTour;
      this._activeTourStep = s.activeTourStep;
    });
  }

  connectedCallback() {
    super.connectedCallback();
    const s = store.state;
    this._data = s.DATA;
    this._activeTour = s.activeTour;
    this._activeTourStep = s.activeTourStep;
  }

  _startTour(tourId) {
    this.dispatchEvent(new CustomEvent('start-tour', {
      detail: { tourId },
      bubbles: true, composed: true,
    }));
  }

  _navigateStep(stepIndex) {
    this.dispatchEvent(new CustomEvent('navigate-tour-step', {
      detail: { stepIndex },
      bubbles: true, composed: true,
    }));
  }

  _exitTour(e) {
    e.preventDefault();
    this.dispatchEvent(new CustomEvent('exit-tour', {
      bubbles: true, composed: true,
    }));
  }

  _renderTourList() {
    const tours = this._data?.tours;
    if (!tours || tours.length === 0) {
      return html`<div class="empty">No tours available for this project.</div>`;
    }
    return html`
      <div class="section-title">Available Tours</div>
      ${tours.map(t => html`
        <div class="tour-card" @click=${() => this._startTour(t.id)}>
          <div class="tour-title">${t.title}</div>
          <div class="tour-meta">
            ${(t.steps || []).length} step${(t.steps || []).length !== 1 ? 's' : ''}
            ${t.description ? html` &middot; ${t.description}` : ''}
          </div>
        </div>
      `)}
    `;
  }

  _renderActiveTour() {
    const tour = this._activeTour;
    const step = this._activeTourStep;
    const steps = tour.steps || [];

    return html`
      <div class="tour-header">
        <h2>${tour.title}</h2>
        <button class="exit-link" @click=${this._exitTour}>Exit tour</button>
      </div>
      ${tour.description ? html`<div class="tour-desc">${tour.description}</div>` : ''}
      <div class="steps-header">Steps (${step + 1} of ${steps.length})</div>

      ${steps.map((s, i) => {
        const isActive = i === step;
        return html`
          <div class="tour-step ${isActive ? 'active' : ''}" @click=${() => this._navigateStep(i)}>
            <div class="step-num">Step ${i + 1}</div>
            <div class="step-sym">
              <span class="kind kind-${s.kind || 'function'}">${s.kind || 'fn'}</span>
              ${s.symbol}
            </div>
            <div class="step-file">${s.file} : ${s.line}</div>
            ${isActive && s.explanation ? html`
              <div class="step-explain">${s.explanation}</div>
            ` : ''}
          </div>
        `;
      })}

      <div class="tour-nav">
        <button
          @click=${() => this._navigateStep(step - 1)}
          ?disabled=${step <= 0}
        >&#8592; Previous</button>
        <button
          @click=${() => this._navigateStep(step + 1)}
          ?disabled=${step >= steps.length - 1}
        >Next &#8594;</button>
      </div>
    `;
  }

  render() {
    if (this._activeTour) return this._renderActiveTour();
    return this._renderTourList();
  }
}
customElements.define('cs-tour-panel', CsTourPanel);
