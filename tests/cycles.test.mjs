import { describe, it, expect } from 'vitest';
import { detectCycles } from '../src/analyzer/cycles.mjs';

describe('detectCycles', () => {
  it('returns no cycles for linear chain', () => {
    const edges = [
      { source: 'A', target: 'B', weight: 1 },
      { source: 'B', target: 'C', weight: 1 },
    ];
    const result = detectCycles(edges);
    expect(result.hasCycles).toBe(false);
    expect(result.cycles).toHaveLength(0);
  });

  it('detects simple A→B→A cycle', () => {
    const edges = [
      { source: 'A', target: 'B', weight: 3 },
      { source: 'B', target: 'A', weight: 2 },
    ];
    const result = detectCycles(edges);
    expect(result.hasCycles).toBe(true);
    expect(result.cycles).toHaveLength(1);
    expect(result.cycles[0].path).toEqual(['A', 'B', 'A']);
    expect(result.cycles[0].totalWeight).toBe(5);
  });

  it('detects triangle A→B→C→A', () => {
    const edges = [
      { source: 'A', target: 'B', weight: 1 },
      { source: 'B', target: 'C', weight: 2 },
      { source: 'C', target: 'A', weight: 3 },
    ];
    const result = detectCycles(edges);
    expect(result.hasCycles).toBe(true);
    expect(result.cycles).toHaveLength(1);
    expect(result.cycles[0].path).toHaveLength(4); // A, B, C, A
    expect(result.cycles[0].totalWeight).toBe(6);
  });

  it('detects self-loop', () => {
    const edges = [
      { source: 'A', target: 'A', weight: 5 },
    ];
    const result = detectCycles(edges);
    expect(result.hasCycles).toBe(true);
    expect(result.cycles).toHaveLength(1);
    expect(result.cycles[0].path).toEqual(['A', 'A']);
  });

  it('reports no false positives for diamond shape', () => {
    const edges = [
      { source: 'A', target: 'B', weight: 1 },
      { source: 'A', target: 'C', weight: 1 },
      { source: 'B', target: 'D', weight: 1 },
      { source: 'C', target: 'D', weight: 1 },
    ];
    const result = detectCycles(edges);
    expect(result.hasCycles).toBe(false);
  });

  it('detects multiple independent cycles', () => {
    const edges = [
      { source: 'A', target: 'B', weight: 1 },
      { source: 'B', target: 'A', weight: 1 },
      { source: 'X', target: 'Y', weight: 2 },
      { source: 'Y', target: 'X', weight: 2 },
    ];
    const result = detectCycles(edges);
    expect(result.hasCycles).toBe(true);
    expect(result.cycles).toHaveLength(2);
  });

  it('returns empty for empty edges', () => {
    const result = detectCycles([]);
    expect(result.hasCycles).toBe(false);
    expect(result.cycles).toHaveLength(0);
  });

  it('sorts cycles by totalWeight descending', () => {
    const edges = [
      { source: 'A', target: 'B', weight: 1 },
      { source: 'B', target: 'A', weight: 1 },
      { source: 'X', target: 'Y', weight: 10 },
      { source: 'Y', target: 'X', weight: 10 },
    ];
    const result = detectCycles(edges);
    expect(result.cycles[0].totalWeight).toBeGreaterThan(result.cycles[1].totalWeight);
  });
});
