import * as path from 'path';

// Analysis result type (matches the output shape of analyze())
export interface AnalysisResult {
  generatedAt: string;
  projectName: string;
  languages: string[];
  modules: any[];
  rootFiles: any[];
  edges: any[];
  keyFiles: any[];
  callGraph: { edges: any[]; stats: any };
  impactMap: Record<string, any>;
  tours: any[];
  [key: string]: any;
}

export class AnalyzerWrapper {
  private workspaceRoot: string;
  private result: AnalysisResult | null = null;
  private analyzeModule: any = null;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
  }

  private async loadAnalyzer(): Promise<any> {
    if (this.analyzeModule) return this.analyzeModule;
    // Dynamic import for ESM analyzer module
    const analyzerPath = path.resolve(__dirname, '../../src/analyzer/index.mjs');
    this.analyzeModule = await import(analyzerPath);
    return this.analyzeModule;
  }

  async runFullAnalysis(): Promise<AnalysisResult | null> {
    try {
      console.log('[codesight] Loading analyzer from:', path.resolve(__dirname, '../../src/analyzer/index.mjs'));
      const mod = await this.loadAnalyzer();
      console.log('[codesight] Running analysis on:', this.workspaceRoot);
      this.result = await mod.analyze(this.workspaceRoot, { llm: false, cache: true });
      console.log('[codesight] Analysis complete. Modules:', this.result?.modules?.length);
      return this.result;
    } catch (err: any) {
      console.error('[codesight] Analysis failed:', err.message, err.stack);
      return null;
    }
  }

  async runIncrementalUpdate(filePath: string): Promise<AnalysisResult | null> {
    // For now, re-run full analysis with cache (cache makes unchanged files fast)
    // A true incremental update would re-parse only the changed file and update
    // the affected graph edges. This is a v2 optimization.
    return this.runFullAnalysis();
  }

  getResult(): AnalysisResult | null {
    return this.result;
  }

  getImpactMap(): Record<string, any> {
    return this.result?.impactMap || {};
  }

  getCallGraph(): { edges: any[]; stats: any } | null {
    return this.result?.callGraph || null;
  }

  getModules(): any[] {
    return this.result?.modules || [];
  }

  findSymbolAtLine(filePath: string, line: number): any | null {
    if (!this.result) return null;

    const relPath = path.relative(this.workspaceRoot, filePath);

    // Search all modules for a file matching this path
    for (const mod of this.result.modules) {
      for (const file of mod.files || []) {
        if (file.path === relPath || file.path === filePath) {
          // Find the closest symbol to the given line
          let closest: any = null;
          let minDist = Infinity;
          for (const sym of file.symbols || []) {
            const dist = Math.abs(sym.line - line);
            if (dist < minDist) {
              minDist = dist;
              closest = sym;
            }
          }
          return closest;
        }
      }
    }
    return null;
  }
}
