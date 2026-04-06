import { describe, it, expect } from 'vitest';
import { parseFile } from '../src/analyzer/parser.mjs';

describe('C# symbol extraction', () => {
  it('extracts class with public method', () => {
    const { symbols } = parseFile(`
public class Calculator {
    public int Add(int a, int b) {
        return a + b;
    }
}
`, 'csharp');
    const cls = symbols.find(s => s.name === 'Calculator');
    expect(cls).toBeDefined();
    expect(cls.kind).toBe('class');
    expect(cls.exported).toBe(true);

    const method = symbols.find(s => s.name === 'Add');
    expect(method).toBeDefined();
    expect(method.kind).toBe('method');
    expect(method.exported).toBe(true);
    expect(method.className).toBe('Calculator');
  });

  it('extracts interface', () => {
    const { symbols } = parseFile(`
public interface IService {
    void Process();
}
`, 'csharp');
    const sym = symbols.find(s => s.name === 'IService');
    expect(sym).toBeDefined();
    expect(sym.kind).toBe('interface');
  });

  it('extracts struct', () => {
    const { symbols } = parseFile(`
public struct Point {
    public int X;
    public int Y;
}
`, 'csharp');
    const sym = symbols.find(s => s.name === 'Point');
    expect(sym).toBeDefined();
    expect(sym.kind).toBe('class');
  });

  it('extracts enum', () => {
    const { symbols } = parseFile(`
public enum Color {
    Red,
    Green,
    Blue
}
`, 'csharp');
    const sym = symbols.find(s => s.name === 'Color');
    expect(sym).toBeDefined();
    expect(sym.kind).toBe('enum');
  });

  it('extracts using directives', () => {
    const { imports } = parseFile(`
using System;
using System.Collections.Generic;
`, 'csharp');
    expect(imports.length).toBe(2);
    expect(imports[0].source).toBe('System');
    expect(imports[1].source).toBe('System.Collections.Generic');
  });

  it('private method has exported false', () => {
    const { symbols } = parseFile(`
public class Foo {
    private void Secret() {
    }
}
`, 'csharp');
    const method = symbols.find(s => s.name === 'Secret');
    expect(method).toBeDefined();
    expect(method.exported).toBe(false);
  });
});
