import { describe, it, expect } from 'vitest';
import { CppProvider } from '@code-analyzer/analyzer';

const CODE = ['void inner(const char *x) {', '  std::system(x);', '}', 'void handler() {', '  const char *ident = getenv("ID");', '  inner(ident);', '}'].join('\n');

describe('probe', () => {
  it('prints cpp sources and sinks', () => {
    const typed = new CppProvider() as unknown as {
      extractTaintSources(s: string): Array<{ sourceType: string; line: number; text: string }>;
      extractTaintSinks(s: string): Array<{ sinkType: string; line: number; text: string }>;
    };
    const s = typed.extractTaintSources(CODE);
    const k = typed.extractTaintSinks(CODE);
    console.log(`CPP sources ${s.length} ${JSON.stringify(s.map((x) => `${x.sourceType}@${x.line}`))}`);
    console.log(`CPP sinks ${k.length} ${JSON.stringify(k.map((x) => `${x.sinkType}@${x.line}:${x.text.slice(0, 18)}`))}`);
    expect(true).toBe(true);
  });
});
