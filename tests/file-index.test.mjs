import { describe, it, expect } from 'vitest';
import { buildFileIndex } from '../src/analyzer/file-index.mjs';

describe('FileIndex', () => {
  describe('extension probing', () => {
    const files = [
      '/proj/src/utils/helpers.ts',
      '/proj/src/utils/format.js',
      '/proj/src/components/Button.tsx',
      '/proj/src/main.mjs',
    ];
    const idx = buildFileIndex(files, '/proj');

    it('resolves .ts without extension', () => {
      expect(idx.resolve('src/utils/helpers')).toBe('src/utils/helpers.ts');
    });

    it('resolves .tsx without extension', () => {
      expect(idx.resolve('src/components/Button')).toBe('src/components/Button.tsx');
    });

    it('resolves .js without extension', () => {
      expect(idx.resolve('src/utils/format')).toBe('src/utils/format.js');
    });

    it('resolves .mjs without extension', () => {
      expect(idx.resolve('src/main')).toBe('src/main.mjs');
    });

    it('resolves exact path with extension', () => {
      expect(idx.resolve('src/utils/helpers.ts')).toBe('src/utils/helpers.ts');
    });

    it('returns null for nonexistent file', () => {
      expect(idx.resolve('src/nonexistent')).toBeNull();
    });
  });

  describe('barrel files (index.ts)', () => {
    const files = [
      '/proj/src/components/index.ts',
      '/proj/src/components/Button.tsx',
      '/proj/src/components/Input.tsx',
    ];
    const idx = buildFileIndex(files, '/proj');

    it('resolves directory import to index.ts', () => {
      expect(idx.resolve('src/components')).toBe('src/components/index.ts');
    });

    it('still resolves individual files', () => {
      expect(idx.resolve('src/components/Button')).toBe('src/components/Button.tsx');
    });
  });

  describe('Python __init__.py', () => {
    const files = [
      '/proj/mypackage/__init__.py',
      '/proj/mypackage/utils.py',
      '/proj/mypackage/sub/__init__.py',
      '/proj/mypackage/sub/helpers.py',
    ];
    const idx = buildFileIndex(files, '/proj');

    it('resolves package import to __init__.py', () => {
      expect(idx.resolve('mypackage')).toBe('mypackage/__init__.py');
    });

    it('resolves subpackage to __init__.py', () => {
      expect(idx.resolve('mypackage/sub')).toBe('mypackage/sub/__init__.py');
    });

    it('resolves module within package', () => {
      expect(idx.resolve('mypackage/utils')).toBe('mypackage/utils.py');
    });

    it('resolves nested module', () => {
      expect(idx.resolve('mypackage/sub/helpers')).toBe('mypackage/sub/helpers.py');
    });
  });

  describe('duplicate base names', () => {
    const files = [
      '/proj/src/auth/index.ts',
      '/proj/src/payments/index.ts',
      '/proj/src/utils.ts',
    ];
    const idx = buildFileIndex(files, '/proj');

    it('resolves to correct index by directory', () => {
      expect(idx.resolve('src/auth')).toBe('src/auth/index.ts');
      expect(idx.resolve('src/payments')).toBe('src/payments/index.ts');
    });

    it('does not confuse files with same base name', () => {
      // src/auth/index and src/payments/index are distinct
      expect(idx.resolve('src/auth/index')).toBe('src/auth/index.ts');
      expect(idx.resolve('src/payments/index')).toBe('src/payments/index.ts');
    });
  });

  describe('has()', () => {
    const idx = buildFileIndex(['/proj/src/foo.ts'], '/proj');

    it('returns true for known files', () => {
      expect(idx.has('src/foo.ts')).toBe(true);
    });

    it('returns false for unknown files', () => {
      expect(idx.has('src/bar.ts')).toBe(false);
    });

    it('returns false for extensionless path', () => {
      expect(idx.has('src/foo')).toBe(false);
    });
  });
});

describe('TypeScript import resolution with FileIndex', () => {
  it('resolves relative imports through file index', async () => {
    const tsLang = (await import('../src/languages/typescript.mjs')).default;
    const files = [
      '/proj/src/foo.ts',
      '/proj/src/utils/helpers.ts',
    ];
    const idx = buildFileIndex(files, '/proj');

    const result = tsLang.resolveImport('./utils/helpers', '/proj/src/foo.ts', '/proj', idx);
    expect(result.resolvedPath).toBe('src/utils/helpers.ts');
    expect(result.resolvedModule).not.toBe('external');
  });

  it('resolves barrel imports through file index', async () => {
    const tsLang = (await import('../src/languages/typescript.mjs')).default;
    const files = [
      '/proj/src/app.ts',
      '/proj/src/components/index.ts',
      '/proj/src/components/Button.tsx',
    ];
    const idx = buildFileIndex(files, '/proj');

    const result = tsLang.resolveImport('./components', '/proj/src/app.ts', '/proj', idx);
    expect(result.resolvedPath).toBe('src/components/index.ts');
  });

  it('resolves tsconfig path aliases', async () => {
    const tsLang = (await import('../src/languages/typescript.mjs')).default;
    const files = [
      '/proj/src/app.ts',
      '/proj/src/utils/helpers.ts',
    ];
    const idx = buildFileIndex(files, '/proj');
    idx.tsconfig = {
      paths: { '@/*': ['src/*'] },
      baseUrl: '.',
    };

    const result = tsLang.resolveImport('@/utils/helpers', '/proj/src/app.ts', '/proj', idx);
    expect(result.resolvedPath).toBe('src/utils/helpers.ts');
    expect(result.resolvedModule).not.toBe('external');
  });

  it('marks truly external imports as external', async () => {
    const tsLang = (await import('../src/languages/typescript.mjs')).default;
    const idx = buildFileIndex(['/proj/src/app.ts'], '/proj');

    const result = tsLang.resolveImport('react', '/proj/src/app.ts', '/proj', idx);
    expect(result.resolvedModule).toBe('external');
  });
});

describe('Python import resolution with FileIndex', () => {
  it('resolves relative imports through file index', async () => {
    const pyLang = (await import('../src/languages/python.mjs')).default;
    const files = [
      '/proj/mypackage/main.py',
      '/proj/mypackage/utils.py',
    ];
    const idx = buildFileIndex(files, '/proj');

    const result = pyLang.resolveImport('.utils', '/proj/mypackage/main.py', '/proj', idx);
    expect(result.resolvedPath).toBe('mypackage/utils.py');
  });

  it('resolves package imports to __init__.py', async () => {
    const pyLang = (await import('../src/languages/python.mjs')).default;
    const files = [
      '/proj/main.py',
      '/proj/mypackage/__init__.py',
      '/proj/mypackage/core.py',
    ];
    const idx = buildFileIndex(files, '/proj');

    const result = pyLang.resolveImport('mypackage', '/proj/main.py', '/proj', idx);
    expect(result.resolvedPath).toBe('mypackage/__init__.py');
  });

  it('resolves dotted absolute imports', async () => {
    const pyLang = (await import('../src/languages/python.mjs')).default;
    const files = [
      '/proj/main.py',
      '/proj/mypackage/sub/helpers.py',
    ];
    const idx = buildFileIndex(files, '/proj');

    const result = pyLang.resolveImport('mypackage.sub.helpers', '/proj/main.py', '/proj', idx);
    expect(result.resolvedPath).toBe('mypackage/sub/helpers.py');
  });
});
