// web/src/components/cs-chat.js
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
    .messages {
      flex: 1; overflow-y: auto; padding: 12px 14px; min-height: 200px;
    }
    .messages::-webkit-scrollbar { width: 4px; }
    .messages::-webkit-scrollbar-thumb { background: var(--ctp-surface1); border-radius: 2px; }
    .msg { margin-bottom: 12px; font-size: var(--font-size-base); line-height: 1.6; }
    .msg.user { color: var(--text-primary); }
    .msg.user::before { content: "You: "; font-weight: 600; color: var(--accent); }
    .msg.assistant { color: var(--text-secondary); }
    .msg.assistant::before { content: "AI: "; font-weight: 600; color: var(--ctp-green); }
    .msg.error { color: var(--ctp-red); font-size: var(--font-size-sm); }
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
  };

  constructor() {
    super();
    this._messages = [];
    this._sending = false;
    this._history = [];
    this._updateContext();
    this._boundStoreHandler = this._updateContext.bind(this);
  }

  connectedCallback() {
    super.connectedCallback();
    store.addEventListener('state-changed', this._boundStoreHandler);
    this._updateContext();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    store.removeEventListener('state-changed', this._boundStoreHandler);
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
    };

    const assistantMsg = { role: 'assistant', text: '' };
    this._messages = [...this._messages, assistantMsg];

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, context, history: this._history.slice(-10) }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Server error' }));
        assistantMsg.text = err.error || 'Failed to get response';
        assistantMsg.role = 'error';
        this._messages = [...this._messages];
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.text) {
              assistantMsg.text += data.text;
              this._messages = [...this._messages];
              this._scrollToBottom();
            }
          } catch {}
        }
      }

      this._history.push({ role: 'user', content: message });
      this._history.push({ role: 'assistant', content: assistantMsg.text });
    } catch (err) {
      assistantMsg.text = 'Connection error: ' + err.message;
      assistantMsg.role = 'error';
      this._messages = [...this._messages];
    } finally {
      this._sending = false;
    }
  }

  _scrollToBottom() {
    const msgs = this.renderRoot.querySelector('.messages');
    if (msgs) msgs.scrollTop = msgs.scrollHeight;
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
      <div class="messages">
        ${this._messages.map(m => html`<div class="msg ${m.role}">${m.text}</div>`)}
      </div>
      <div class="input-area">
        <textarea placeholder="Ask about this code..." rows="1"
          @keydown=${this._onKeydown} @input=${this._onInput}></textarea>
        <button class="send" @click=${this._send} ?disabled=${this._sending}>Send</button>
      </div>
    `;
  }
}
customElements.define('cs-chat', CsChat);
