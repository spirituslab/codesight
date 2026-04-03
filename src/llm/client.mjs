// Provider-agnostic LLM client using native fetch

const DEFAULTS = {
  claude: { model: 'claude-sonnet-4-20250514', maxTokens: 4096 },
  openai: { model: 'gpt-4o-mini', maxTokens: 4096 },
};

const ENDPOINTS = {
  claude: 'https://api.anthropic.com/v1/messages',
  openai: 'https://api.openai.com/v1/chat/completions',
};

async function callClaude(messages, apiKey, model, maxTokens) {
  const system = messages.find(m => m.role === 'system')?.content || '';
  const userMessages = messages.filter(m => m.role !== 'system');

  const res = await fetch(ENDPOINTS.claude, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system,
      messages: userMessages,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Claude API ${res.status}: ${body}`);
  }

  const data = await res.json();
  return {
    text: data.content[0].text,
    inputTokens: data.usage?.input_tokens || 0,
    outputTokens: data.usage?.output_tokens || 0,
  };
}

async function callOpenAI(messages, apiKey, model, maxTokens) {
  const res = await fetch(ENDPOINTS.openai, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenAI API ${res.status}: ${body}`);
  }

  const data = await res.json();
  return {
    text: data.choices[0].message.content,
    inputTokens: data.usage?.prompt_tokens || 0,
    outputTokens: data.usage?.completion_tokens || 0,
  };
}

async function callStreamClaude(messages, apiKey, model, maxTokens, onChunk) {
  const system = messages.find(m => m.role === 'system')?.content || '';
  const userMessages = messages.filter(m => m.role !== 'system');

  const res = await fetch(ENDPOINTS.claude, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      stream: true,
      system,
      messages: userMessages,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Claude API ${res.status}: ${body}`);
  }

  let full = '';
  let inputTokens = 0;
  let outputTokens = 0;

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const json = line.slice(6);
      if (json === '[DONE]') continue;

      try {
        const event = JSON.parse(json);
        if (event.type === 'content_block_delta' && event.delta?.text) {
          full += event.delta.text;
          onChunk(event.delta.text);
        } else if (event.type === 'message_delta' && event.usage) {
          outputTokens = event.usage.output_tokens || 0;
        } else if (event.type === 'message_start' && event.message?.usage) {
          inputTokens = event.message.usage.input_tokens || 0;
        }
      } catch {}
    }
  }

  return { text: full, inputTokens, outputTokens };
}

async function callStreamOpenAI(messages, apiKey, model, maxTokens, onChunk) {
  const res = await fetch(ENDPOINTS.openai, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      stream: true,
      messages,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenAI API ${res.status}: ${body}`);
  }

  let full = '';
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const json = line.slice(6);
      if (json === '[DONE]') continue;

      try {
        const event = JSON.parse(json);
        const delta = event.choices?.[0]?.delta?.content;
        if (delta) {
          full += delta;
          onChunk(delta);
        }
      } catch {}
    }
  }

  return { text: full, inputTokens: 0, outputTokens: 0 };
}

/**
 * Create an LLM client.
 * @param {{ provider?: string, apiKey?: string, model?: string }} opts
 * @returns {{ complete, stream, provider, model } | null} null if no API key
 */
export function createClient(opts = {}) {
  const provider = opts.provider || process.env.CODESIGHT_LLM_PROVIDER || 'claude';
  const apiKey = opts.apiKey || process.env.CODESIGHT_LLM_API_KEY
    || (provider === 'claude' ? process.env.ANTHROPIC_API_KEY : null)
    || (provider === 'openai' ? process.env.OPENAI_API_KEY : null);

  if (!apiKey) return null;

  const defaults = DEFAULTS[provider] || DEFAULTS.claude;
  const model = opts.model || process.env.CODESIGHT_LLM_MODEL || defaults.model;
  const callFn = provider === 'openai' ? callOpenAI : callClaude;
  const streamFn = provider === 'openai' ? callStreamOpenAI : callStreamClaude;

  let totalInput = 0;
  let totalOutput = 0;

  async function complete(messages, options = {}) {
    const maxTokens = options.maxTokens || defaults.maxTokens;
    const maxRetries = options.maxRetries || 3;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const result = await callFn(messages, apiKey, model, maxTokens);
        totalInput += result.inputTokens;
        totalOutput += result.outputTokens;
        return result.text;
      } catch (err) {
        if (attempt === maxRetries) throw err;
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
        console.warn(`  LLM call failed (attempt ${attempt}/${maxRetries}): ${err.message}. Retrying in ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }

  async function stream(messages, onChunk, options = {}) {
    const maxTokens = options.maxTokens || defaults.maxTokens;
    const result = await streamFn(messages, apiKey, model, maxTokens, onChunk);
    totalInput += result.inputTokens;
    totalOutput += result.outputTokens;
    return result.text;
  }

  function getUsage() {
    return { inputTokens: totalInput, outputTokens: totalOutput };
  }

  return { complete, stream, getUsage, provider, model };
}
