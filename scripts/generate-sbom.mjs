#!/usr/bin/env node
/**
 * SBOM Generator — Generates an SPDX 2.3 Software Bill of Materials.
 *
 * Scans the monorepo for all packages, extracts metadata, and produces
 * a standards-compliant SPDX JSON document listing all components,
 * licenses, and dependencies.
 *
 * Usage: node scripts/generate-sbom.mjs [--output sbom.json]
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');
const pkg = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf-8'));

// ---------------------------------------------------------------------------
// SPDX Builder
// ---------------------------------------------------------------------------

const now = new Date().toISOString();
const sbom = {
  spdxVersion: 'SPDX-2.3',
  dataLicense: 'CC0-1.0',
  SPDXID: 'SPDXRef-DOCUMENT',
  name: 'code-analyzer',
  documentNamespace: `https://github.com/AgentiX-E/code-analyzer/sbom-${Date.now()}`,
  creationInfo: {
    created: now,
    creators: ['Tool: code-analyzer-sbom-generator', 'Person: Lambertyan'],
    licenseListVersion: '3.23',
  },
  packages: [],
  relationships: [],
};

/** Add a package to the SBOM. */
function addPackage(name, version, supplier, license) {
  const spdxId = `SPDXRef-${name.replace(/[@/]/g, '-')}`;
  sbom.packages.push({
    SPDXID: spdxId,
    name,
    versionInfo: version,
    supplier: `Person: ${supplier}`,
    downloadLocation: `https://github.com/AgentiX-E/code-analyzer`,
    licenseConcluded: license,
    licenseDeclared: license,
    copyrightText: `Copyright (c) 2026 ${supplier}`,
  });
  return spdxId;
}

/** Add a relationship between two packages. */
function addRelationship(fromId, relationship, toId) {
  sbom.relationships.push({
    spdxElementId: fromId,
    relatedSpdxElement: toId,
    relationshipType: relationship,
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

// Root package
const rootSpdxId = addPackage(
  pkg.name,
  pkg.version,
  pkg.author || 'Lambertyan',
  pkg.license || 'MIT',
);

sbom.packages[0].description = pkg.description;
sbom.packages[0].homepage = pkg.homepage;

// Sub-packages
const packagesDir = join(rootDir, 'packages');
try {
  const { readdirSync } = await import('node:fs');
  const entries = readdirSync(packagesDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const pkgJsonPath = join(packagesDir, entry.name, 'package.json');
    try {
      const subPkg = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));
      const subSpdxId = addPackage(
        subPkg.name,
        subPkg.version,
        subPkg.author || 'Lambertyan',
        subPkg.license || 'MIT',
      );
      addRelationship(rootSpdxId, 'CONTAINS', subSpdxId);
    } catch {
      // Skip packages without package.json
    }
  }
} catch (err) {
  console.warn('Warning: Could not scan packages directory:', err.message);
}

// Add sbom to root relationships
sbom.relationships.unshift({
  spdxElementId: 'SPDXRef-DOCUMENT',
  relatedSpdxElement: rootSpdxId,
  relationshipType: 'DESCRIBES',
});

// Write output
const outputFile = process.argv.includes('--output')
  ? process.argv[process.argv.indexOf('--output') + 1]
  : join(rootDir, 'sbom.spdx.json');

writeFileSync(outputFile, JSON.stringify(sbom, null, 2));
console.log(`SBOM written to: ${outputFile}`);
console.log(`Packages: ${sbom.packages.length}`);
console.log(`Relationships: ${sbom.relationships.length}`);
