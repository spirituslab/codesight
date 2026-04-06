import { describe, it, expect } from 'vitest';
import { parseFile } from '../src/analyzer/parser.mjs';

describe('Go symbol extraction', () => {
  it('extracts exported function', () => {
    const { symbols } = parseFile(`
package main

func Add(a int, b int) int {
  return a + b
}
`, 'go');
    expect(symbols.length).toBeGreaterThanOrEqual(1);
    const sym = symbols.find(s => s.name === 'Add');
    expect(sym).toBeDefined();
    expect(sym.kind).toBe('function');
    expect(sym.exported).toBe(true);
    expect(sym.returnType).toBe('int');
  });

  it('extracts unexported function', () => {
    const { symbols } = parseFile(`
package main

func helper() {
}
`, 'go');
    const sym = symbols.find(s => s.name === 'helper');
    expect(sym).toBeDefined();
    expect(sym.exported).toBe(false);
  });

  it('extracts struct type', () => {
    const { symbols } = parseFile(`
package main

type Server struct {
  Host string
  Port int
}
`, 'go');
    const sym = symbols.find(s => s.name === 'Server');
    expect(sym).toBeDefined();
    expect(sym.kind).toBe('class');
    expect(sym.exported).toBe(true);
  });

  it('extracts interface type', () => {
    const { symbols } = parseFile(`
package main

type Reader interface {
  Read(p []byte) (n int, err error)
}
`, 'go');
    const sym = symbols.find(s => s.name === 'Reader');
    expect(sym).toBeDefined();
    expect(sym.kind).toBe('interface');
  });

  it('extracts method with receiver', () => {
    const { symbols } = parseFile(`
package main

type Server struct {}

func (s *Server) Start() error {
  return nil
}
`, 'go');
    const sym = symbols.find(s => s.name === 'Start');
    expect(sym).toBeDefined();
    expect(sym.kind).toBe('method');
    expect(sym.className).toBe('Server');
  });

  it('extracts import declarations', () => {
    const { imports } = parseFile(`
package main

import (
  "fmt"
  "net/http"
)
`, 'go');
    expect(imports.length).toBe(2);
    expect(imports[0].source).toBe('fmt');
    expect(imports[1].source).toBe('net/http');
  });
});
