import * as esbuild from 'esbuild';
import { cpSync, existsSync } from 'fs';

// Copy web UI into extension so webview can access it
cpSync('../web/src', './web/src', { recursive: true });

// Copy tree-sitter native modules from root node_modules into extension node_modules
// so they are included when packaging the .vsix
const treeSitterPkgs = [
  'tree-sitter',
  'tree-sitter-c',
  'tree-sitter-cpp',
  'tree-sitter-java',
  'tree-sitter-javascript',
  'tree-sitter-python',
  'tree-sitter-typescript',
  'node-addon-api',
  'node-gyp-build',
  'prebuild-install',
];
for (const pkg of treeSitterPkgs) {
  const src = `../node_modules/${pkg}`;
  const dest = `./node_modules/${pkg}`;
  if (existsSync(src)) {
    cpSync(src, dest, { recursive: true });
  }
}

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
