// @code-analyzer/shared — Type Guard & Enum Tests
import { describe, it, expect } from 'vitest';

import {
  NODE_LABELS,
  RELATIONSHIP_TYPES,
  PIPELINE_PHASE_IDS,
  SUPPORTED_LANGUAGES,
  REVIEW_CATEGORIES,
  SEVERITY_LEVELS,
  RISK_LEVELS,
  ERROR_CATEGORIES,
  CAPTURE_TAGS,
  isNodeLabel,
  isRelationshipType,
  getLanguageFromFilename,
} from '../index.js';

// ---------------------------------------------------------------------------
// Node Labels
// ---------------------------------------------------------------------------

describe('NodeLabel', () => {
  it('has exactly the expected number of labels', () => {
    expect(NODE_LABELS).toHaveLength(33);
  });

  it.each(NODE_LABELS)('isNodeLabel("%s") returns true', (label) => {
    expect(isNodeLabel(label)).toBe(true);
  });

  it('isNodeLabel rejects invalid values', () => {
    expect(isNodeLabel('')).toBe(false);
    expect(isNodeLabel('nonexistent')).toBe(false);
    expect(isNodeLabel('CLASS')).toBe(false);
    expect(isNodeLabel(123 as unknown as string)).toBe(false);
    expect(isNodeLabel(null as unknown as string)).toBe(false);
    expect(isNodeLabel(undefined as unknown as string)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Relationship Types
// ---------------------------------------------------------------------------

describe('RelationshipType', () => {
  it('has exactly the expected number of types', () => {
    expect(RELATIONSHIP_TYPES).toHaveLength(39);
  });

  it.each(RELATIONSHIP_TYPES)('isRelationshipType("%s") returns true', (type) => {
    expect(isRelationshipType(type)).toBe(true);
  });

  it('isRelationshipType rejects invalid values', () => {
    expect(isRelationshipType('')).toBe(false);
    expect(isRelationshipType('UNKNOWN')).toBe(false);
    expect(isRelationshipType('calls')).toBe(false);
    expect(isRelationshipType(0 as unknown as string)).toBe(false);
    expect(isRelationshipType(null as unknown as string)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Pipeline Phase IDs
// ---------------------------------------------------------------------------

describe('PipelinePhaseId', () => {
  it('has exactly the expected number of phases', () => {
    expect(PIPELINE_PHASE_IDS).toHaveLength(18);
  });

  it('contains the core pipeline phases', () => {
    expect(PIPELINE_PHASE_IDS).toContain('scan');
    expect(PIPELINE_PHASE_IDS).toContain('parse');
    expect(PIPELINE_PHASE_IDS).toContain('crossFile');
    expect(PIPELINE_PHASE_IDS).toContain('scopeResolution');
    expect(PIPELINE_PHASE_IDS).toContain('embed');
  });

  it('every phase ID is a non-empty string', () => {
    for (const id of PIPELINE_PHASE_IDS) {
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Supported Languages
// ---------------------------------------------------------------------------

describe('SupportedLanguage', () => {
  it('has the expected number of languages', () => {
    expect(SUPPORTED_LANGUAGES).toHaveLength(18);
  });

  it('includes TypeScript first (primary priority)', () => {
    expect(SUPPORTED_LANGUAGES[0]).toBe('typescript');
  });

  it('every language is a non-empty string', () => {
    for (const lang of SUPPORTED_LANGUAGES) {
      expect(typeof lang).toBe('string');
      expect(lang.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Review Categories
// ---------------------------------------------------------------------------

describe('ReviewCategory', () => {
  it('has exactly the expected number of categories', () => {
    expect(REVIEW_CATEGORIES).toHaveLength(9);
  });

  it.each(REVIEW_CATEGORIES)('"%s" is a valid review category', (cat) => {
    expect(typeof cat).toBe('string');
  });
});

// ---------------------------------------------------------------------------
// Severity
// ---------------------------------------------------------------------------

describe('Severity', () => {
  it('has exactly the expected number of severity levels', () => {
    expect(SEVERITY_LEVELS).toHaveLength(5);
  });

  it('is ordered from most to least severe', () => {
    expect(SEVERITY_LEVELS[0]).toBe('critical');
    expect(SEVERITY_LEVELS[1]).toBe('high');
    expect(SEVERITY_LEVELS[2]).toBe('medium');
    expect(SEVERITY_LEVELS[3]).toBe('low');
    expect(SEVERITY_LEVELS[4]).toBe('info');
  });
});

// ---------------------------------------------------------------------------
// Risk Levels
// ---------------------------------------------------------------------------

describe('RiskLevel', () => {
  it('has exactly the expected number of risk levels', () => {
    expect(RISK_LEVELS).toHaveLength(4);
  });

  it('is ordered from most to least risky', () => {
    expect(RISK_LEVELS[0]).toBe('critical');
    expect(RISK_LEVELS[1]).toBe('high');
    expect(RISK_LEVELS[2]).toBe('medium');
    expect(RISK_LEVELS[3]).toBe('low');
  });
});

// ---------------------------------------------------------------------------
// Error Categories
// ---------------------------------------------------------------------------

describe('ErrorCategory', () => {
  it('has exactly the expected number of error categories', () => {
    expect(ERROR_CATEGORIES).toHaveLength(10);
  });

  it('contains all expected categories', () => {
    const expected = [
      'CONFIG',
      'IO',
      'PARSE',
      'RESOLVE',
      'GRAPH',
      'EMBED',
      'LLM',
      'MCP',
      'RATE_LIMIT',
      'INTERNAL',
    ];
    for (const cat of expected) {
      expect(ERROR_CATEGORIES).toContain(cat);
    }
  });
});

// ---------------------------------------------------------------------------
// Capture Tags
// ---------------------------------------------------------------------------

describe('CaptureTag', () => {
  it('has the expected number of tags', () => {
    const keys = Object.keys(CAPTURE_TAGS) as (keyof typeof CAPTURE_TAGS)[];
    expect(keys).toHaveLength(31);
  });

  it('every tag value is a non-empty dot-separated string', () => {
    for (const value of Object.values(CAPTURE_TAGS)) {
      expect(typeof value).toBe('string');
      expect(value.length).toBeGreaterThan(0);
      expect(value).toMatch(/^[a-z.]+$/);
    }
  });

  it('all tag values are unique', () => {
    const values = Object.values(CAPTURE_TAGS);
    expect(new Set(values).size).toBe(values.length);
  });
});

// ---------------------------------------------------------------------------
// getLanguageFromFilename
// ---------------------------------------------------------------------------

describe('getLanguageFromFilename', () => {
  it('returns typescript for .ts files', () => {
    expect(getLanguageFromFilename('src/index.ts')).toBe('typescript');
  });

  it('returns typescript for .tsx files', () => {
    expect(getLanguageFromFilename('Component.tsx')).toBe('typescript');
  });

  it('returns typescript for .d.ts files', () => {
    expect(getLanguageFromFilename('types.d.ts')).toBe('typescript');
  });

  it('returns javascript for .js files', () => {
    expect(getLanguageFromFilename('lib/utils.js')).toBe('javascript');
  });

  it('returns javascript for .jsx files', () => {
    expect(getLanguageFromFilename('App.jsx')).toBe('javascript');
  });

  it('returns javascript for .mjs files', () => {
    expect(getLanguageFromFilename('mod.mjs')).toBe('javascript');
  });

  it('returns javascript for .cjs files', () => {
    expect(getLanguageFromFilename('mod.cjs')).toBe('javascript');
  });

  it('returns python for .py files', () => {
    expect(getLanguageFromFilename('main.py')).toBe('python');
  });

  it('returns python for .pyi files', () => {
    expect(getLanguageFromFilename('stubs.pyi')).toBe('python');
  });

  it('returns go for .go files', () => {
    expect(getLanguageFromFilename('main.go')).toBe('go');
  });

  it('returns java for .java files', () => {
    expect(getLanguageFromFilename('Main.java')).toBe('java');
  });

  it('returns kotlin for .kt files', () => {
    expect(getLanguageFromFilename('Main.kt')).toBe('kotlin');
  });

  it('returns kotlin for .kts files', () => {
    expect(getLanguageFromFilename('script.kts')).toBe('kotlin');
  });

  it('returns csharp for .cs files', () => {
    expect(getLanguageFromFilename('Program.cs')).toBe('csharp');
  });

  it('returns rust for .rs files', () => {
    expect(getLanguageFromFilename('main.rs')).toBe('rust');
  });

  it('returns c for .c files', () => {
    expect(getLanguageFromFilename('main.c')).toBe('c');
  });

  it('returns c for .h files', () => {
    expect(getLanguageFromFilename('header.h')).toBe('c');
  });

  it('returns cpp for .cpp files', () => {
    expect(getLanguageFromFilename('main.cpp')).toBe('cpp');
  });

  it('returns cpp for .cc files', () => {
    expect(getLanguageFromFilename('main.cc')).toBe('cpp');
  });

  it('returns cpp for .hpp files', () => {
    expect(getLanguageFromFilename('header.hpp')).toBe('cpp');
  });

  it('returns php for .php files', () => {
    expect(getLanguageFromFilename('index.php')).toBe('php');
  });

  it('returns ruby for .rb files', () => {
    expect(getLanguageFromFilename('main.rb')).toBe('ruby');
  });

  it('returns swift for .swift files', () => {
    expect(getLanguageFromFilename('main.swift')).toBe('swift');
  });

  it('returns dart for .dart files', () => {
    expect(getLanguageFromFilename('main.dart')).toBe('dart');
  });

  it('returns lua for .lua files', () => {
    expect(getLanguageFromFilename('main.lua')).toBe('lua');
  });

  it('returns scala for .scala files', () => {
    expect(getLanguageFromFilename('Main.scala')).toBe('scala');
  });

  it('returns zig for .zig files', () => {
    expect(getLanguageFromFilename('main.zig')).toBe('zig');
  });

  it('returns elixir for .ex files', () => {
    expect(getLanguageFromFilename('main.ex')).toBe('elixir');
  });

  it('returns elixir for .exs files', () => {
    expect(getLanguageFromFilename('script.exs')).toBe('elixir');
  });

  it('returns null for files with no extension', () => {
    expect(getLanguageFromFilename('Makefile')).toBe(null);
    expect(getLanguageFromFilename('Dockerfile')).toBe(null);
  });

  it('returns null for unknown extensions', () => {
    expect(getLanguageFromFilename('data.json')).toBe(null);
    expect(getLanguageFromFilename('config.yaml')).toBe(null);
    expect(getLanguageFromFilename('image.png')).toBe(null);
  });

  it('handles deeply nested paths', () => {
    expect(getLanguageFromFilename('/a/b/c/d/e/f/src/main.rs')).toBe('rust');
  });

  it('is case-insensitive for extensions', () => {
    expect(getLanguageFromFilename('Main.PY')).toBe('python');
  });

  it('handles empty string gracefully', () => {
    expect(getLanguageFromFilename('')).toBe(null);
  });

  it('detects .cxx as cpp', () => {
    expect(getLanguageFromFilename('main.cxx')).toBe('cpp');
  });

  it('detects .hh as cpp', () => {
    expect(getLanguageFromFilename('header.hh')).toBe('cpp');
  });

  it('detects .phtml as php', () => {
    expect(getLanguageFromFilename('template.phtml')).toBe('php');
  });

  it('detects .ts with long path', () => {
    expect(getLanguageFromFilename('/very/long/path/to/src/components/deep/utils/helper.ts')).toBe('typescript');
  });

  it('detects .d.ts from path containing nested dots', () => {
    expect(getLanguageFromFilename('my.types.d.ts')).toBe('typescript');
  });

  it('returns null for file with no extension', () => {
    expect(getLanguageFromFilename('just_a_file')).toBe(null);
  });

  it('returns null for hidden file with no extension', () => {
    expect(getLanguageFromFilename('.gitignore')).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// Type assertions — verifying TypeScript compile-time types exist at runtime
// ---------------------------------------------------------------------------

describe('type re-exports', () => {
  it('CaptureTag is re-exported', () => {
    // CAPTURE_TAGS values are used at runtime
    expect(CAPTURE_TAGS.FUNCTION_DEF).toBe('function.def');
  });

  it('PipelinePhaseId values are accessible', () => {
    expect(PIPELINE_PHASE_IDS.includes('scan')).toBe(true);
  });
});

  // Additional edge cases for getLanguageFromFilename
  it('handles file with secondary extension', () => {
    expect(getLanguageFromFilename('test.spec.ts')).toBe('typescript');
  });
  it('handles double extension for TSX', () => {
    expect(getLanguageFromFilename('Component.test.tsx')).toBe('typescript');
  });
  it('handles double extension for JSX', () => {
    expect(getLanguageFromFilename('Component.spec.jsx')).toBe('javascript');
  });
  it('handles unknown secondary extension', () => {
    expect(getLanguageFromFilename('config.local.yml')).toBeNull();
  });
