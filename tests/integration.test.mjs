import { describe, it, expect, beforeAll } from 'vitest';
import { analyze } from '../src/analyzer/index.mjs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, '..');

describe('integration: full analysis on codesight project', () => {
  let result;

  beforeAll(async () => {
    result = await analyze(PROJECT_ROOT, { maxFiles: 5000 });
  }, 60000);

  it('detects multiple modules', () => {
    expect(result.modules.length).toBeGreaterThan(0);
  });

  it('detects javascript language', () => {
    expect(result.languages).toContain('javascript');
  });

  it('has non-empty call graph with exact calls', () => {
    expect(result.callGraph.stats.totalCalls).toBeGreaterThan(0);
    expect(result.callGraph.stats.exact).toBeGreaterThan(0);
    expect(result.callGraph.stats.ambiguous).toBe(0);
  });

  it('has positive edge weights', () => {
    for (const edge of result.edges) {
      expect(edge.weight).toBeGreaterThan(0);
    }
  });

  it('detects entry points', () => {
    const allFiles = [...result.rootFiles, ...result.modules.flatMap(m => m.files)];
    const entryPoints = allFiles.filter(f => f.isEntryPoint);
    expect(entryPoints.length).toBeGreaterThan(0);
  });

  it('populates cross-references', () => {
    const allFiles = [...result.rootFiles, ...result.modules.flatMap(m => m.files)];
    const symbolsWithUsedBy = allFiles.flatMap(f => f.symbols).filter(s => s.usedBy.length > 0);
    expect(symbolsWithUsedBy.length).toBeGreaterThan(0);
  });

  it('circular deps has valid structure', () => {
    expect(result.circularDeps).toBeDefined();
    expect(typeof result.circularDeps.hasCycles).toBe('boolean');
    expect(Array.isArray(result.circularDeps.cycles)).toBe(true);
  });

  it('dead code has valid structure', () => {
    expect(result.deadCode).toBeDefined();
    expect(Array.isArray(result.deadCode.deadSymbols)).toBe(true);
    expect(Array.isArray(result.deadCode.deadFiles)).toBe(true);
    expect(Array.isArray(result.deadCode.deadModules)).toBe(true);
    expect(result.deadCode.stats.totalSymbols).toBeGreaterThan(0);
  });

  it('has valid key files', () => {
    expect(result.keyFiles.length).toBeGreaterThan(0);
    for (const kf of result.keyFiles) {
      expect(kf.importedByCount).toBeGreaterThan(0);
    }
  });

  it('result has expected top-level fields', () => {
    expect(result.generatedAt).toBeDefined();
    expect(result.projectName).toBe('codesight');
    expect(result.modules).toBeDefined();
    expect(result.rootFiles).toBeDefined();
    expect(result.edges).toBeDefined();
    expect(result.callGraph).toBeDefined();
    expect(result.impactMap).toBeDefined();
  });
});
