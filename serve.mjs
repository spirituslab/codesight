#!/usr/bin/env node

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGzip } from 'node:zlib';
import { loadEnv } from './src/env.mjs';
import { createClient } from './src/llm/client.mjs';
import { buildChatPrompt } from './src/llm/prompts.mjs';

loadEnv();

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB_DIR = join(__dirname, 'web');
const PORT = parseInt(process.argv[2] || process.env.PORT || '8080', 10);

const MIME_TYPES = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

// Load analysis data for chat context
let analysisData = null;
try {
  const raw = await readFile(join(WEB_DIR, 'data.js'), 'utf-8');
  const jsonStr = raw.replace(/^window\.CODEBASE_DATA\s*=\s*/, '').replace(/;\s*$/, '');
  analysisData = JSON.parse(jsonStr);
  console.log(`Loaded analysis data: ${analysisData.projectName} (${analysisData.modules.length} modules)`);
} catch (err) {
  console.warn('Warning: Could not load analysis data for chat. Run analyze.mjs first.');
}

// Create LLM client for chat
const chatClient = createClient();

const server = createServer(async (req, res) => {
  // CORS headers for local dev
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // API routes
  if (req.url === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      chatAvailable: !!chatClient,
      project: analysisData?.projectName || null,
    }));
    return;
  }

  if (req.url === '/api/chat' && req.method === 'POST') {
    await handleChat(req, res);
    return;
  }

  // Static file serving
  let filePath = req.url === '/' ? '/index.html' : req.url;
  filePath = filePath.split('?')[0]; // strip query params

  const fullPath = join(WEB_DIR, filePath);
  // Prevent directory traversal
  if (!fullPath.startsWith(WEB_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  try {
    const ext = extname(fullPath);
    const mime = MIME_TYPES[ext] || 'application/octet-stream';
    const acceptsGzip = (req.headers['accept-encoding'] || '').includes('gzip');
    const compressible = ['.html', '.js', '.mjs', '.css', '.json'].includes(ext);

    if (acceptsGzip && compressible) {
      res.writeHead(200, { 'Content-Type': mime, 'Content-Encoding': 'gzip', 'Vary': 'Accept-Encoding' });
      createReadStream(fullPath).pipe(createGzip()).pipe(res);
    } else {
      const content = await readFile(fullPath);
      res.writeHead(200, { 'Content-Type': mime });
      res.end(content);
    }
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
});

async function handleChat(req, res) {
  if (!chatClient) {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'No LLM API key configured. Set ANTHROPIC_API_KEY or OPENAI_API_KEY.' }));
    return;
  }

  // Read request body
  let body = '';
  for await (const chunk of req) body += chunk;

  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid JSON' }));
    return;
  }

  const { message, context = {}, history = [] } = parsed;
  if (!message) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Missing message field' }));
    return;
  }

  // Build prompt with context
  const messages = buildChatPrompt(message, context, analysisData);

  // Insert history before the user message
  if (history.length > 0) {
    const userMsg = messages.pop();
    for (const h of history.slice(-10)) { // keep last 10 exchanges
      messages.push({ role: h.role, content: h.content });
    }
    messages.push(userMsg);
  }

  // Stream response via SSE
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  try {
    await chatClient.stream(messages, (chunk) => {
      res.write(`data: ${JSON.stringify({ text: chunk })}\n\n`);
    });
    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
  }

  res.end();
}

server.listen(PORT, () => {
  console.log(`\ncodesight server running at http://localhost:${PORT}`);
  if (chatClient) {
    console.log(`Chat: enabled (${chatClient.provider} / ${chatClient.model})`);
  } else {
    console.log('Chat: disabled (no API key — set ANTHROPIC_API_KEY or OPENAI_API_KEY)');
  }
});
