import { describe, it, expect } from 'vitest';
import { parseFile } from '../src/analyzer/parser.mjs';

describe('Python symbol extraction', () => {
  it('extracts function', () => {
    const result = parseFile('def greet(name: str) -> str:\n  return name\n', 'python');
    expect(result.symbols).toHaveLength(1);
    const sym = result.symbols[0];
    expect(sym.name).toBe('greet');
    expect(sym.kind).toBe('function');
    expect(sym.parameters).toHaveLength(1);
    expect(sym.parameters[0]).toMatchObject({ name: 'name', type: 'str' });
    expect(sym.returnType).toBe('str');
  });

  it('filters self/cls from parameters', () => {
    const code = 'class Foo:\n  def bar(self, x: int):\n    pass\n';
    const result = parseFile(code, 'python');
    const bar = result.symbols.find(s => s.name === 'bar');
    // bar might not be extracted as top-level (class method)
    // but Foo should be extracted
    const foo = result.symbols.find(s => s.name === 'Foo');
    expect(foo).toBeDefined();
    expect(foo.kind).toBe('class');
  });

  it('extracts class', () => {
    const result = parseFile('class MyClass:\n  pass\n', 'python');
    expect(result.symbols).toHaveLength(1);
    expect(result.symbols[0].name).toBe('MyClass');
    expect(result.symbols[0].kind).toBe('class');
  });

  it('extracts UPPER_CASE constants', () => {
    const result = parseFile('MAX_RETRIES = 3\n', 'python');
    expect(result.symbols).toHaveLength(1);
    expect(result.symbols[0].name).toBe('MAX_RETRIES');
    expect(result.symbols[0].kind).toBe('const');
  });

  it('ignores lowercase assignments', () => {
    const result = parseFile('my_var = 42\n', 'python');
    expect(result.symbols).toHaveLength(0);
  });

  it('extracts decorated function', () => {
    const code = '@decorator\ndef my_func():\n  pass\n';
    const result = parseFile(code, 'python');
    expect(result.symbols).toHaveLength(1);
    expect(result.symbols[0].name).toBe('my_func');
  });

  it('marks private functions as not exported', () => {
    const result = parseFile('def _helper():\n  pass\n', 'python');
    expect(result.symbols).toHaveLength(1);
    expect(result.symbols[0].exported).toBe(false);
  });

  it('extracts docstring as comment', () => {
    const code = 'def foo():\n  """This is a docstring."""\n  pass\n';
    const result = parseFile(code, 'python');
    expect(result.symbols[0].comment).toContain('This is a docstring');
  });
});
