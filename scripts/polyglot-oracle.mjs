#!/usr/bin/env node
// Ground truth for the symbol index, read by a parser that is not this repository's lexer.
//
// **Why a second implementation exists.** §87 and §89 widened `symbols-langs.ts` from one language to ten and added three
// document readers. A test asserts what each scanner does with a hand-written file; **that is a test of the scanner
// against the author's memory of the language**, and the memory is the thing that can be wrong. This script reads the
// same file with a grammar written by somebody else - tree-sitter for the code, `ElementTree` and `PyYAML` for the two
// documents it has no grammar for - and answers the one question both implementations can be asked: **which names does
// this file declare at its top level.**
//
// **What it refuses to assert.** It does not compare ranges, kinds or exports: those are three more answers this
// repository's lexer gives and a grammar computes differently (a grammar knows a class ends at its brace, a lexer with
// `uncertain` says so at the file's end). **A name is the fact both of them are trying to establish**, and a name the
// grammar found and the lexer did not is a miss by whichever of the two is wrong.
//
// Usage:
//   node scripts/polyglot-oracle.mjs --file <path> --language <name>
//   node scripts/polyglot-oracle.mjs --dump <path> --language <name>   (node types, for building the table)

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
/** This repository's root, so a grammar that only the analyzer package installs can still be found. */
const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** Where the grammar for a language lives, relative to this repository. */
const GRAMMAR = {
  java: { module: 'tree-sitter-java', grammar: null },
  javascript: { module: 'tree-sitter-javascript', grammar: null },
  typescript: { module: 'tree-sitter-typescript', grammar: 'typescript' },
  arkts: { module: 'tree-sitter-arkts', grammar: null, nested: true },
  python: { module: 'tree-sitter-python', grammar: null },
  kotlin: { module: 'tree-sitter-kotlin', grammar: null },
  swift: { module: 'tree-sitter-swift', grammar: null },
  groovy: { module: 'tree-sitter-groovy', grammar: null, nested: true },
  json: { module: 'tree-sitter-json', grammar: null },
};

/**
 * **The node types that declare a name, per language.**
 *
 * Written as a suffix rule rather than a table per language, because every grammar here spells a declaration
 * `<something>_declaration` and **the exceptions are the interesting part**: TypeScript's `export const LIMIT = 10` is a
 * `lexical_declaration` around a `variable_declarator`, and JSON's keys are `pair`s.
 */
const NAMED_SUFFIX = /_(?:declaration|definition|declarator)$/u;

/**
 * **The declarations that name a file's neighbours rather than a declaration of its own.** `package matrix` and
 * `import Foundation` are `_declaration` nodes with a `name`, and counting them scored two phantom misses that were
 * really two names the lexer was right not to claim - a package is not something the file declares.
 */
const NOT_A_DECLARATION = /^(?:package|import|using|module|namespace)_/u;

/** The nodes a declaration can be wrapped in, which are walked through rather than counted. */
const WRAPPERS = new Set([
  'program',
  // **Kotlin, Swift and Groovy name the root `source_file`**, and a walker that only knew `program` answered every one of
  // them with an empty list - which a comparison would have read as "the lexer found everything".
  'source_file',
  'export_statement',
  'decorated_definition',
  'declaration_list',
]);

function grammarFor(language) {
  const entry = GRAMMAR[language];
  if (entry === undefined) return null;
  const base = entry.nested
    ? `${ROOT}packages/analyzer/node_modules/${entry.module}`
    : entry.module;
  const loaded = require(base);
  return entry.grammar === null ? loaded : loaded[entry.grammar];
}

function loadParser() {
  const Parser = require('tree-sitter');
  return new Parser();
}

/**
 * **The name a declaration node declares**, which is a field in most grammars and a positional fact in two of them.
 *
 * tree-sitter-kotlin and tree-sitter-swift expose no `name` field, and **the identifier is not simply the first one**: an
 * extension function `fun String.shout()` writes its receiver first, so the callee is the identifier the parameter list
 * follows. That rule is used where the field is missing, because a comparison against the wrong name would be a
 * disagreement about the oracle rather than about the lexer.
 */
function nameOf(node) {
  const named = node.childForFieldName?.('name');
  if (named !== null && named !== undefined) return named.text;
  const children = node.namedChildren;
  for (let at = 0; at < children.length; at += 1) {
    const next = children[at + 1];
    if (next !== undefined && next.type === 'function_value_parameters') return children[at].text;
  }
  for (const child of children) {
    if (/^(?:simple_identifier|type_identifier|identifier)$/u.test(child.type)) return child.text;
  }
  return null;
}

function isDeclarationNode(node) {
  if (!NAMED_SUFFIX.test(node.type)) return false;
  if (NOT_A_DECLARATION.test(node.type)) return false;
  return nameOf(node) !== null;
}

function collect(node, out) {
  for (const child of node.namedChildren) {
    if (WRAPPERS.has(child.type)) {
      collect(child, out);
      continue;
    }
    if (child.type === 'lexical_declaration' || child.type === 'variable_declaration') {
      for (const declarator of child.namedChildren) {
        if (declarator.type !== 'variable_declarator') continue;
        const name = declarator.childForFieldName('name');
        if (name !== null) out.push(name.text);
        // **A Kotlin `val` declares through `property_declaration`**, which is a declaration node and is handled below.
      }
      continue;
    }
    // **A module-level constant is a declaration Python writes as an assignment**, and a grammar has no word for it: the
    // four names this oracle missed on `callgraph-oracle.py` were `BUILTIN_NAMES` and its three neighbours, which the
    // comparison first read as four names the lexer had invented.
    if (child.type === 'expression_statement') {
      const assignment = child.namedChildren.find((node) => node.type === 'assignment');
      const left = assignment?.childForFieldName('left');
      if (left !== undefined && left !== null && left.type === 'identifier') out.push(left.text);
      continue;
    }
    if (isDeclarationNode(child)) {
      out.push(nameOf(child));
      continue;
    }
    // **A decorated declaration holds its declaration one level in**, and the decorator itself declares nothing.
    if (child.type.includes('decorated') || child.type.includes('annotation')) collect(child, out);
  }
}

function jsonKeys(text) {
  const parser = loadParser();
  parser.setLanguage(grammarFor('json'));
  const tree = parser.parse(text);
  const names = [];
  const walk = (node) => {
    for (const child of node.namedChildren) {
      if (child.type === 'pair') {
        const key = child.childForFieldName('key');
        if (key !== null && key.text.startsWith('"')) names.push(JSON.parse(key.text));
      }
      walk(child);
    }
  };
  walk(tree.rootNode);
  return names;
}

/** The two documents with no grammar here, read by Python's own libraries. */
function documentsViaPython(file, language) {
  const program =
    language === 'yaml'
      ? [
          'import sys, yaml, json',
          'seen = []',
          'def walk(node):',
          '    if isinstance(node, dict):',
          '        for key, value in node.items():',
          '            seen.append(str(key))',
          '            walk(value)',
          '    elif isinstance(node, list):',
          '        for item in node:',
          '            walk(item)',
          // **`BaseLoader` leaves every scalar as the text the file wrote**, which is what a key is: `safe_load` reads an
          // unquoted `on:` as the boolean `True`, because YAML 1.1 said so and every CI file since has disagreed.
          'walk(yaml.load(open(sys.argv[1], encoding="utf-8"), Loader=yaml.BaseLoader))',
          'print(json.dumps(seen))',
        ].join('\n')
      : [
          'import sys, json, xml.etree.ElementTree as ET',
          'seen = []',
          'root = ET.parse(sys.argv[1]).getroot()',
          'def walk(element):',
          // **ElementTree rewrites a namespaced tag to `{uri}tag`**, which is how it stores the name rather than what the
          // file says; the tag a reader sees is the local part, and comparing against the URI would score every element
          // of a Maven pom as missing.
          '    seen.append(element.tag.rsplit("}", 1)[-1])',
          '    for child in element:',
          '        walk(child)',
          'walk(root)',
          'print(json.dumps(seen))',
        ].join('\n');
  const out = execFileSync('python3', ['-c', program, file], { encoding: 'utf8' });
  return JSON.parse(out);
}

export function declarations(file, language) {
  const text = readFileSync(file, 'utf8');
  if (language === 'yaml' || language === 'xml') return documentsViaPython(file, language);
  if (language === 'json') return jsonKeys(text);
  const grammar = grammarFor(language);
  if (grammar === null) return null;
  const parser = loadParser();
  parser.setLanguage(grammar);
  const tree = parser.parse(text);
  const names = [];
  collect(tree.rootNode, names);
  return names;
}

const invokedDirectly = process.argv[1] === fileURLToPath(import.meta.url);
const args = invokedDirectly ? process.argv.slice(2) : [];
const file = args.includes('--dump')
  ? args[args.indexOf('--dump') + 1]
  : args[args.indexOf('--file') + 1];
const language = args[args.indexOf('--language') + 1];
if (!invokedDirectly) {
  // Imported by `polyglot-bench.ts`, which does the comparing; the command line below is for reading one file by hand.
} else if (args.includes('--dump')) {
  const parser = loadParser();
  parser.setLanguage(grammarFor(language));
  const tree = parser.parse(readFileSync(file, 'utf8'));
  const seen = new Set();
  const walk = (node, depth) => {
    if (depth < 3) seen.add(`${'  '.repeat(depth)}${node.type}`);
    for (const child of node.namedChildren) walk(child, depth + 1);
  };
  walk(tree.rootNode, 0);
  console.log([...seen].join('\n'));
} else {
  console.log(JSON.stringify(declarations(file, language)));
}
