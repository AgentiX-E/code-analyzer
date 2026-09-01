// @code-analyzer/intelligence — Type Registry Branch Coverage (round 3)
// Reaches the remaining uncovered branch paths in type-registry.ts:
//   * registerFunction duplicate short-name bucket reuse
//   * registerFunction duplicate method bucket reuse
//   * resolveTypeWithImports namespace-import mismatch on the first map entry
//   * createPerFileOverlay non-function (type) registration path
//   * createPerFileOverlay Method label (second operand of the || guard)
//   * createPerFileOverlay optional-field fallbacks (returnTypes / paramCount /
//     paramTypes / isAsync) and resolvedType ?? fallback

import { describe, it, expect } from 'vitest';
import {
  TypeRegistry,
  createPerFileOverlay,
  type RegisteredType,
  type RegisteredFunction,
  type FileDefinition,
} from '../lsp/type-registry.js';
import { t } from '../lsp/type-rep.js';

function makeFunc(qn: string, shortName: string, receiverType?: string): RegisteredFunction {
  return {
    qn,
    shortName,
    label: receiverType ? 'Method' : 'Function',
    receiverType,
    moduleQn: 'proj',
    returnTypes: 'void',
    paramCount: 0,
    paramTypes: '',
    isAsync: false,
    language: 'typescript',
    sourceFile: 'src/a.ts',
    sourceLine: 1,
  };
}

describe('TypeRegistry — registerFunction duplicate buckets', () => {
  it('reuses the short-name bucket when registering a second function with the same shortName', () => {
    const registry = new TypeRegistry();
    registry.registerFunction(makeFunc('proj.a.fn', 'fn'));
    registry.registerFunction(makeFunc('proj.b.fn', 'fn'));

    expect(registry.functionCount).toBe(2);
    const byName = registry.lookupFunctionByName('fn');
    expect(byName.length).toBe(2);
    expect(byName.map((f) => f.qn).sort()).toEqual(['proj.a.fn', 'proj.b.fn']);
  });

  it('reuses the method bucket when registering a second method with the same receiver last name and shortName', () => {
    const registry = new TypeRegistry();
    registry.registerFunction(makeFunc('proj.a.User.login', 'login', 'proj.User'));
    registry.registerFunction(makeFunc('other.b.User.login', 'login', 'other.User'));

    // Both methods share the same receiver last name ("User") and method name
    // ("login"), so they hash to the same methodIndex key and the second
    // registration reuses the existing bucket.
    const methods = registry.lookupMethod('User', 'login');
    expect(methods.length).toBe(2);
    expect(methods.map((f) => f.qn).sort()).toEqual(['other.b.User.login', 'proj.a.User.login']);
  });
});

// NOTE: the `lookupMethod` receiver-mismatch guard at type-registry.ts line
// ~257 (`if (func.receiverType && extractLastName(func.receiverType) ===
// receiverShortName)`) is a defense against fnv1a hash collisions. Because the
// methodIndex key is derived from the receiver's last name, any normal lookup
// that reaches a bucket will always satisfy the equality check, so the false
// path is only reachable via an actual fnv1a collision. Constructing a genuine
// collision is impractical for a unit test; this guard is left in place (it is
// a legitimate correctness defense, not dead code). The other branches below
// push per-file coverage above 95% without it.

describe('TypeRegistry — resolveTypeWithImports namespace-import mismatch', () => {
  it('skips a non-matching first import entry and resolves via a later entry', () => {
    const registry = new TypeRegistry();
    registry.registerType({
      qn: 'proj.mod.Type',
      shortName: 'Type',
      label: 'Class',
      moduleQn: 'proj.mod',
      type: t.named('Type'),
      language: 'typescript',
      sourceFile: 'src/a.ts',
      sourceLine: 1,
    });

    // The first entry ("Other") does not prefix-match "Lib.Type", exercising
    // the false path of the startsWith guard; the second entry resolves it.
    const imports = new Map([
      ['Other', 'proj.other'],
      ['Lib', 'proj.mod'],
    ]);
    expect(registry.resolveTypeWithImports('Lib.Type', imports)?.qn).toBe('proj.mod.Type');
  });
});

describe('TypeRegistry — createPerFileOverlay type path and fallbacks', () => {
  it('registers a non-function def through the type-registration path', () => {
    const base = new TypeRegistry();
    const own: FileDefinition[] = [
      {
        qn: 'proj.Thing',
        shortName: 'Thing',
        label: 'Class',
        moduleQn: 'proj',
        language: 'typescript',
        sourceFile: 'src/a.ts',
        sourceLine: 1,
        // resolvedType omitted on purpose
      },
    ];

    const { overlay } = createPerFileOverlay(base, own, []);

    expect(overlay.typeCount).toBe(1);
    expect(overlay.lookupType('proj.Thing')?.shortName).toBe('Thing');
    expect(overlay.lookupType('proj.Thing')?.type.kind).toBe('unknown');
  });

  it('registers a Method def and applies the optional-field fallbacks', () => {
    const base = new TypeRegistry();
    const own: FileDefinition[] = [
      {
        qn: 'proj.User.login',
        shortName: 'login',
        label: 'Method',
        moduleQn: 'proj',
        receiverType: 'proj.User',
        language: 'typescript',
        sourceFile: 'src/a.ts',
        sourceLine: 1,
        // returnTypes / paramCount / paramTypes / isAsync omitted on purpose
      },
    ];

    const { overlay } = createPerFileOverlay(base, own, []);

    const fn = overlay.lookupFunction('proj.User.login');
    expect(fn).not.toBeNull();
    expect(fn?.returnTypes).toBe('unknown');
    expect(fn?.paramCount).toBe(0);
    expect(fn?.paramTypes).toBe('');
    expect(fn?.isAsync).toBe(false);
  });

  it('covers both the explicit and fallback resolvedType paths', () => {
    const base = new TypeRegistry();
    const own: FileDefinition[] = [
      {
        qn: 'proj.A',
        shortName: 'A',
        label: 'Class',
        moduleQn: 'proj',
        language: 'typescript',
        sourceFile: 'src/a.ts',
        sourceLine: 1,
        // resolvedType omitted -> fallback { kind: 'unknown' }
      },
      {
        qn: 'proj.B',
        shortName: 'B',
        label: 'Interface',
        moduleQn: 'proj',
        resolvedType: t.named('B'),
        language: 'typescript',
        sourceFile: 'src/a.ts',
        sourceLine: 1,
      },
    ];

    const { overlay } = createPerFileOverlay(base, own, []);

    expect(overlay.lookupType('proj.A')?.type.kind).toBe('unknown');
    expect(overlay.lookupType('proj.B')?.type.kind).toBe('named');
  });
});
