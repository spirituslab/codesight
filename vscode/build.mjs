import * as esbuild from 'esbuild';
import { cpSync } from 'fs';

// Copy web UI into extension so webview can access it
cpSync('../web/src', './web/src', { recursive: true });

await esbuild.build({
  entryPoints: ['./src/extension.ts'],
  bundle: true,
  outfile: 'out/extension.js',
  format: 'cjs',
  platform: 'node',
  external: [
    'vscode',
    'tree-sitter',
    'tree-sitter-typescript',
    'tree-sitter-python',
    'tree-sitter-c',
    'tree-sitter-cpp',
    'tree-sitter-java',
    'tree-sitter-javascript',
  ],
  // Shim import.meta.url so createRequire() works in CJS output
  define: {
    'import.meta.url': 'importMetaUrl',
  },
  banner: {
    js: 'var importMetaUrl = require("url").pathToFileURL(__filename).href;',
  },
});
