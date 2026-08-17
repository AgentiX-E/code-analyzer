## Description
<!-- Provide a clear and concise description of the changes in this PR. -->

## Type of Change
- [ ] 🚀 New feature (`feat:`)
- [ ] 🐛 Bug fix (`fix:`)
- [ ] ⚡ Performance improvement (`perf:`)
- [ ] 🔧 Refactoring — no functional change (`refactor:`)
- [ ] 🧪 Test enhancement (`test:`)
- [ ] 📝 Documentation update (`docs:`)
- [ ] 🔨 CI/CD improvement (`ci:`)
- [ ] 🔒 Security fix (`security:`)

## Testing

### Test Results
<!-- Paste the output of `npx vitest run` here or attach a screenshot -->
- [ ] All existing tests pass — `npx vitest run` shows 0 failures
- [ ] Property-based tests pass — `npx vitest run --config vitest.property.config.ts`
- [ ] Integration tests pass — `npx vitest run --config vitest.integration.config.ts`
- [ ] E2E tests pass — `npx vitest run --config vitest.e2e.config.ts`

### Coverage
- [ ] Coverage meets the threshold enforced in `vitest.config.ts` (`pnpm test:coverage`)
- [ ] No new `/* v8 ignore */` or `/* v8 ignore file */` markers added to production source
- [ ] Coverage summary (lines/branches) posted in the PR description

### Performance
- [ ] No benchmark regressions (run `pnpm bench:ci && pnpm check:perf`)
- [ ] Real-world benchmarks pass (React, cross-repo E2E, scale profiling)

## Breaking Changes
- [ ] No breaking changes to public APIs
- [ ] Breaking changes documented with migration guide below

## Checklist
- [ ] Code follows project conventions (format with `pnpm format`)
- [ ] All comments and documentation are written in English
- [ ] TypeScript types are complete — `pnpm typecheck` passes
- [ ] Lint passes — `pnpm lint` has no errors
- [ ] `.env` file is NOT included in the commit
- [ ] No API keys, tokens, or secrets in source code
- [ ] Commit follows conventional commits format (`type(scope): description`)

## Related Issues
<!-- Link related issues using #issue-number -->
