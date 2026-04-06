import * as esbuild from 'esbuild';
import { cpSync, existsSync, lstatSync, realpathSync } from 'fs';

// Copy web UI into extension so webview can access it
// Skip if vscode/web is a symlink to ../web (dev setup)
let skipWebCopy = false;
try {
  const stat = lstatSync('./web');
  if (stat.isSymbolicLink()) {
    const target = realpathSync('./web/src');
    const source = realpathSync('../web/src');
    if (target === source) skipWebCopy = true;
  }
} catch {}
if (!skipWebCopy) {
  cpSync('../web/src', './web/src', { recursive: true });
}

// Copy tree-sitter native modules from root node_modules into extension node_modules
// so they are included when packaging the .vsix
const treeSitterPkgs = [
  'tree-sitter',
  'tree-sitter-c',
  'tree-sitter-c-sharp',
  'tree-sitter-cpp',
  'tree-sitter-go',
  'tree-sitter-java',
  'tree-sitter-javascript',
  'tree-sitter-python',
  'tree-sitter-rust',
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
    'tree-sitter-c',
    'tree-sitter-c-sharp',
    'tree-sitter-cpp',
    'tree-sitter-go',
    'tree-sitter-java',
    'tree-sitter-javascript',
    'tree-sitter-python',
    'tree-sitter-rust',
    'tree-sitter-typescript',
  ],
  // Shim import.meta.url so createRequire() works in CJS output
  define: {
    'import.meta.url': 'importMetaUrl',
  },
  banner: {
    js: 'var importMetaUrl = require("url").pathToFileURL(__filename).href;',
  },
});
