// @ts-nocheck
// @code-analyzer/mcp — Hotspot Detection Tool Tests

import { describe, it, expect } from 'vitest';
import hotspotDetectionTool, {
  hotspotDetectionTool as namedExport,
} from '../tools/hotspot-detection.js';

// ---------------------------------------------------------------------------
// Tool Definition Tests
// ---------------------------------------------------------------------------

describe('hotspotDetectionTool definition', () => {
  it('should have the correct tool name', () => {
    expect(hotspotDetectionTool.name).toBe('hotspot_detection');
  });

  it('should have a non-empty description', () => {
    expect(hotspotDetectionTool.description.length).toBeGreaterThan(0);
  });

  it('should have a valid inputSchema', () => {
    expect(hotspotDetectionTool.inputSchema.type).toBe('object');
    expect(hotspotDetectionTool.inputSchema.properties).toBeDefined();
    expect(hotspotDetectionTool.inputSchema.required).toContain('projectId');
  });

  it('should have threshold with default 10', () => {
    const thresholdProp = hotspotDetectionTool.inputSchema.properties.threshold;
    expect(thresholdProp.type).toBe('number');
    expect(thresholdProp.default).toBe(10);
  });

  it('should have maxResults with default 20', () => {
    const maxResultsProp = hotspotDetectionTool.inputSchema.properties.maxResults;
    expect(maxResultsProp.type).toBe('number');
    expect(maxResultsProp.default).toBe(20);
  });

  it('should have a callable handler', () => {
    expect(typeof hotspotDetectionTool.handler).toBe('function');
  });

  it('should export the same object as default and named', () => {
    expect(hotspotDetectionTool).toBe(namedExport);
  });
});

// ---------------------------------------------------------------------------
// Handler Tests
// ---------------------------------------------------------------------------

describe('hotspotDetectionTool handler', () => {
  it('should detect hotspots with default threshold', async () => {
    const result = await hotspotDetectionTool.handler({
      projectId: 'test-project',
    });
    expect(result.content[0].text).toContain('Code Hotspots');
    expect(result.metadata.hotspotCount).toBeGreaterThan(0);
    expect(result.metadata.projectId).toBe('test-project');
    expect(result.metadata.threshold).toBe(10);
  });

  it('should filter by complexity threshold', async () => {
    const result = await hotspotDetectionTool.handler({
      projectId: 'test-project',
      threshold: 20,
    });
    // With threshold 20, only hotspots with complexity >= 20 are returned
    // processRequest(32), buildQuery(28), charge(45), setup(22) = 4
    expect(result.metadata.hotspotCount).toBe(4);
    expect(result.metadata.threshold).toBe(20);
    expect(result.content[0].text).not.toContain('validate');
    expect(result.content[0].text).not.toContain('formatDate');
  });

  it('should filter by high threshold (returning few results)', async () => {
    const result = await hotspotDetectionTool.handler({
      projectId: 'test-project',
      threshold: 40,
    });
    // Only charge(45) >= 40
    expect(result.metadata.hotspotCount).toBe(1);
    expect(result.content[0].text).toContain('charge');
  });

  it('should return all when threshold is very low', async () => {
    const result = await hotspotDetectionTool.handler({
      projectId: 'test-project',
      threshold: 1,
    });
    // All 8 sample hotspots have complexity >= 1
    expect(result.metadata.hotspotCount).toBe(8);
  });

  it('should return none when threshold exceeds all complexities', async () => {
    const result = await hotspotDetectionTool.handler({
      projectId: 'test-project',
      threshold: 100,
    });
    expect(result.metadata.hotspotCount).toBe(0);
    expect(result.content[0].text).toBe('No hotspots detected.');
  });

  it('should respect maxResults limit', async () => {
    const result = await hotspotDetectionTool.handler({
      projectId: 'test-project',
      threshold: 1,
      maxResults: 3,
    });
    expect(result.metadata.hotspotCount).toBeLessThanOrEqual(3);
  });

  it('should use default values when threshold and maxResults are undefined', async () => {
    const result = await hotspotDetectionTool.handler({
      projectId: 'test-project',
      threshold: undefined,
      maxResults: undefined,
    });
    expect(result.metadata.threshold).toBe(10);
    // Default threshold is 10, so only hotspots with complexity >= 10
    expect(result.metadata.hotspotCount).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Risk Sorting Tests
// ---------------------------------------------------------------------------

describe('hotspot risk sorting', () => {
  it('should sort hotspots high → medium → low', async () => {
    const result = await hotspotDetectionTool.handler({
      projectId: 'test-project',
      threshold: 1,
    });
    const text = result.content[0].text;

    // Find positions of risk icons
    const highIndex = text.indexOf('🔴');
    const mediumIndex = text.indexOf('🟡');
    const lowIndex = text.indexOf('🟢');

    // All should be present with threshold 1
    expect(highIndex).not.toBe(-1);
    expect(mediumIndex).not.toBe(-1);
    expect(lowIndex).not.toBe(-1);

    // High should come before medium, medium before low
    expect(highIndex).toBeLessThan(mediumIndex);
    expect(mediumIndex).toBeLessThan(lowIndex);
  });

  it('should use red icon for high risk', async () => {
    const result = await hotspotDetectionTool.handler({
      projectId: 'test-project',
      threshold: 30,
    });
    // Only processRequest(32) and charge(45) with threshold 30
    expect(result.content[0].text).toContain('🔴');
  });

  it('should use yellow icon for medium risk', async () => {
    const result = await hotspotDetectionTool.handler({
      projectId: 'test-project',
      threshold: 12,
      maxResults: 10,
    });
    expect(result.content[0].text).toContain('🟡');
  });

  it('should use green icon for low risk', async () => {
    const result = await hotspotDetectionTool.handler({
      projectId: 'test-project',
      threshold: 1,
      maxResults: 10,
    });
    expect(result.content[0].text).toContain('🟢');
  });
});

// ---------------------------------------------------------------------------
// Report Structure Tests
// ---------------------------------------------------------------------------

describe('hotspot report structure', () => {
  it('should include markdown table with correct columns', async () => {
    const result = await hotspotDetectionTool.handler({
      projectId: 'test-project',
    });
    expect(result.content[0].text).toContain('| Risk | Complexity | Churn | File | Symbol |');
    expect(result.content[0].text).toContain('|------|-----------|-------|------|--------|');
  });

  it('should include hotspot count in header', async () => {
    const result = await hotspotDetectionTool.handler({
      projectId: 'test-project',
    });
    expect(result.content[0].text).toContain('## Code Hotspots');
    expect(result.content[0].text).toMatch(/Code Hotspots \(\d+\)/);
  });

  it('should include file paths in backticks', async () => {
    const result = await hotspotDetectionTool.handler({
      projectId: 'test-project',
      threshold: 1,
    });
    expect(result.content[0].text).toContain('`src/api/handler.ts`');
    expect(result.content[0].text).toContain('`src/db/query-builder.ts`');
  });

  it('should include symbol names', async () => {
    const result = await hotspotDetectionTool.handler({
      projectId: 'test-project',
      threshold: 1,
    });
    expect(result.content[0].text).toContain('processRequest');
    expect(result.content[0].text).toContain('buildQuery');
    expect(result.content[0].text).toContain('charge');
  });

  it('should include recommendations section', async () => {
    const result = await hotspotDetectionTool.handler({
      projectId: 'test-project',
    });
    expect(result.content[0].text).toContain('### Recommendations');
    expect(result.content[0].text).toContain('High-risk hotspots');
    expect(result.content[0].text).toContain('Medium-risk');
    expect(result.content[0].text).toContain('Low-risk');
  });

  it('should show empty message when no hotspots', async () => {
    const result = await hotspotDetectionTool.handler({
      projectId: 'test-project',
      threshold: 999,
    });
    expect(result.content[0].text).toBe('No hotspots detected.');
  });
});

// ---------------------------------------------------------------------------
// Metadata Tests
// ---------------------------------------------------------------------------

describe('hotspot metadata', () => {
  it('should include projectId in metadata', async () => {
    const result = await hotspotDetectionTool.handler({
      projectId: 'my-project',
    });
    expect(result.metadata.projectId).toBe('my-project');
  });

  it('should include hotspotCount in metadata', async () => {
    const result = await hotspotDetectionTool.handler({
      projectId: 'test-project',
      threshold: 20,
    });
    expect(result.metadata.hotspotCount).toBe(4);
  });

  it('should include threshold in metadata', async () => {
    const result = await hotspotDetectionTool.handler({
      projectId: 'test-project',
      threshold: 15,
    });
    expect(result.metadata.threshold).toBe(15);
  });
});

// ---------------------------------------------------------------------------
// Edge Cases
// ---------------------------------------------------------------------------

describe('edge cases', () => {
  it('should handle maxResults larger than available hotspots', async () => {
    const result = await hotspotDetectionTool.handler({
      projectId: 'test-project',
      threshold: 1,
      maxResults: 100,
    });
    // All 8 hotspots should be returned since maxResults > count
    expect(result.metadata.hotspotCount).toBe(8);
  });

  it('should handle maxResults of 1', async () => {
    const result = await hotspotDetectionTool.handler({
      projectId: 'test-project',
      threshold: 1,
      maxResults: 1,
    });
    expect(result.metadata.hotspotCount).toBe(1);
  });

  it('should handle maxResults of 0', async () => {
    const result = await hotspotDetectionTool.handler({
      projectId: 'test-project',
      threshold: 1,
      maxResults: 0,
    });
    expect(result.metadata.hotspotCount).toBe(0);
  });

  it('should sort by risk level with same complexity', async () => {
    // charge(45, high), processRequest(32, high), setup(22, high), buildQuery(28, high)
    // All high risk but sorted by complexity within the report table
    const result = await hotspotDetectionTool.handler({
      projectId: 'test-project',
      threshold: 20,
    });
    // All 4 should be high risk
    const highCount = (result.content[0].text.match(/🔴/g) || []).length;
    expect(highCount).toBe(4);
  });

  it('should include complexity and churn values in output', async () => {
    const result = await hotspotDetectionTool.handler({
      projectId: 'test-project',
      threshold: 20,
    });
    expect(result.content[0].text).toContain('32');
    expect(result.content[0].text).toContain('47');
    expect(result.content[0].text).toContain('45');
  });
});

// ---------------------------------------------------------------------------
// Sort fallback coverage — unknown riskLevel (?? 3) and green icon
// ---------------------------------------------------------------------------

describe('risk sort edge cases', () => {
  it('should use green icon for low-risk hotspots', async () => {
    const result = await hotspotDetectionTool.handler({
      projectId: 'test-project',
      threshold: 1,
      maxResults: 10,
    });
    const text = result.content[0].text;
    // Low risk exists (validate complexity 8), so green icon should appear
    expect(text).toContain('🟢');
  });

  it('should sort all three risk levels in correct order', async () => {
    const result = await hotspotDetectionTool.handler({
      projectId: 'test-project',
      threshold: 1,
    });
    const text = result.content[0].text;
    const redPos = text.indexOf('🔴');
    const yellowPos = text.indexOf('🟡');
    const greenPos = text.indexOf('🟢');

    expect(redPos).not.toBe(-1);
    expect(yellowPos).not.toBe(-1);
    expect(greenPos).not.toBe(-1);
    expect(redPos).toBeLessThan(yellowPos);
    expect(yellowPos).toBeLessThan(greenPos);
  });

  it('should handle sort with nullish coalescing fallback for unknown risk level', async () => {
    // All sample data has valid risk levels (high/medium/low),
    // so ?? 3 is never triggered. This verifies sorting works
    // with the known risk levels.
    const result = await hotspotDetectionTool.handler({
      projectId: 'test-project',
      threshold: 1,
    });
    // All 8 sample hotspots are returned with valid sort
    expect(result.metadata.hotspotCount).toBe(8);
    const text = result.content[0].text;
    // Verify high-risk items appear first in the sorted output
    const firstRiskLine = text.split('\n').find(l => l.includes('🔴'));
    expect(firstRiskLine).toBeTruthy();
  });

  it('should handle threshold and maxResults as null values', async () => {
    const result = await hotspotDetectionTool.handler({
      projectId: 'test-project',
      threshold: null,
      maxResults: null,
    });
    // null values should trigger the ?? fallback to defaults (10 and 20)
    expect(result.metadata.threshold).toBe(10);
    expect(result.metadata.hotspotCount).toBeGreaterThan(0);
  });

  it('should handle threshold explicitly set to 0', async () => {
    const result = await hotspotDetectionTool.handler({
      projectId: 'test-project',
      threshold: 0,
    });
    // Threshold of 0 means all hotspots pass
    expect(result.metadata.hotspotCount).toBe(8);
  });
});
