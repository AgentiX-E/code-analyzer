// @code-analyzer/intelligence — API Lens Tests
import { describe, it, expect } from 'vitest';
import { analyzeApi, generateApiReport } from '../lenses/api-lens.js';

describe('API Lens', () => {
  it('should detect Express POST route without validation', () => {
    const content = [
      "const express = require('express');",
      'const app = express();',
      "app.post('/users', (req, res) => {",
      '  const user = req.body;',
      '  res.json(user);',
      '});',
    ].join('\n');

    const findings = analyzeApi(content, '/src/routes.ts');
    const validationFinding = findings.find((f) => f.title.includes('Missing Input Validation'));
    expect(validationFinding).toBeDefined();
    expect(validationFinding!.severity).toBe('high');
  });

  it('should detect Express route without error handling', () => {
    const content = [
      "app.get('/users', (req, res) => {",
      '  const users = db.getAll();',
      '  res.json(users);',
      '});',
    ].join('\n');

    const findings = analyzeApi(content, '/src/routes.ts');
    const errorFinding = findings.find((f) => f.title.includes('Missing Error Handling'));
    expect(errorFinding).toBeDefined();
  });

  it('should detect missing rate limiting on mutating route', () => {
    const content = [
      "app.delete('/users/:id', (req, res) => {",
      '  res.json({ ok: true });',
      '});',
    ].join('\n');

    const findings = analyzeApi(content, '/src/routes.ts');
    const rateFinding = findings.find((f) => f.title.includes('Consider Rate Limiting'));
    expect(rateFinding).toBeDefined();
  });

  it('should detect Python FastAPI route without validation', () => {
    const content = [
      'from fastapi import FastAPI',
      'app = FastAPI()',
      "@app.post('/items')",
      'async def create_item(body: dict):',
      '    return body',
    ].join('\n');

    const findings = analyzeApi(content, '/src/api.py');
    const validationFinding = findings.find((f) => f.title.includes('Missing Input Validation'));
    expect(validationFinding).toBeDefined();
  });

  it('should detect multiple route findings without false positives', () => {
    // This file has Express routes — all should be found
    const content = "app.post('/api', (req,res) => { res.json(req.body); });";
    const findings = analyzeApi(content, '/src/api.ts');
    expect(findings.length).toBeGreaterThanOrEqual(1);
  });

  it('should skip GET routes that do not require validation', () => {
    const content = [
      "app.get('/health', (req, res) => {",
      '  res.json({ status: "ok" });',
      '});',
    ].join('\n');

    const findings = analyzeApi(content, '/src/health.ts');
    const validationFinding = findings.find((f) => f.title.includes('Missing Input Validation'));
    // GET /health should NOT trigger missing-input-validation
    expect(validationFinding).toBeUndefined();
  });

  it('should detect multiple findings on a file with multiple routes', () => {
    const content = [
      "app.post('/users', (req, res) => { res.json(req.body); });",
      "app.put('/users/:id', (req, res) => { res.json(req.body); });",
      "app.delete('/users/:id', (req, res) => { res.json({ ok: true }); });",
    ].join('\n');

    const findings = analyzeApi(content, '/src/multi.ts');
    expect(findings.length).toBeGreaterThanOrEqual(3);
  });

  it('should handle files with no routes gracefully', () => {
    const content = 'const x = 1;\nfunction helper() { return 42; }';
    const findings = analyzeApi(content, '/src/no-routes.ts');
    expect(Array.isArray(findings)).toBe(true);
    expect(findings.length).toBe(0);
  });

  it('should generate a valid LensReport', () => {
    const content = "app.get('/api', (req, res) => { res.json({}); });";
    const report = generateApiReport(content, '/src/report.ts');
    expect(report.lens).toBe('api');
    expect(report.name).toBe('API Lens');
    expect(report.filesScanned).toBe(1);
    expect(Array.isArray(report.findings)).toBe(true);
    expect(report.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('should handle a python route decorator on the last line', () => {
    const content = 'from fastapi import FastAPI\napp = FastAPI()\n@app.get("/last")';
    const findings = analyzeApi(content, '/src/last.py');
    expect(Array.isArray(findings)).toBe(true);
  });

  it('should handle a python route decorator followed by a non-definition line', () => {
    const content = [
      'from fastapi import FastAPI',
      'app = FastAPI()',
      '@app.get("/items")',
      '# a comment, not a def',
      'async def handler(): pass',
    ].join('\n');
    const findings = analyzeApi(content, '/src/api.py');
    expect(findings.find((f) => f.title.includes('Missing Error Handling'))).toBeDefined();
  });

  it('should flag a CORS wildcard origin in header form', () => {
    const content = 'Access-Control-Allow-Origin: *';
    const findings = analyzeApi(content, '/src/cors.ts');
    expect(findings.find((f) => f.title.includes('Overly Permissive CORS'))).toBeDefined();
  });

  it('should flag credentials with an unquoted wildcard origin', () => {
    const content = 'app.use(cors({ credentials: true, origin: * }));';
    const findings = analyzeApi(content, '/src/cors.ts');
    expect(findings.find((f) => f.title.includes('Dangerous CORS'))).toBeDefined();
  });

  it('should not flag credentials without a wildcard origin', () => {
    const content = 'app.use(cors({ credentials: true, origin: "https://app.example.com" }));';
    const findings = analyzeApi(content, '/src/cors.ts');
    expect(findings.find((f) => f.title.includes('Dangerous CORS'))).toBeUndefined();
  });

  it('should skip GraphQL breaking-change detection for non-schema files', () => {
    const schema = 'type Query { hello: String }';
    const findings = analyzeApi(schema, '/src/util.ts', { previousContent: schema });
    expect(findings.find((f) => f.title.includes('GraphQL Breaking Change'))).toBeUndefined();
  });

  it('should flag a removed GraphQL type', () => {
    const previous = 'type User {\n  id: ID\n}\ntype Post {\n  id: ID\n}';
    const current = 'type User {\n  id: ID\n}';
    const findings = analyzeApi(current, '/src/schema.graphql', { previousContent: previous });
    expect(findings.find((f) => f.title.includes('Removed Type'))).toBeDefined();
  });

  it('should flush an open GraphQL type when a new type declaration begins', () => {
    const schema = 'type A {\n  id: ID\ntype B {\n  id: ID\n}';
    const findings = analyzeApi(schema, '/src/schema.graphql', { previousContent: schema });
    expect(findings).toHaveLength(0);
  });

  it('should ignore non-field lines inside a GraphQL type', () => {
    const schema = 'type User {\n  # a comment line\n  id: ID\n}';
    const findings = analyzeApi(schema, '/src/schema.graphql', { previousContent: schema });
    expect(findings.find((f) => f.title.includes('Removed Field'))).toBeUndefined();
  });

  it('should flush a trailing unclosed GraphQL type', () => {
    const schema = 'type Query {\n  hello: String';
    const findings = analyzeApi(schema, '/src/schema.graphql', { previousContent: schema });
    expect(findings).toHaveLength(0);
  });
});
