/**
 * **A schema that points at a schema is the only edge an XML, JSON or YAML corpus has, and the index read none of them.**
 *
 * The document languages were added to this index as *symbol* languages - a `.json` declares its keys, an `.xml` declares
 * its elements - and **a symbol layer with no edge layer is half an index**: an OpenAPI document that `$ref`s forty
 * component files, a JSON Schema whose `allOf` names a file, and an XSD whose `xsd:include` pastes a type library are
 * three corpora where **every file has an edge and every edge was answered zero**.
 *
 * **The three forms, and each is a language's own rule.**
 *
 * - **XML** writes `schemaLocation` on `xsd:import`, `xsd:include` and `xsd:redefine`, and the value is a URI. A relative
 *   one is a path in this repository; an absolute one is the W3C's namespace document and is not.
 * - **JSON** writes `"$ref": "./defs.json#/definitions/User"`, and **the fragment is not part of the file** - a resolver
 *   that kept it would look for a file whose name contains a `#`.
 * - **YAML** writes the same key with an unquoted scalar, which is why it needs its own pattern rather than the JSON one.
 *
 * **What is refused, and why each refusal is a fact rather than an omission.** A `$ref` of `#/definitions/User` points
 * inside its own document and crosses no file; an absolute `https://` URI is somebody else's repository. **And a
 * reference that crosses a file without naming a declaration makes no symbol edge** - the same refusal `import * as ns`
 * gets, for the same reason: nothing in the importing file says which name crosses.
 */

import { describe, expect, it } from 'vitest';

import { readDocumentRefs, resolveDocumentRef } from '../imports-langs.js';
import { buildRepoIndex } from '../repo-index.js';

import type { RepoFile } from '../repo-index.js';

describe('the references a document writes', () => {
  it('are schemaLocation in the three XSD directives, and the file the URI names', () => {
    const lines = [
      '<?xml version="1.0"?>',
      '<xsd:schema xmlns:xsd="http://www.w3.org/2001/XMLSchema">',
      '  <xsd:import namespace="urn:common" schemaLocation="common/types.xsd"/>',
      '  <xsd:include schemaLocation="base.xsd"/>',
      '  <xsd:redefine schemaLocation="redef/old.xsd"/>',
      '</xsd:schema>',
    ];
    const refs = readDocumentRefs('xml', lines);
    expect(refs.map((ref) => ref.specifier)).toEqual([
      'common/types.xsd',
      'base.xsd',
      'redef/old.xsd',
    ]);
    expect(refs.every((ref) => ref.kind === 'file')).toBe(true);
    expect(refs[1]).toMatchObject({ startLine: 4 });
  });

  it('are not read out of an XML comment, which is the shape a schema documents itself in', () => {
    const lines = [
      '<xsd:schema>',
      '  <!-- <xsd:include schemaLocation="commented-out.xsd"/> -->',
      '  <xsd:include schemaLocation="kept.xsd"/>',
      '</xsd:schema>',
    ];
    expect(readDocumentRefs('xml', lines).map((ref) => ref.specifier)).toEqual(['kept.xsd']);
  });

  it('are $ref in JSON, with the fragment dropped because a fragment is not a file', () => {
    const lines = [
      '{',
      '  "properties": {',
      '    "user": { "$ref": "./schemas/user.json#/definitions/User" },',
      '    "self": { "$ref": "#/definitions/Local" },',
      '    "remote": { "$ref": "https://example.test/common.json" }',
      '  }',
      '}',
    ];
    const refs = readDocumentRefs('json', lines);
    expect(refs.map((ref) => ref.specifier)).toEqual([
      './schemas/user.json',
      'https://example.test/common.json',
    ]);
    // **A local pointer crosses no file**, so it is not a statement at all rather than a refusal to report.
    expect(refs.some((ref) => ref.specifier.startsWith('#'))).toBe(false);
    expect(refs.map((ref) => ref.kind)).toEqual(['file', 'module']);
  });

  it('are $ref in YAML, where the scalar is usually not quoted', () => {
    const lines = [
      'paths:',
      '  /users:',
      '    get:',
      '      responses:',
      "        '200':",
      '          $ref: ./components/responses.yaml#/Users',
      '          other:',
      '            $ref: "remote.yaml#/X"',
    ];
    expect(readDocumentRefs('yaml', lines).map((ref) => ref.specifier)).toEqual([
      './components/responses.yaml',
      'remote.yaml',
    ]);
  });

  it('are answered by the file they name, and make no symbol edge because no name crosses', () => {
    const files: readonly RepoFile[] = [
      {
        path: 'api/openapi.json',
        text: ['{', '  "user": { "$ref": "./schemas/user.json" }', '}'].join('\n'),
      },
      { path: 'api/schemas/user.json', text: ['{', '  "name": "User"', '}'].join('\n') },
    ];
    const index = buildRepoIndex(files);
    const statement = index.imports.find((row) => row.specifier === './schemas/user.json');
    expect(statement).toMatchObject({
      fromPath: 'api/openapi.json',
      target: 'api/schemas/user.json',
      why: 'resolved',
    });
    // **The resolution is the fact a review needs** - *this schema is read by that document* - and the edge count is
    // unchanged, because a key named `name` is not a declaration another file can spell.
    expect(index.stats.edges).toBe(0);
  });

  it('are missing when the file is not in this repository, and that is reported rather than dropped', () => {
    const files: readonly RepoFile[] = [
      { path: 'api/openapi.json', text: '{ "$ref": "./schemas/absent.json" }' },
    ];
    const index = buildRepoIndex(files);
    expect(index.unresolved).toEqual([
      { fromPath: 'api/openapi.json', line: 1, specifier: './schemas/absent.json', why: 'missing' },
    ]);
  });
});

/**
 * **The three refusals the document reader makes, each with a case**, because a reader that reported a refusal as a miss
 * would attribute a defect to a repository over its own dependencies.
 */
describe('a document reference the reader declines', () => {
  it('is not read out of a comment that spans several lines', () => {
    const lines = [
      '<xsd:schema>',
      '  <!--',
      '  <xsd:include schemaLocation="gone.xsd"/>',
      '  -->',
      '  <xsd:include schemaLocation="kept.xsd"/>',
      '</xsd:schema>',
    ];
    expect(readDocumentRefs('xml', lines).map((ref) => ref.specifier)).toEqual(['kept.xsd']);
  });

  it('is nothing at all for a language that writes no references', () => {
    // **Python has no document reference form**, and answering one would be a reader inventing a syntax.
    expect(readDocumentRefs('python', ['import os'])).toEqual([]);
  });

  it('drops a JSON pointer that names its own document, and keeps an absolute path as a path', () => {
    const lines = ['{ "a": { "$ref": "#/b" }, "c": { "$ref": "/schemas/x.json" } }'];
    const refs = readDocumentRefs('json', lines);
    expect(refs.map((ref) => ref.specifier)).toEqual(['/schemas/x.json']);
    // **A leading slash is a path from the root of this repository**, not a URI: it names a file only if the file is here.
    expect(refs[0]!.kind).toBe('module');
  });
});

describe('a document reference the index answers', () => {
  it('is external when it names a URI rather than a file, and the refusal is reported as one', () => {
    const files: readonly RepoFile[] = [
      {
        path: 'api/openapi.json',
        text: ['{', '  "a": { "$ref": "https://example.test/x.json" }', '}'].join('\n'),
      },
    ];
    const index = buildRepoIndex(files);
    expect(index.imports[0]?.why).toBe('external');
    expect(index.stats.externalImports).toBe(1);
  });

  it('resolves a leading slash from the root of the repository, and refuses a URI at the resolver', () => {
    expect(resolveDocumentRef('/api/x.json', 'api/y.json', new Set(['api/x.json']))).toBe(
      'api/x.json',
    );
    // **The resolver refuses a scheme even though the reader has already classified it**, because two readers that
    // disagreed about what a URI is would be two answers to one question.
    expect(resolveDocumentRef('https://example.test/x.json', 'api/y.json', new Set())).toBeNull();
  });
});
