// .pnpmfile.cjs — pnpm hooks for dependency resolution overrides
// Used to enforce minimum versions for security-vulnerable transitive dependencies.
// pnpm v11 may not reliably apply workspace.yaml overrides; this hook is a reliable fallback.

function readPackage(pkg, _context) {
  // adm-zip: GHSA-xcpc-8h2w-3j85 — memory allocation DoS
  if (pkg.dependencies && pkg.dependencies['adm-zip']) {
    const current = pkg.dependencies['adm-zip'];
    if (current && current.startsWith('0.')) {
      pkg.dependencies['adm-zip'] = '^0.6.0';
    }
  }

  // fast-uri: GHSA-v2hh-gcrm-f6hx — host confusion
  if (pkg.dependencies && pkg.dependencies['fast-uri']) {
    const current = pkg.dependencies['fast-uri'];
    if (current && current.startsWith('3.') && !current.includes('3.1.4')) {
      pkg.dependencies['fast-uri'] = '^3.1.4';
    }
  }

  // brace-expansion: GHSA-mh99-v99m-4gvg — DoS via unbounded expansion
  if (pkg.dependencies && pkg.dependencies['brace-expansion']) {
    const current = pkg.dependencies['brace-expansion'];
    if (current && current.startsWith('1.') || current?.startsWith('2.')) {
      pkg.dependencies['brace-expansion'] = '^2.0.2';
    }
  }

  // @hono/node-server: GHSA-frvp-7c67-39w9 — path traversal (Windows only, low risk)
  if (pkg.dependencies && pkg.dependencies['@hono/node-server']) {
    const current = pkg.dependencies['@hono/node-server'];
    if (current && current.startsWith('1.')) {
      pkg.dependencies['@hono/node-server'] = '^2.0.5';
    }
  }

  return pkg;
}

module.exports = {
  hooks: {
    readPackage,
  },
};
