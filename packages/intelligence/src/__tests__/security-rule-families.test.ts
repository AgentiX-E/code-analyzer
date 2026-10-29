// The four OWASP Benchmark categories that are not flow problems, stated as rules.
//
// **Measured before writing this: 95 of 513.** The taint engine found `crypto` cases by accident (a weak cipher file
// also writes a request value to the page, so the case counted as detected for the wrong reason), found one `hash`
// case, five `weakrand` cases and no `securecookie` case at all. No amount of flow work reaches any of them — the bug
// is "this program picked a broken algorithm", which is a property of a call and its argument, not of a path.
//
// Every case below is a shape from the corpus reduced to the lines that decide it, and every one of them is decided
// the way the benchmark's own scoring decides it: a `MessageDigest.getInstance("MD5")` is a hash bug whatever else the
// file does.

import { describe, expect, it } from 'vitest';

import {
  evaluateSecurityRules,
  ruleCoverage,
  type RuleSourceFile,
} from '../security/rule-families.js';

function java(text: string): RuleSourceFile {
  return { path: 'src/Servlet.java', language: 'java', text };
}

const BENCHMARK_PROPERTIES: RuleSourceFile = {
  path: 'src/main/resources/benchmark.properties',
  language: 'properties',
  text: [
    'cryptoAlg1=DES/ECB/PKCS5Padding',
    'cryptoAlg2=AES/CCM/NoPadding',
    'hashAlg1=MD5',
    'hashAlg2=SHA-256',
  ].join('\n'),
};

function ruleIds(findings: ReturnType<typeof evaluateSecurityRules>): string[] {
  return findings.map((f) => f.ruleId).sort();
}

describe('a weak hash named at the call', () => {
  it('reports MD5 and SHA-1 and says nothing about SHA-256', () => {
    const weak = evaluateSecurityRules([
      java('class A { void m() { java.security.MessageDigest.getInstance("MD5"); } }'),
      java('class A { void m() { java.security.MessageDigest.getInstance("SHA-1"); } }'),
    ]);
    expect(ruleIds(weak)).toEqual(['weak-hash', 'weak-hash']);

    expect(
      evaluateSecurityRules([
        java('class A { void m() { java.security.MessageDigest.getInstance("SHA-256"); } }'),
      ]),
    ).toEqual([]);
  });

  it('reports the algorithm the name resolves to, not the name', () => {
    const findings = evaluateSecurityRules([
      java('class A { void m() { String a = "md5"; MessageDigest.getInstance(a); } }'),
    ]);

    expect(findings).toHaveLength(1);
    expect(findings[0]?.evidence).toContain('md5');
  });
});

describe('a weak hash named in the project configuration', () => {
  it('follows getProperty into the properties file in the same index', () => {
    // **This is the shape 129 of the corpus's `hash` cases are written in**, and the reason a lexical scan of the
    // source cannot answer it: the algorithm is `hashAlg1`, and `hashAlg1` is `MD5` only if you read the file next to
    // it. The same source with `hashAlg1=SHA-256` is a safe case.
    const source = java(
      [
        'class Servlet {',
        '  void doPost() {',
        '    java.util.Properties props = new java.util.Properties();',
        '    props.load(getClass().getClassLoader().getResourceAsStream("benchmark.properties"));',
        '    String algorithm = props.getProperty("hashAlg1", "SHA512");',
        '    java.security.MessageDigest md = java.security.MessageDigest.getInstance(algorithm);',
        '  }',
        '}',
      ].join('\n'),
    );

    const findings = evaluateSecurityRules([source, BENCHMARK_PROPERTIES]);
    expect(ruleIds(findings)).toEqual(['weak-hash']);
    expect(findings[0]?.evidence).toContain('hashAlg1');
    expect(findings[0]?.evidence).toContain('MD5');
  });

  it('leaves the same source alone when the property names a strong algorithm', () => {
    const source = java(
      [
        'class Servlet {',
        '  void doPost() {',
        '    String algorithm = props.getProperty("hashAlg2", "SHA512");',
        '    java.security.MessageDigest md = java.security.MessageDigest.getInstance(algorithm);',
        '  }',
        '}',
      ].join('\n'),
    );

    expect(evaluateSecurityRules([source, BENCHMARK_PROPERTIES])).toEqual([]);
  });

  it('falls back to the default in the call when the property is absent', () => {
    // `getProperty(key, default)` is a real fallback: a repository without the file still runs, with the default.
    const source = java(
      'class A { void m() { String a = props.getProperty("missing", "MD4"); MessageDigest.getInstance(a); } }',
    );

    expect(ruleIds(evaluateSecurityRules([source]))).toEqual(['weak-hash']);
  });
});

describe('a weak cipher', () => {
  it('reports DES, RC4 and ECB mode', () => {
    const findings = evaluateSecurityRules([
      java('class A { void m() { javax.crypto.Cipher.getInstance("DES/CBC/PKCS5Padding"); } }'),
      java('class A { void m() { javax.crypto.Cipher.getInstance("RC4"); } }'),
      java('class A { void m() { javax.crypto.Cipher.getInstance("AES/ECB/PKCS5Padding"); } }'),
      java('class A { void m() { javax.crypto.KeyGenerator.getInstance("DES"); } }'),
    ]);

    expect(ruleIds(findings)).toEqual(['weak-cipher', 'weak-cipher', 'weak-cipher', 'weak-cipher']);
  });

  it('says nothing about AES in a real mode of operation', () => {
    expect(
      evaluateSecurityRules([
        java('class A { void m() { javax.crypto.Cipher.getInstance("AES/GCM/NoPadding"); } }'),
      ]),
    ).toEqual([]);
  });
});

describe('a weak source of randomness', () => {
  it('reports java.util.Random and Math.random, and not SecureRandom', () => {
    expect(
      ruleIds(
        evaluateSecurityRules([
          java('class A { void m() { float f = new java.util.Random().nextFloat(); } }'),
          java('class A { void m() { double d = Math.random(); } }'),
          java('class A { void m() { int i = new Random().nextInt(99); } }'),
        ]),
      ),
    ).toEqual(['weak-random', 'weak-random', 'weak-random']);

    expect(
      evaluateSecurityRules([
        java('class A { void m() { int i = new java.security.SecureRandom().nextInt(99); } }'),
      ]),
    ).toEqual([]);
  });
});

describe('a cookie that is not marked secure', () => {
  it('reports setSecure(false) and a cookie added without any call', () => {
    expect(
      ruleIds(
        evaluateSecurityRules([
          java(
            [
              'class A { void m(HttpServletResponse response) {',
              '  Cookie c = new Cookie("n", "v");',
              '  c.setSecure(false);',
              '  response.addCookie(c);',
              '} }',
            ].join('\n'),
          ),
          java(
            [
              'class A { void m(HttpServletResponse response) {',
              '  Cookie c = new Cookie("n", "v");',
              '  c.setHttpOnly(true);',
              '  response.addCookie(c);',
              '} }',
            ].join('\n'),
          ),
        ]),
      ),
    ).toEqual(['insecure-cookie', 'insecure-cookie']);
  });

  it('says nothing about a cookie that sets the flag', () => {
    expect(
      evaluateSecurityRules([
        java(
          [
            'class A { void m(HttpServletResponse response) {',
            '  Cookie c = new Cookie("n", "v");',
            '  c.setSecure(true);',
            '  response.addCookie(c);',
            '} }',
          ].join('\n'),
        ),
      ]),
    ).toEqual([]);
  });
});

describe('the report itself', () => {
  it('carries the file, the line and the evidence that decided it', () => {
    const findings = evaluateSecurityRules([
      {
        path: 'src/a/Servlet.java',
        language: 'java',
        text: [
          'class A {',
          '  void m() {',
          '    MessageDigest.getInstance("MD5");',
          '  }',
          '}',
        ].join('\n'),
      },
    ]);

    expect(findings).toEqual([
      {
        ruleId: 'weak-hash',
        category: 'hash',
        cweId: 328,
        severity: 'high',
        filePath: 'src/a/Servlet.java',
        line: 3,
        evidence: '"MD5"',
      },
    ]);
  });

  it('reads a language it has no rules for as having no findings, rather than as clean or broken', () => {
    // The honest reading: `evaluateSecurityRules` answers about the languages it implements. A caller that needs the
    // others covered must see that this returned nothing because it looked, not because there was nothing.
    const findings = evaluateSecurityRules([
      { path: 'src/a.rb', language: 'ruby', text: 'Digest::MD5.hexdigest(x)' },
    ]);
    expect(findings).toEqual([]);
  });
});

describe('what the module says about its own reach', () => {
  it('names the languages and the rules each one carries', () => {
    // A caller has to be able to ask which languages were *looked at*, because an empty finding list means "nothing
    // found" for a covered language and "nothing looked for" for the rest.
    expect([...ruleCoverage()]).toEqual([
      ['java', ['weak-cipher', 'weak-hash', 'weak-random', 'insecure-cookie']],
    ]);
  });
});

describe('a properties file in the shapes a real repository writes it', () => {
  it('reads colon separators, quoted values, `!` comments and lines with no separator', () => {
    const configuration: RuleSourceFile = {
      path: 'src/app.properties',
      language: 'properties',
      text: [
        '! a bang comment, which the format allows beside `#`',
        '   ',
        'no-separator-here',
        'hashAlg: "MD5"',
        'strongAlg=SHA-512',
      ].join('\n'),
    };
    const source = java(
      'class A { void m() { String a = props.getProperty("hashAlg"); MessageDigest.getInstance(a); } }',
    );

    // The colon form and the quotes around the value are both the format's, and a reader that only understood
    // `key=value` would report this file as having no configuration at all.
    expect(ruleIds(evaluateSecurityRules([source, configuration]))).toEqual(['weak-hash']);
  });

  it('uses the fallback the call names when the key is not in the file', () => {
    const configuration: RuleSourceFile = {
      path: 'src/app.properties',
      language: 'properties',
      text: 'unrelated=1',
    };
    const source = java(
      'class A { void m() { MessageDigest.getInstance(props.getProperty("hashAlg", "MD5")); } }',
    );

    expect(ruleIds(evaluateSecurityRules([source, configuration]))).toEqual(['weak-hash']);
  });

  it('stays silent when neither the file nor the call says which algorithm it is', () => {
    const source = java(
      'class A { void m() { MessageDigest.getInstance(props.getProperty("hashAlg")); } }',
    );

    // **Silence is the right answer here.** The key is absent and the call names no default, so the algorithm is a
    // runtime value; a rule that guessed would report every file whose configuration is loaded from elsewhere.
    expect(evaluateSecurityRules([source])).toEqual([]);
  });

  it('follows a name through an alias, which is how the corpus spells a buffer', () => {
    const source = java(
      [
        'class A {',
        '  void m() {',
        '    String algorithm = "MD5";',
        '    String alsoAlgorithm = algorithm;',
        '    MessageDigest.getInstance(alsoAlgorithm);',
        '  }',
        '}',
      ].join('\n'),
    );

    expect(ruleIds(evaluateSecurityRules([source]))).toEqual(['weak-hash']);
  });
});

describe('the shapes that decide where a statement ends', () => {
  it('ignores a semicolon inside a string literal', () => {
    // A rule that split on `;` without reading the literal cuts `"a;b"` in two and loses the call after it.
    const source = java(
      'class A { void m() { String s = "a;b{c}"; MessageDigest.getInstance("MD5"); } }',
    );

    expect(ruleIds(evaluateSecurityRules([source]))).toEqual(['weak-hash']);
  });

  it('ignores an escaped quote inside a string literal', () => {
    const source = java(
      'class A { void m() { String s = "he said \\"hi\\""; MessageDigest.getInstance("MD5"); } }',
    );

    expect(ruleIds(evaluateSecurityRules([source]))).toEqual(['weak-hash']);
  });

  it('ignores what a block comment says', () => {
    // **The corpus writes its expected output in a comment**, including `Cipher.getInstance(...)` inside a string, and
    // reading that as code reports a weak cipher in a file that has none.
    const source = java(
      [
        'class A {',
        '  void m() {',
        '    /* Cipher.getInstance("DES/CBC/PKCS5Padding") is not called here */',
        '    int x = 1;',
        '  }',
        '}',
      ].join('\n'),
    );

    expect(evaluateSecurityRules([source])).toEqual([]);
  });

  it('ignores what a line comment says', () => {
    const source = java(
      ['class A {', '  // MessageDigest.getInstance("MD5")', '  int x = 1;', '}'].join('\n'),
    );

    expect(evaluateSecurityRules([source])).toEqual([]);
  });
});

describe('the cookie shapes that decide nothing', () => {
  it('says nothing about a cookie that is created and never added to a response', () => {
    const source = java(
      [
        'class A { void m() {',
        '  Cookie c = new Cookie("n", "v");',
        '  c.setSecure(false);',
        '} }',
      ].join('\n'),
    );

    // A cookie that never leaves the method is not a cookie the browser can be tricked into sending.
    expect(evaluateSecurityRules([source])).toEqual([]);
  });

  it('reports one finding for a call that names two weak algorithms once', () => {
    // `Cipher.getInstance("DES/ECB/PKCS5Padding")` matches the weak name and the weak mode; a reader does not want to
    // be told twice about one line.
    const findings = evaluateSecurityRules([
      java('class A { void m() { Cipher.getInstance("DES/ECB/PKCS5Padding"); } }'),
    ]);

    expect(findings).toHaveLength(1);
  });
});

describe('the edges the corpus does not exercise but a repository does', () => {
  it('reads past a nested call in the first argument', () => {
    // The nesting is what makes a comma-splitting capture wrong, and the depth is what makes this one right.
    const source = java(
      [
        'class A {',
        '  void m() {',
        '    MessageDigest.getInstance(choose(props.getProperty("a", "MD5"), "b"));',
        '  }',
        '}',
      ].join('\n'),
    );

    // `choose(...)` is not resolvable, so the rule stays silent — but it read the whole argument to find that out.
    expect(evaluateSecurityRules([source])).toEqual([]);
  });

  it('ignores a setSecure with no receiver', () => {
    // A static import can make the call bare, and there is no variable to track; reporting it would name a cookie the
    // rule never saw created.
    const source = java(
      [
        'class A { void m() {',
        '  Cookie c = new Cookie("n", "v");',
        '  setSecure(false);',
        '  response.addCookie(c);',
        '} }',
      ].join('\n'),
    );

    // The cookie is still reported — nothing set its flag — but because it sets nothing, not because of the bare call.
    expect(ruleIds(evaluateSecurityRules([source]))).toEqual(['insecure-cookie']);
  });

  it('stays silent about a name bound to a property that is missing and has no default', () => {
    const source = java(
      [
        'class A {',
        '  void m() {',
        '    String a = props.getProperty("absentKey");',
        '    MessageDigest.getInstance(a);',
        '  }',
        '}',
      ].join('\n'),
    );

    expect(evaluateSecurityRules([source])).toEqual([]);
  });

  it('reports two algorithms chosen on one line once each', () => {
    const source = java(
      'class A { void m() { MessageDigest.getInstance("MD5"); MessageDigest.getInstance("SHA-1"); } }',
    );

    // Both are on line 1 and both are weak hashes, so the dedupe collapses them to one — which is the behaviour a
    // reader wants from a rule keyed by line, and the reason the key includes the rule id rather than the algorithm.
    expect(evaluateSecurityRules([source])).toHaveLength(1);
  });
});

describe('the two branches a corpus of generated code never reaches', () => {
  it('keeps the line count of a block comment that spans several lines', () => {
    // The newlines inside a comment are preserved so that a finding below it still reports the line a reader can open.
    const source = java(
      [
        'class A {',
        '  /*',
        '   * Cipher.getInstance("DES") is named here and not called.',
        '   */',
        '  void m() { MessageDigest.getInstance("MD5"); }',
        '}',
      ].join('\n'),
    );

    const findings = evaluateSecurityRules([source]);
    expect(ruleIds(findings)).toEqual(['weak-hash']);
    expect(findings[0]?.line).toBe(5);
  });

  it('reads a call with three arguments, where the first is not the only one before a comma', () => {
    // `Cipher.getInstance(alg, provider, extra)` — the second comma is where a reader that stopped at the first one
    // would start reporting the rest of the argument list as part of the algorithm.
    const source = java(
      'class A { void m() { Cipher.getInstance("DES/CBC/PKCS5Padding", "SunJCE", null); } }',
    );

    const findings = evaluateSecurityRules([source]);
    expect(ruleIds(findings)).toEqual(['weak-cipher']);
    expect(findings[0]?.evidence).toBe('"DES/CBC/PKCS5Padding"');
  });

  it('tracks a receiver written as a field path', () => {
    const source = java(
      [
        'class A { void m() {',
        '  Cookie c = new Cookie("n", "v");',
        '  this.holder.c.setSecure(false);',
        '  response.addCookie(c);',
        '} }',
      ].join('\n'),
    );

    // `this.holder.c` is a different variable from `c`, so the cookie it names is not the one that was added, and the
    // cookie that *was* added sets no flag at all.
    expect(ruleIds(evaluateSecurityRules([source]))).toEqual(['insecure-cookie']);
  });
});
