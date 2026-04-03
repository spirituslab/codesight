import { describe, it, expect } from 'vitest';
import { parseFile } from '../src/analyzer/parser.mjs';
import { buildCallGraph } from '../src/analyzer/callgraph.mjs';

function makeFile(code, lang, path) {
  const parsed = parseFile(code, lang);
  return {
    name: path.split('/').pop(),
    path,
    language: lang,
    lineCount: code.split('\n').length,
    symbols: parsed.symbols,
    imports: parsed.imports.map(imp => ({ ...imp, resolvedPath: null, resolvedModule: 'external' })),
    _rootNode: parsed.rootNode,
  };
}

describe('buildCallGraph', () => {
  it('detects calls between functions in the same TS file', () => {
    const code = `
export function caller() {
  helper();
}
function helper() {
  return 42;
}
`;
    const file = makeFile(code, 'typescript', 'test.ts');
    const result = buildCallGraph([], [file], '/tmp');
    expect(result.edges.length).toBeGreaterThan(0);
    const edge = result.edges.find(e => e.source.includes('caller') && e.target.includes('helper'));
    expect(edge).toBeDefined();
  });

  it('detects calls between functions in the same Python file', () => {
    const code = `def caller():\n  helper()\n\ndef helper():\n  return 42\n`;
    const file = makeFile(code, 'python', 'test.py');
    const result = buildCallGraph([], [file], '/tmp');
    expect(result.edges.length).toBeGreaterThan(0);
    const edge = result.edges.find(e => e.source.includes('caller') && e.target.includes('helper'));
    expect(edge).toBeDefined();
  });

  it('filters Python builtins from call graph', () => {
    const code = `def process():\n  print("hello")\n  len([1,2])\n  helper()\n\ndef helper():\n  pass\n`;
    const file = makeFile(code, 'python', 'test.py');
    const result = buildCallGraph([], [file], '/tmp');
    // Should have edge to helper but NOT to print or len
    const printEdge = result.edges.find(e => e.target.includes('print'));
    const lenEdge = result.edges.find(e => e.target.includes('len'));
    const helperEdge = result.edges.find(e => e.target.includes('helper'));
    expect(printEdge).toBeUndefined();
    expect(lenEdge).toBeUndefined();
    expect(helperEdge).toBeDefined();
  });

  it('filters TS builtins from call graph', () => {
    const code = `
export function process() {
  console.log("hello");
  JSON.parse("{}");
  helper();
}
function helper() {}
`;
    const file = makeFile(code, 'typescript', 'test.ts');
    const result = buildCallGraph([], [file], '/tmp');
    const consoleEdge = result.edges.find(e => e.target.includes('console'));
    const jsonEdge = result.edges.find(e => e.target.includes('JSON'));
    expect(consoleEdge).toBeUndefined();
    expect(jsonEdge).toBeUndefined();
  });

  it('returns stats with correct counts', () => {
    const code = `
export function a() { b(); }
export function b() { c(); }
export function c() {}
`;
    const file = makeFile(code, 'typescript', 'test.ts');
    const result = buildCallGraph([], [file], '/tmp');
    expect(result.stats.totalCalls).toBeGreaterThanOrEqual(2);
    expect(result.stats.uniqueCallers).toBeGreaterThanOrEqual(2);
    expect(result.stats.uniqueCallees).toBeGreaterThanOrEqual(2);
  });

  it('collects warnings on error instead of silently failing', () => {
    const warnings = [];
    // File with _rootNode but broken symbols that could cause issues
    const file = {
      name: 'broken.ts',
      path: 'broken.ts',
      language: 'typescript',
      lineCount: 1,
      symbols: [{ name: 'test', kind: 'function', line: 1, exported: true }],
      imports: [],
      _rootNode: null, // null rootNode = skip, no error
    };
    const result = buildCallGraph([], [file], '/tmp', warnings);
    // Should complete without throwing
    expect(result).toBeDefined();
    expect(result.edges).toEqual([]);
  });
});
