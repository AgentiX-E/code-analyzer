import { describe, it, expect } from 'vitest';
import { CAPTURE_TAGS } from '@code-analyzer/shared';

import { HclProvider } from '../languages/hcl.js';
import type { TreeSitterLanguage } from '../languages/tree-sitter-base.js';

// A provider with no grammar, forcing every method onto its regex-based
// fallback implementation.
class NoGrammarHclProvider extends HclProvider {
  protected override loadGrammar(): TreeSitterLanguage | null {
    return null;
  }
}

describe('HclProvider', () => {
  const provider = new HclProvider();

  describe('language metadata', () => {
    it('should report correct language', () => {
      expect(provider.language).toBe('hcl');
    });

    it('should have correct display name', () => {
      expect(provider.displayName).toBe('HCL (Terraform)');
    });

    it('should have .tf and .hcl extensions', () => {
      expect(provider.extensions).toContain('.tf');
      expect(provider.extensions).toContain('.hcl');
      expect(provider.extensions).toContain('.tfvars');
    });

    it('should have named import semantics', () => {
      expect(provider.importSemantics).toBe('named');
    });
  });

  describe('parse — resource blocks', () => {
    it('should extract a resource block with type and name', () => {
      const code = 'resource "aws_vpc" "main" {\n  cidr_block = "10.0.0.0/16"\n}';
      const captures = provider.parse(code, 'main.tf');
      const resources = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(resources.some((c) => c.name === 'aws_vpc.main')).toBe(true);
      expect(resources.some((c) => c.properties?.resourceType === 'aws_vpc')).toBe(true);
      expect(resources.some((c) => c.properties?.resourceName === 'main')).toBe(true);
      expect(resources.some((c) => c.properties?.iaCType === 'TerraformResource')).toBe(true);
    });

    it('should extract a data block with source and name', () => {
      const code = 'data "aws_ami" "ubuntu" {\n  most_recent = true\n}';
      const captures = provider.parse(code, 'main.tf');
      const data = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(data.some((c) => c.name === 'aws_ami.ubuntu')).toBe(true);
      expect(data.some((c) => c.properties?.dataSource === 'aws_ami')).toBe(true);
      expect(data.some((c) => c.properties?.dataName === 'ubuntu')).toBe(true);
    });
  });

  describe('parse — single-label blocks', () => {
    it('should extract a variable block', () => {
      const code = 'variable "region" {\n  default = "us-east-1"\n}';
      const captures = provider.parse(code, 'vars.tf');
      const vars = captures.filter((c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF);
      expect(vars.some((c) => c.name === 'region')).toBe(true);
    });

    it('should extract an output block with isOutput flag', () => {
      const code = 'output "vpc_id" {\n  value = aws_vpc.main.id\n}';
      const captures = provider.parse(code, 'outputs.tf');
      const outputs = captures.filter((c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF);
      expect(outputs.some((c) => c.name === 'vpc_id' && c.properties?.isOutput === 'true')).toBe(
        true,
      );
    });

    it('should extract a provider block with isProvider flag', () => {
      const code = 'provider "aws" {\n  region = "us-east-1"\n}';
      const captures = provider.parse(code, 'providers.tf');
      const providers = captures.filter((c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF);
      expect(providers.some((c) => c.name === 'aws' && c.properties?.isProvider === 'true')).toBe(
        true,
      );
    });

    it('should extract a module block with isModule flag', () => {
      const code = 'module "vpc" {\n  source = "terraform-aws-modules/vpc/aws"\n}';
      const captures = provider.parse(code, 'modules.tf');
      const modules = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(modules.some((c) => c.name === 'vpc' && c.properties?.isModule === 'true')).toBe(true);
    });

    it('should extract a locals block', () => {
      const code = 'locals {\n  env = "prod"\n}';
      const captures = provider.parse(code, 'locals.tf');
      const locals = captures.filter((c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF);
      expect(locals.some((c) => c.name === 'locals' && c.properties?.isLocals === 'true')).toBe(
        true,
      );
    });
  });

  describe('parse — nested blocks and strings', () => {
    it('should recurse into nested blocks', () => {
      const code = 'locals {\n  nested {\n    a = 1\n  }\n}';
      const captures = provider.parse(code, 't.tf');
      expect(Array.isArray(captures)).toBe(true);
      expect(captures.length).toBeGreaterThanOrEqual(1);
    });

    it('should extract interpolated string values (template_literal)', () => {
      const code = 'output "id" {\n  value = "${aws_vpc.main.id}"\n}';
      const captures = provider.parse(code, 't.tf');
      const outputs = captures.filter((c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF);
      expect(outputs.some((c) => c.name === 'id')).toBe(true);
    });

    it('should include filePath in properties', () => {
      const code = 'resource "aws_vpc" "main" {}';
      const captures = provider.parse(code, 'custom.tf');
      const res = captures.find((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(res?.properties?.filePath).toBe('custom.tf');
    });
  });

  describe('extractImports — module sources', () => {
    it('should extract module source as a named import', () => {
      const code = 'module "vpc" {\n  source = "terraform-aws-modules/vpc/aws"\n}';
      const imports = provider.extractImports(code, 'main.tf');
      expect(imports.some((i) => i.source === 'terraform-aws-modules/vpc/aws')).toBe(true);
    });

    it('should not treat non-module blocks as imports', () => {
      const code = 'resource "aws_vpc" "main" {}';
      const imports = provider.extractImports(code, 'main.tf');
      expect(imports.length).toBe(0);
    });

    it('should recurse into nested blocks for module sources', () => {
      const code = 'module "vpc" {\n  nested_block {\n    source = "nested/source"\n  }\n}';
      const imports = provider.extractImports(code, 'main.tf');
      expect(Array.isArray(imports)).toBe(true);
    });

    it('should ignore a module source that is not a string literal', () => {
      const code = 'module "vpc" {\n  source = var.foo\n}';
      const imports = provider.extractImports(code, 'main.tf');
      expect(imports.length).toBe(0);
    });

    it('should ignore a module source that is a number literal', () => {
      const code = 'module "vpc" {\n  source = 123\n}';
      const imports = provider.extractImports(code, 'main.tf');
      expect(imports.length).toBe(0);
    });

    it('should ignore non-source attributes in a module block', () => {
      const code = 'module "vpc" {\n  version = "1.0"\n}';
      const imports = provider.extractImports(code, 'main.tf');
      expect(imports.length).toBe(0);
    });
  });

  describe('isExported', () => {
    it('should report IaC resources as always exported', () => {
      expect(provider.isExported('resource "aws_vpc" "main" {}', 'aws_vpc.main')).toBe(true);
    });
  });

  describe('parse — empty-string values', () => {
    it('should ignore a module source that is an empty string', () => {
      // An empty `""` string_lit has no template_literal child, so the value
      // extractor must fall through to stripping the surrounding quotes.
      const code = 'module "vpc" {\n  source = ""\n}';
      const imports = provider.extractImports(code, 'main.tf');
      expect(imports.length).toBe(0);
    });

    it('should still emit a capture for a block whose label is an empty string', () => {
      const code = 'variable "" {\n  default = "us-east-1"\n}';
      const captures = provider.parse(code, 'vars.tf');
      const vars = captures.filter((c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF);
      expect(vars.some((c) => c.name === '')).toBe(true);
    });
  });

  describe('parse — blocks with no labels', () => {
    it('should gracefully degrade a resource block with no string labels', () => {
      const captures = provider.parse('resource {}', 'main.tf');
      const res = captures.find((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(res).toBeDefined();
      expect(res?.properties?.resourceType).toBe('');
      expect(res?.properties?.resourceName).toBe('');
    });

    it('should gracefully degrade a data block with no string labels', () => {
      const captures = provider.parse('data {}', 'main.tf');
      const data = captures.find((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(data).toBeDefined();
      expect(data?.properties?.dataSource).toBe('');
      expect(data?.properties?.dataName).toBe('');
    });
  });

  describe('fallback (grammar unavailable)', () => {
    const fb = new NoGrammarHclProvider();

    it('fallbackParse extracts resource, data, variable, output, provider, and module blocks', () => {
      const code = [
        'resource "aws_vpc" "main" {',
        '  cidr_block = "10.0.0.0/16"',
        '}',
        'data "aws_ami" "ubuntu" {}',
        'variable "region" {}',
        'output "vpc_id" {}',
        'provider "aws" {}',
        'module "vpc" {}',
      ].join('\n');
      const captures = fb.parse(code, 'main.tf');
      expect(
        captures.some((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF && c.name === 'aws_vpc.main'),
      ).toBe(true);
      expect(
        captures.some((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF && c.name === 'aws_ami.ubuntu'),
      ).toBe(true);
      expect(captures.some((c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF && c.name === 'region')).toBe(
        true,
      );
      expect(
        captures.some(
          (c) =>
            c.tag === CAPTURE_TAGS.VARIABLE_DEF &&
            c.name === 'vpc_id' &&
            c.properties?.isOutput === 'true',
        ),
      ).toBe(true);
      expect(
        captures.some(
          (c) =>
            c.tag === CAPTURE_TAGS.VARIABLE_DEF &&
            c.name === 'aws' &&
            c.properties?.isProvider === 'true',
        ),
      ).toBe(true);
      expect(
        captures.some(
          (c) =>
            c.tag === CAPTURE_TAGS.FUNCTION_DEF &&
            c.name === 'vpc' &&
            c.properties?.isModule === 'true',
        ),
      ).toBe(true);
    });

    it('fallbackParse sorts same-line captures by byte offset', () => {
      // Two resources on one line share a startLine, forcing the sort
      // comparator onto its startByte tie-breaker arm.
      const code = 'resource "a" "b" {} resource "c" "d" {}';
      const captures = fb.parse(code, 't.tf');
      const resources = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(resources.map((c) => c.name)).toEqual(['a.b', 'c.d']);
    });

    it('fallbackExtractImports extracts module source', () => {
      const code = 'module "vpc" {\n  source = "terraform-aws-modules/vpc/aws"\n}';
      const imports = fb.extractImports(code, 'main.tf');
      expect(imports.some((i) => i.source === 'terraform-aws-modules/vpc/aws')).toBe(true);
    });

    it('fallbackExtractImports returns empty when no module source is present', () => {
      expect(fb.extractImports('resource "aws_vpc" "main" {}')).toEqual([]);
    });

    it('fallbackIsExported reports resources as always exported', () => {
      expect(fb.isExported('resource "aws_vpc" "main" {}', 'aws_vpc.main')).toBe(true);
    });
  });
});
