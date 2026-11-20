/**
 * **An XSD has three ways to name another document and this reader knew one of them.**
 *
 * §103 taught the index that a document's only edge is a document named by a document, and implemented `schemaLocation`
 * — the attribute `xsd:import`, `xsd:include` and `xsd:redefine` write. §103.5 then published the gap beside the
 * language: **`xi:include`'s `href` and a `<!DOCTYPE … SYSTEM>` are not read.** Both are older than XML Schema and both
 * are how a document corpus actually splits itself:
 *
 * - **XInclude** is the W3C's language-neutral inclusion: `<xi:include href="chapter1.xml"/>` pastes a document into
 *   another, and a corpus that ships one chapter per file has **every edge in `href`** and none in `schemaLocation`.
 * - **A DOCTYPE with `SYSTEM`** is the pre-namespace form: `<!DOCTYPE book SYSTEM "book.dtd">`. A DTD is a document that
 *   declares the elements the XML uses, so the edge is the same kind of edge.
 *
 * **What is still refused, and it is a fact rather than an omission.** A `PUBLIC` identifier names a DTD in a catalogue
 * rather than a path, so `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0//EN" "http://…">` has a *system* literal that is
 * an absolute URL and resolves to nothing here — the same refusal an absolute `schemaLocation` already got. And an
 * `href` whose element is not `include` (an `xsl:include` is *also* an include, an `xml:base` is not) is not read,
 * because the attribute alone does not say a document is included.
 */

import { describe, expect, it } from 'vitest';

import { readDocumentRefs } from '../imports-langs.js';
import { buildRepoIndex } from '../repo-index.js';

import type { RepoFile } from '../repo-index.js';

describe('the documents an XML document names', () => {
  it('are read out of an XInclude href, which is the form a split corpus writes', () => {
    const lines = [
      '<book xmlns:xi="http://www.w3.org/2001/XInclude">',
      '  <xi:include href="chapter1.xml"/>',
      '  <xi:include href="chapter2.xml" parse="xml"/>',
      '</book>',
    ];
    expect(readDocumentRefs('xml', lines).map((ref) => ref.specifier)).toEqual([
      'chapter1.xml',
      'chapter2.xml',
    ]);
  });

  it('are read out of a DOCTYPE SYSTEM literal, and not out of a PUBLIC one', () => {
    const system = ['<!DOCTYPE book SYSTEM "book.dtd">', '<book/>'];
    expect(readDocumentRefs('xml', system).map((ref) => ref.specifier)).toEqual(['book.dtd']);
    const publicId = [
      '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0//EN" "https://www.w3.org/TR/xhtml1/xhtml1.dtd">',
      '<html/>',
    ];
    // **The URL is somebody else's repository**, so it is `module` rather than `file` - which is the refusal the kind
    // already carries, and the reason the DOCTYPE reader does not need a rule of its own about catalogues.
    const refs = readDocumentRefs('xml', publicId);
    expect(refs.map((ref) => ref.specifier)).toEqual([
      'https://www.w3.org/TR/xhtml1/xhtml1.dtd',
    ]);
    expect(refs[0]!.kind).toBe('module');
  });

  it('are not read out of an element that is not an include, because an attribute alone does not include anything', () => {
    const lines = [
      '<xsl:stylesheet xmlns:xsl="http://www.w3.org/1999/XSL/Transform">',
      '  <xsl:template match="a" href="not-an-include.xml"/>',
      '  <link href="style.css"/>',
      '</xsl:stylesheet>',
    ];
    expect(readDocumentRefs('xml', lines)).toEqual([]);
  });

  it('are read out of an include whose prefix is bound to XInclude under another name', () => {
    // **The prefix is the file's choice**, so the reader matches the local name and the namespace prefix's presence
    // rather than the string `xi:` - a corpus that writes `xmlns:x="http://www.w3.org/2001/XInclude"` and `<x:include>`
    // is the same document.
    const lines = [
      '<book xmlns:x="http://www.w3.org/2001/XInclude">',
      '  <x:include href="chapter1.xml"/>',
      '</book>',
    ];
    expect(readDocumentRefs('xml', lines).map((ref) => ref.specifier)).toEqual(['chapter1.xml']);
  });
});

describe('the edge an XInclude makes', () => {
  it('crosses to the file the href names, which is what a corpus split per chapter has instead of imports', () => {
    const files: RepoFile[] = [
      {
        path: 'book/book.xml',
        text: ['<book>', '  <xi:include href="chapter1.xml"/>', '</book>'].join('\n'),
      },
      {
        path: 'book/book.dtd',
        text: '<!ELEMENT book (chapter*)>\n',
      },
      {
        path: 'book/chapter1.xml',
        text: '<chapter/>\n',
      },
    ];
    const index = buildRepoIndex(files, {});
    const targets = index.imports
      .filter((statement) => statement.fromPath === 'book/book.xml')
      .map((statement) => statement.target);
    expect(targets).toEqual(['book/chapter1.xml']);
  });
});
