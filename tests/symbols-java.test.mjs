import { describe, it, expect } from 'vitest';
import { parseFile } from '../src/analyzer/parser.mjs';

describe('Java symbol extraction', () => {
  it('extracts public class with methods', () => {
    const code = `public class UserService {
    public String getUser(int id) { return ""; }
    private void helper() {}
}`;
    const result = parseFile(code, 'java');
    const names = result.symbols.map(s => s.name);
    expect(names).toContain('UserService');
    expect(names).toContain('getUser');
    expect(names).toContain('helper');

    const cls = result.symbols.find(s => s.name === 'UserService');
    expect(cls.kind).toBe('class');
    expect(cls.exported).toBe(true);

    const getUser = result.symbols.find(s => s.name === 'getUser');
    expect(getUser.kind).toBe('method');
    expect(getUser.exported).toBe(true);
    expect(getUser.className).toBe('UserService');
    expect(getUser.returnType).toBe('String');

    const helper = result.symbols.find(s => s.name === 'helper');
    expect(helper.kind).toBe('method');
    expect(helper.exported).toBe(false);
  });

  it('extracts interface', () => {
    const code = `public interface Repository {
    void save();
}`;
    const result = parseFile(code, 'java');
    const repo = result.symbols.find(s => s.name === 'Repository');
    expect(repo).toBeDefined();
    expect(repo.kind).toBe('interface');
    expect(repo.exported).toBe(true);
  });

  it('extracts enum', () => {
    const code = `public enum Status { ACTIVE, INACTIVE }`;
    const result = parseFile(code, 'java');
    const status = result.symbols.find(s => s.name === 'Status');
    expect(status).toBeDefined();
    expect(status.kind).toBe('enum');
    expect(status.exported).toBe(true);
  });

  it('extracts static final constants', () => {
    const code = `public class Config {
    public static final String NAME = "app";
}`;
    const result = parseFile(code, 'java');
    const nameConst = result.symbols.find(s => s.name === 'NAME');
    expect(nameConst).toBeDefined();
    expect(nameConst.kind).toBe('const');
    expect(nameConst.exported).toBe(true);
    expect(nameConst.className).toBe('Config');
  });

  it('extracts imports correctly', () => {
    const code = `import java.util.List;
import java.util.ArrayList;
import static java.util.Collections.sort;
import java.io.*;`;
    const result = parseFile(code, 'java');
    expect(result.imports.length).toBeGreaterThanOrEqual(4);

    const listImport = result.imports.find(i => i.source === 'java.util.List');
    expect(listImport).toBeDefined();
    expect(listImport.symbols).toContain('List');

    const arrayListImport = result.imports.find(i => i.source === 'java.util.ArrayList');
    expect(arrayListImport).toBeDefined();
    expect(arrayListImport.symbols).toContain('ArrayList');

    const staticImport = result.imports.find(i => i.source === 'java.util.Collections');
    expect(staticImport).toBeDefined();
    expect(staticImport.symbols).toContain('sort');

    const wildcardImport = result.imports.find(i => i.source === 'java.io');
    expect(wildcardImport).toBeDefined();
  });
});
