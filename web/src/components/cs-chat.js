// cs-chat.js — Chat panel for asking questions about code/idea nodes
// Routes through VS Code extension's vscode.lm API (Copilot, etc.)
import { LitElement, html, css } from 'lit';
import { theme } from '../theme.js';
import { store } from '../store.js';

export class CsChat extends LitElement {
  static styles = [theme, css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      background: var(--bg-primary);
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 10px 14px;
      border-bottom: 1px solid var(--border);
      flex-shrink: 0;
    }
    .title {
      font-size: var(--font-size-base);
      font-weight: 600;
      color: var(--accent-secondary);
    }
    .close-btn {
      background: none; border: none; color: var(--text-muted);
      cursor: pointer; font-size: 18px; padding: 2px 6px;
      border-radius: var(--radius-sm); transition: all 0.15s;
    }
    .close-btn:hover { color: var(--text-primary); background: rgba(255,255,255,0.05); }
    .context {
      padding: 6px 14px;
      font-size: var(--font-size-xs);
      color: var(--text-muted);
      background: var(--bg-secondary);
      border-bottom: 1px solid var(--border);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .idea-context {
      padding: 8px 14px;
      font-size: var(--font-size-sm);
      color: var(--ctp-lavender);
      background: rgba(137,180,250,0.08);
      border-bottom: 1px solid var(--border);
      line-height: 1.5;
    }
    .idea-context .label { font-weight: 600; color: var(--ctp-mauve); }
    .idea-context .desc { color: var(--text-secondary); margin-top: 2px; }
    .idea-context .refs { color: var(--text-muted); font-size: var(--font-size-xs); margin-top: 4px; }
    .messages {
      flex: 1; overflow-y: auto; padding: 12px 14px; min-height: 200px;
    }
    .messages::-webkit-scrollbar { width: 4px; }
    .messages::-webkit-scrollbar-thumb { background: var(--ctp-surface1); border-radius: 2px; }
    .msg { margin-bottom: 12px; font-size: var(--font-size-base); line-height: 1.6; }
    .msg.user { color: var(--text-primary); }
    .msg.assistant { color: var(--text-secondary); white-space: pre-wrap; }
    .msg.error { color: var(--ctp-red); font-size: var(--font-size-sm); }
    .model-tag {
      display: inline-block;
      font-size: 10px;
      color: var(--ctp-overlay0, #6c7086);
      background: var(--ctp-surface0, #313244);
      padding: 1px 6px;
      border-radius: 3px;
      margin-bottom: 4px;
      font-weight: 500;
    }
    .msg.pending { color: var(--text-muted); font-style: italic; }
    .input-area {
      display: flex; gap: 8px; padding: 12px 14px;
      border-top: 1px solid var(--border);
    }
    textarea {
      flex: 1; padding: 8px 12px; border: 1px solid var(--border);
      border-radius: var(--radius-md); background: var(--bg-graph);
      color: var(--text-primary); font-size: var(--font-size-base);
      outline: none; resize: none; font-family: var(--font-sans);
      min-height: 36px; max-height: 80px;
    }
    textarea:focus { border-color: var(--accent); }
    textarea::placeholder { color: var(--text-muted); }
    button.send {
      padding: 8px 16px; border: 1px solid var(--border);
      border-radius: var(--radius-md); background: var(--ctp-surface0);
      color: var(--accent); font-size: var(--font-size-base);
      cursor: pointer; font-weight: 600; transition: all 0.15s;
      align-self: flex-end;
    }
    button.send:hover { background: var(--ctp-surface1); }
    button.send:disabled { opacity: 0.4; cursor: not-allowed; }
  `];

  static properties = {
    _messages: { state: true },
    _sending: { state: true },
    _context: { state: true },
    _ideaNode: { state: true },
    _focusedNode: { state: true },
  };

  constructor() {
    super();
    this._messages = [];
    this._sending = false;
    this._history = [];
    this._ideaNode = null;
    this._focusedNode = null;
    this._updateContext();
    this._boundStoreHandler = this._onStoreChanged.bind(this);
  }

  connectedCallback() {
    super.connectedCallback();
    store.addEventListener('state-changed', this._boundStoreHandler);
    this._updateContext();

    // Listen for chat responses from extension
    this._messageHandler = (event) => {
      const msg = event.data;
      if (msg.type === 'chatResponse') {
        this._handleChatResponse(msg);
      }
    };
    window.addEventListener('message', this._messageHandler);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    store.removeEventListener('state-changed', this._boundStoreHandler);
    if (this._messageHandler) {
      window.removeEventListener('message', this._messageHandler);
    }
  }

  _onStoreChanged(e) {
    const { key, keys } = e.detail || {};
    const changed = keys || [key];
    this._updateContext();

    if (changed.includes('activeIdeaNode')) {
      this._updateIdeaContext();
    }
  }

  _updateContext() {
    const s = store.state;
    if (s.currentLevel === 'symbols' && s.currentFile) {
      this._context = `Viewing: ${s.currentFile.name}`;
    } else if (s.currentLevel === 'files' && s.currentModule) {
      this._context = `Viewing: ${s.currentModule} (files)`;
    } else if (s.currentModule) {
      this._context = `Viewing: ${s.currentModule}`;
    } else {
      this._context = 'Viewing: project overview';
    }
  }

  _updateIdeaContext() {
    const nodeId = store.state.activeIdeaNode;
    const idea = store.state.DATA?.ideaStructure;
    if (!nodeId || !idea) {
      this._ideaNode = null;
      return;
    }
    const node = idea.nodes.find(n => n.id === nodeId);
    this._ideaNode = node || null;
  }

  setIdeaContext(node) {
    this._ideaNode = node;
    this._focusedNode = null;
    store.set('chatOpen', true);
  }

  setCodeContext(type, data) {
    this._focusedNode = { type, data };
    this._ideaNode = null;
    store.set('chatOpen', true);
  }

  async _send() {
    if (this._sending) return;
    const textarea = this.renderRoot.querySelector('textarea');
    const message = textarea.value.trim();
    if (!message) return;

    textarea.value = '';
    textarea.style.height = 'auto';
    this._messages = [...this._messages, { role: 'user', text: message }];
    this._sending = true;

    const context = {
      currentLevel: store.state.currentLevel,
      currentModule: store.state.currentModule,
      currentFile: store.state.currentFile?.path || null,
      ideaNode: this._ideaNode ? {
        label: this._ideaNode.label,
        description: this._ideaNode.description,
        codeRefs: this._ideaNode.codeRefs,
      } : null,
      focusedNode: this._focusedNode || null,
    };

    const assistantMsg = { role: 'pending', text: 'Waiting for response...' };
    this._messages = [...this._messages, assistantMsg];
    this._scrollToBottom();

    window.__CODESIGHT_VSCODE__.postMessage({
      type: 'chatRequest',
      message,
      context,
      history: this._history.slice(-10),
    });
  }

  _handleChatResponse(msg) {
    this._messages = this._messages.filter(m => m.role !== 'pending');

    if (msg.error) {
      this._messages = [...this._messages, { role: 'error', text: msg.error }];
    } else {
      this._messages = [...this._messages, { role: 'assistant', text: msg.text, model: msg.model || null }];
      this._history.push({ role: 'user', content: msg.originalMessage || '' });
      this._history.push({ role: 'assistant', content: msg.text });
    }
    this._sending = false;
    this._scrollToBottom();
  }

  _scrollToBottom() {
    const msgs = this.renderRoot.querySelector('.messages');
    if (msgs) requestAnimationFrame(() => { msgs.scrollTop = msgs.scrollHeight; });
  }

  _onKeydown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      this._send();
    }
  }

  _onInput(e) {
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 80) + 'px';
  }

  render() {
    return html`
      <div class="header">
        <span class="title">Chat</span>
        <button class="close-btn" @click=${() => store.set('chatOpen', false)}>&times;</button>
      </div>
      <div class="context">${this._context}</div>
      ${this._ideaNode ? html`
        <div class="idea-context">
          <div class="label">${this._ideaNode.label}</div>
          <div class="desc">${this._ideaNode.description}</div>
          ${this._ideaNode.codeRefs?.length ? html`
            <div class="refs">Code: ${this._ideaNode.codeRefs.map(r =>
              r.type === 'module' ? r.name : r.path
            ).join(', ')}</div>
          ` : ''}
        </div>
      ` : this._focusedNode ? html`
        <div class="idea-context">
          <div class="label">${this._focusedNode.type}: ${this._focusedNode.data?.name || this._focusedNode.data?.path || ''}</div>
          ${this._focusedNode.data?.description ? html`<div class="desc">${this._focusedNode.data.description}</div>` : ''}
          ${this._focusedNode.data?.signature ? html`<div class="refs">${this._focusedNode.data.signature}</div>` : ''}
          ${this._focusedNode.type === 'module' ? html`<div class="refs">${this._focusedNode.data?.files?.length || 0} files, ${this._focusedNode.data?.lineCount || 0} lines</div>` : ''}
        </div>
      ` : ''}
      <div class="messages">
        ${this._messages.map(m => html`
          <div class="msg ${m.role}">
            ${m.role === 'user' ? html`<strong style="color:var(--accent)">You: </strong>` : ''}
            ${m.role === 'assistant' && m.model ? html`<span class="model-tag">${m.model}</span><br>` : ''}
            ${m.role === 'assistant' && !m.model ? html`<strong style="color:var(--ctp-green)">AI: </strong>` : ''}
            ${m.text}
          </div>
        `)}
      </div>
      <div class="input-area">
        <textarea placeholder="${this._ideaNode
          ? `Ask about "${this._ideaNode.label}"...`
          : this._focusedNode
            ? `Ask about ${this._focusedNode.data?.name || this._focusedNode.type}...`
            : 'Ask about this code...'}" rows="1"
          @keydown=${this._onKeydown} @input=${this._onInput}></textarea>
        <button class="send" @click=${this._send} ?disabled=${this._sending}>Send</button>
      </div>
    `;
  }
}
customElements.define('cs-chat', CsChat);
