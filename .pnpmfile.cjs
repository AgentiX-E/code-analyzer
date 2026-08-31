// .pnpmfile.cjs — pnpm hooks for dependency resolution overrides
// Used to enforce minimum versions for security-vulnerable transitive dependencies.
// pnpm workspace.yaml `overrides` only match version-selector keys (e.g. `pkg@^1`),
// and complex range selectors are unreliable; this hook is a reliable fallback that
// rewrites the declared specifier of every transitive dependency directly.
//
// NOTE: dependency specifiers carry a range prefix (`^`, `~`, `>=`, …), so a naive
// `spec.startsWith('3.')` never matches. Always strip the range prefix first.

/** Strip the leading range operators (^ ~ > = < and whitespace) from a specifier. */
function stripRange(spec) {
  return String(spec || '').replace(/^[\^~>=<\s]+/, '');
}

/** True when `version` (already stripped of any range prefix) is lexically below `minimum`. */
function below(version, minimum) {
  // Lexical comparison is safe here because every guarded package stays within a
  // single major line for patch/minor bumps (e.g. 3.x → 3.1.4, 4.x → 4.1.2).
  const v = version.split('.');
  const m = minimum.split('.');
  for (let i = 0; i < Math.max(v.length, m.length); i++) {
    const a = Number(v[i] ?? 0);
    const b = Number(m[i] ?? 0);
    if (a !== b) return a < b;
  }
  return false;
}

function readPackage(pkg, _context) {
  const deps = pkg.dependencies;
  if (!deps) return pkg;

  // adm-zip: GHSA-xcpc-8h2w-3j85 — memory allocation DoS
  if (deps['adm-zip'] && stripRange(deps['adm-zip']).startsWith('0.')) {
    deps['adm-zip'] = '^0.6.0';
  }

  // fast-uri: GHSA-v2hh-gcrm-f6hx (3.x) / GHSA-mwp4-54f8-5fhr (4.x) — host confusion
  if (deps['fast-uri']) {
    const v = stripRange(deps['fast-uri']);
    if (v.startsWith('3.') && below(v, '3.1.4')) {
      deps['fast-uri'] = '^3.1.4';
    } else if (v.startsWith('4.') && below(v, '4.1.2')) {
      deps['fast-uri'] = '^4.1.2';
    }
  }

  // brace-expansion: GHSA-mh99-v99m-4gvg — DoS via unbounded expansion
  if (deps['brace-expansion']) {
    const v = stripRange(deps['brace-expansion']);
    if (v.startsWith('1.') || v.startsWith('2.')) {
      deps['brace-expansion'] = '^2.0.2';
    }
  }

  // @hono/node-server: GHSA-frvp-7c67-39w9 — path traversal (Windows only, low risk)
  if (deps['@hono/node-server']) {
    const v = stripRange(deps['@hono/node-server']);
    if (v.startsWith('1.')) {
      deps['@hono/node-server'] = '^2.0.5';
    }
  }

  // undici: GHSA-4cwx-7wf7-3272 — cross-user info disclosure + parse-time crash
  if (deps['undici']) {
    const v = stripRange(deps['undici']);
    if (v.startsWith('7.') && below(v, '7.29.0')) {
      deps['undici'] = '^7.29.0';
    }
  }

  // ip-address: GHSA-mwp4-54f8-5fhr — Address4 decodes leading-zero octets
  if (deps['ip-address']) {
    const v = stripRange(deps['ip-address']);
    if (v.startsWith('10.') && below(v, '10.3.1')) {
      deps['ip-address'] = '^10.3.1';
    }
  }

  // js-yaml: GHSA-5p4m-2wfm-xmqj — quadratic CPU consumption in !!omap
  if (deps['js-yaml']) {
    const v = stripRange(deps['js-yaml']);
    if (v.startsWith('3.') && below(v, '3.15.1')) {
      deps['js-yaml'] = '^3.15.1';
    } else if (v.startsWith('4.') && below(v, '4.3.1')) {
      deps['js-yaml'] = '^4.3.1';
    }
  }

  // nanoid: GHSA-2v37-7h3g-55p8 — custom generators can loop indefinitely
  if (deps['nanoid']) {
    const v = stripRange(deps['nanoid']);
    if (v.startsWith('3.') && below(v, '3.3.18')) {
      deps['nanoid'] = '^3.3.18';
    }
  }

  return pkg;
}

module.exports = {
  hooks: {
    readPackage,
  },
};
