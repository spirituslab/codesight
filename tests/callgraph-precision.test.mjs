import { describe, it, expect } from 'vitest';
import { parseFile } from '../src/analyzer/parser.mjs';
import { buildCallGraph } from '../src/analyzer/callgraph.mjs';

function makeFile(code, lang, path, imports = []) {
  const parsed = parseFile(code, lang);
  return {
    name: path.split('/').pop(),
    path,
    language: lang,
    lineCount: code.split('\n').length,
    symbols: parsed.symbols,
    imports: imports.map(imp => ({
      source: imp.source,
      symbols: imp.symbols || [],
      resolvedPath: imp.resolvedPath || null,
      resolvedModule: imp.resolvedModule || 'external',
      typeOnly: false,
    })),
    _rootNode: parsed.rootNode,
  };
}

describe('Call graph confidence scoring', () => {
  it('marks import-resolved calls as exact', () => {
    const fileA = makeFile(
      'export function caller() { helper(); }',
      'typescript', 'a.ts',
      [{ source: './b', symbols: ['helper'], resolvedPath: 'b.ts', resolvedModule: 'root' }]
    );
    const fileB = makeFile(
      'export function helper() { return 1; }',
      'typescript', 'b.ts'
    );
    const result = buildCallGraph([], [fileA, fileB], '/tmp');
    const edge = result.edges.find(e => e.source.includes('caller') && e.target.includes('helper'));
    expect(edge).toBeDefined();
    expect(edge.confidence).toBe('exact');
  });

  it('marks same-file calls as exact', () => {
    const file = makeFile(
      'export function caller() { helper(); }\nfunction helper() {}',
      'typescript', 'test.ts'
    );
    const result = buildCallGraph([], [file], '/tmp');
    const edge = result.edges.find(e => e.source.includes('caller') && e.target.includes('helper'));
    expect(edge).toBeDefined();
    expect(edge.confidence).toBe('exact');
  });

  it('marks symbol-index fallback as inferred when single match', () => {
    // fileA calls helper() — not imported, not local. Only fileB has it.
    // extractCalls won't return it since it's unknown, so we simulate by
    // having the import resolve to external (non @/ prefix so isExternal=true)
    const fileA = makeFile(
      'export function caller() { helper(); }',
      'typescript', 'a.ts',
      [{ source: 'some-lib', symbols: ['helper'], resolvedPath: null, resolvedModule: 'external' }]
    );
    const fileB = makeFile(
      'export function helper() { return 1; }',
      'typescript', 'b.ts'
    );
    const result = buildCallGraph([], [fileA, fileB], '/tmp');
    const edge = result.edges.find(e => e.source.includes('caller') && e.target.includes('helper'));
    expect(edge).toBeDefined();
    expect(edge.confidence).toBe('inferred');
  });

  it('marks multiple-match fallback as ambiguous', () => {
    const fileA = makeFile(
      'export function caller() { helper(); }',
      'typescript', 'a.ts',
      [{ source: 'some-lib', symbols: ['helper'], resolvedPath: null, resolvedModule: 'external' }]
    );
    const fileB = makeFile('export function helper() {}', 'typescript', 'b.ts');
    const fileC = makeFile('export function helper() {}', 'typescript', 'c.ts');
    const result = buildCallGraph([], [fileA, fileB, fileC], '/tmp');
    const edge = result.edges.find(e => e.source.includes('caller'));
    expect(edge).toBeDefined();
    expect(edge.confidence).toBe('ambiguous');
  });

  it('includes confidence stats', () => {
    const file = makeFile(
      'export function a() { b(); }\nexport function b() {}',
      'typescript', 'test.ts'
    );
    const result = buildCallGraph([], [file], '/tmp');
    expect(result.stats.exact).toBeGreaterThanOrEqual(1);
    expect(typeof result.stats.inferred).toBe('number');
    expect(typeof result.stats.ambiguous).toBe('number');
    expect(typeof result.stats.unresolved).toBe('number');
  });
});

describe('Call graph disambiguation', () => {
  it('prefers symbols from imported files over random matches', () => {
    // fileA imports from fileB, calls helper(). fileC also has helper().
    // Should prefer fileB's helper since it's actually imported.
    const fileA = makeFile(
      'export function caller() { helper(); }',
      'typescript', 'a.ts',
      [{ source: 'some-lib', symbols: ['helper'], resolvedPath: 'b.ts', resolvedModule: 'root' }]
    );
    const fileB = makeFile('export function helper() { return "B"; }', 'typescript', 'b.ts');
    const fileC = makeFile('export function helper() { return "C"; }', 'typescript', 'c.ts');
    const result = buildCallGraph([], [fileA, fileB, fileC], '/tmp');
    const edge = result.edges.find(e => e.source.includes('caller'));
    expect(edge).toBeDefined();
    // Should resolve to b.ts since that's the imported file
    expect(edge.target).toContain('b.ts');
  });
});

describe('Class method call resolution', () => {
  it('resolves this.method() calls in TypeScript classes', () => {
    const code = `
export class Service {
  process() {
    this.validate();
  }
  validate() {
    return true;
  }
}
`;
    const file = makeFile(code, 'typescript', 'service.ts');
    const result = buildCallGraph([], [file], '/tmp');
    const edge = result.edges.find(e => e.source.includes('process') && e.target.includes('validate'));
    expect(edge).toBeDefined();
    expect(edge.confidence).toBe('exact');
  });

  it('resolves self.method() calls in Python classes', () => {
    const code = `class Service:\n  def process(self):\n    self.validate()\n\n  def validate(self):\n    return True\n`;
    const file = makeFile(code, 'python', 'service.py');
    const result = buildCallGraph([], [file], '/tmp');
    const edge = result.edges.find(e => e.source.includes('process') && e.target.includes('validate'));
    expect(edge).toBeDefined();
  });

  it('extracts class methods as symbols with className', () => {
    const code = `
export class Repo {
  find(id: string) { return id; }
  save(item: any) { return item; }
}
`;
    const parsed = parseFile(code, 'typescript');
    const methods = parsed.symbols.filter(s => s.kind === 'method');
    expect(methods).toHaveLength(2);
    expect(methods[0].className).toBe('Repo');
    expect(methods[1].className).toBe('Repo');
  });
});

describe('Unresolved call tracking', () => {
  it('reports unresolved count in warnings when import target not found', () => {
    // caller() imports helper from external lib (isExternal=true), calls it.
    // helper exists nowhere in the project — callgraph can't resolve it.
    const file = makeFile(
      'export function caller() { helper(); }',
      'typescript', 'test.ts',
      [{ source: 'unknown-lib', symbols: ['helper'], resolvedPath: null, resolvedModule: 'external' }]
    );
    const warnings = [];
    const result = buildCallGraph([], [file], '/tmp', warnings);
    // helper is imported but has no local match — should be unresolved
    expect(result.stats.unresolved).toBeGreaterThan(0);
    const unresolvedWarning = warnings.find(w => w.type === 'callgraph' && w.message.includes('could not be resolved'));
    expect(unresolvedWarning).toBeDefined();
  });
});
