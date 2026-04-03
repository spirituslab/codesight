// Chat panel — sends messages to /api/chat with current view context

import { state } from './state.mjs';

let history = [];
let sending = false;

export function initChat() {
  const toggle = document.getElementById('chat-toggle');
  const panel = document.getElementById('chat-panel');
  const closeBtn = document.getElementById('chat-close');
  const input = document.getElementById('chat-input');
  const sendBtn = document.getElementById('chat-send');

  toggle.addEventListener('click', () => {
    panel.classList.toggle('open');
    if (panel.classList.contains('open')) {
      input.focus();
      updateChatContext();
    }
  });

  closeBtn.addEventListener('click', () => {
    panel.classList.remove('open');
  });

  sendBtn.addEventListener('click', sendMessage);

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });

  // Auto-resize textarea
  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 80) + 'px';
  });

  // Ctrl+/ to toggle chat
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === '/') {
      e.preventDefault();
      toggle.click();
    }
  });
}

export function updateChatContext() {
  const ctx = document.getElementById('chat-context');
  if (!ctx) return;

  if (state.currentLevel === 'symbols' && state.currentFile) {
    ctx.textContent = `Viewing: ${state.currentFile.name}`;
  } else if (state.currentLevel === 'files' && state.currentModule) {
    ctx.textContent = `Viewing: ${state.currentModule} (files)`;
  } else if (state.currentModule) {
    ctx.textContent = `Viewing: ${state.currentModule}`;
  } else {
    ctx.textContent = 'Viewing: project overview';
  }
}

async function sendMessage() {
  if (sending) return;

  const input = document.getElementById('chat-input');
  const message = input.value.trim();
  if (!message) return;

  input.value = '';
  input.style.height = 'auto';

  // Add user message to UI
  appendMessage('user', message);

  // Build context from current view state
  const context = {
    currentLevel: state.currentLevel,
    currentModule: state.currentModule,
    currentFile: state.currentFile?.path || null,
    currentSymbol: null,
  };

  sending = true;
  document.getElementById('chat-send').disabled = true;

  // Create assistant message placeholder
  const msgEl = appendMessage('assistant', '');

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, context, history: history.slice(-10) }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Server error' }));
      msgEl.textContent = err.error || 'Failed to get response';
      msgEl.className = 'chat-msg error';
      return;
    }

    // Read SSE stream
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let fullText = '';
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
            fullText += data.text;
            msgEl.textContent = fullText;
            scrollToBottom();
          } else if (data.error) {
            msgEl.textContent = fullText + '\n[Error: ' + data.error + ']';
          }
        } catch {}
      }
    }

    // Save to history
    history.push({ role: 'user', content: message });
    history.push({ role: 'assistant', content: fullText });

  } catch (err) {
    msgEl.textContent = 'Connection error: ' + err.message;
    msgEl.className = 'chat-msg error';
  } finally {
    sending = false;
    document.getElementById('chat-send').disabled = false;
  }
}

function appendMessage(role, text) {
  const container = document.getElementById('chat-messages');
  const el = document.createElement('div');
  el.className = `chat-msg ${role}`;
  el.textContent = text;
  container.appendChild(el);
  scrollToBottom();
  return el;
}

function scrollToBottom() {
  const container = document.getElementById('chat-messages');
  container.scrollTop = container.scrollHeight;
}
