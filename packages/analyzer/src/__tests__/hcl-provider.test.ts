import { describe, it, expect } from 'vitest';
import { CAPTURE_TAGS } from '@code-analyzer/shared';

import { HclProvider } from '../languages/hcl.js';

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
      expect(outputs.some((c) => c.name === 'vpc_id' && c.properties?.isOutput === 'true')).toBe(true);
    });

    it('should extract a provider block with isProvider flag', () => {
      const code = 'provider "aws" {\n  region = "us-east-1"\n}';
      const captures = provider.parse(code, 'providers.tf');
      const providers = captures.filter((c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF);
      expect(providers.some((c) => c.name === 'aws' && c.properties?.isProvider === 'true')).toBe(true);
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
      expect(locals.some((c) => c.name === 'locals' && c.properties?.isLocals === 'true')).toBe(true);
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
});
