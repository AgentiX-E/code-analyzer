// What the compiler says, as evidence about a change.
//
// **The second-cheapest of the audited gaps, and the largest signal we do not produce.** The audit's finding was that
// the reason we gave for omitting it - *"it needs to execute code"* - **conflates compiling with executing**:
// `tsc --noEmit` **runs no project code**, and **its diagnostics are evidence that no static rule can match** -
// *"this branch does not typecheck"* is a finding, and **ours currently says nothing about it.**
//
// **The cost is real and it is a toolchain rather than a sandbox**: an arbitrary repository may have no
// `node_modules`, may need a network, may take minutes. **So the capability is built as two parts** - a **pure
// parser** for the compiler's output, which is where the correctness lives and which is testable without running
// anything, and **an injectable runner** for the process, **so a caller decides what to execute and a test does not
// have to.**
//
// **And it reports what it could not do.** A repository with no compiler **is not a repository with no errors**,
// which is **the distinction this codebase has had to draw in four earlier places** - so `skipped` carries a reason
// rather than being an empty success.

/** One thing the compiler said, in the shape the rest of the product uses. */
export interface CompilerDiagnostic {
  filePath: string;
  line: number;
  column: number;
  /** **`TS2322` and friends** - the code a reader looks up, and the field a fix is indexed by. */
  code: string;
  message: string;
  severity: 'error' | 'warning';
}

export interface CompileEvidence {
  findings: CompilerDiagnostic[];
  /**
   * **Why this is empty, when it is.** *"No diagnostics"* and *"no compiler"* are different answers, and a caller
   * that cannot tell them apart will report the second as the first.
   */
  skipped: { reason: string } | null;
  /** How many files the compiler said it looked at, when it says so. */
  filesChecked: number | null;
}

/**
 * Turns `tsc`'s output into diagnostics.
 *
 * **The format is one line per diagnostic and a continuation for the explanation**:
 *
 * ```
 * src/a.ts(12,5): error TS2322: Type 'string' is not assignable to type 'number'.
 *   The expected type comes from property 'count'.
 * ```
 *
 * **A pure function, and it is where the correctness of this capability lives** - so it is tested against the
 * compiler's real output rather than against a shape invented here, **and a line it does not recognise is skipped
 * rather than guessed at.**
 */
export function parseTscOutput(output: string): CompilerDiagnostic[] {
  const findings: CompilerDiagnostic[] = [];
  // **Anchored on the whole diagnostic shape**, because a message can itself contain parentheses and colons - and a
  // looser pattern would split a diagnostic in two.
  const line = /^(.*?)\((\d+),(\d+)\):\s+(error|warning)\s+(TS\d+):\s+(.*)$/gm;

  for (const match of output.matchAll(line)) {
    const [, filePath, lineNo, colNo, severity, code, message] = match;
    if (!filePath || !lineNo || !colNo || !code || !message) continue;
    findings.push({
      // **Absolute paths are reported relative to the project by the compiler**, and a caller joins them; storing
      // what it said keeps this function pure.
      filePath,
      line: Number(lineNo),
      column: Number(colNo),
      code,
      message: message.trim(),
      severity: severity === 'error' ? 'error' : 'warning',
    });
  }
  return findings;
}

/** The process a caller has to supply, so this module never decides to execute anything. */
export interface CompilerRunner {
  /** Runs the project's typecheck and resolves with its combined output and exit code. */
  run: (command: string, args: string[], cwd: string) => Promise<{ stdout: string; exitCode: number }>;
}

/** The commands to try, in order, and **the first one the project declares wins**. */
export interface TypecheckCommand {
  command: string;
  args: string[];
  /** **A script name in `package.json`**, which is the project telling us how to check it rather than us guessing. */
  fromScript: boolean;
}

/**
 * **The project's own typecheck script when it has one, and `tsc --noEmit` when it does not.**
 *
 * **Asking the project is better than assuming**, because **a repository that typechecks with `vue-tsc`, `tsc -p
 * tsconfig.build.json` or a wrapper is a repository we would otherwise misjudge** - and **a misjudged typecheck is a
 * finding about nothing.**
 */
export function chooseTypecheckCommand(packageJson: Record<string, unknown> | null): TypecheckCommand | null {
  const scripts = (packageJson?.['scripts'] ?? null) as Record<string, unknown> | null;
  for (const name of ['typecheck', 'type-check', 'check-types', 'tsc']) {
    const script = scripts?.[name];
    if (typeof script === 'string' && script.trim().length > 0) {
      return { command: 'npm', args: ['run', '--silent', name], fromScript: true };
    }
  }
  const devDependencies = (packageJson?.['devDependencies'] ?? null) as Record<string, unknown> | null;
  const dependencies = (packageJson?.['dependencies'] ?? null) as Record<string, unknown> | null;
  if (devDependencies?.['typescript'] || dependencies?.['typescript']) {
    return { command: 'npx', args: ['--no-install', 'tsc', '--noEmit'], fromScript: false };
  }
  return null;
}

/**
 * Collects the compiler's evidence, or records why it could not.
 *
 * **The reason travels with the result**, because **an empty finding list from a repository whose compiler never ran
 * is not the same claim as one from a clean build** - and **a caller that cannot tell them apart is a caller
 * reporting the second as the first.**
 */
export async function collectCompileEvidence(
  rootPath: string,
  runner: CompilerRunner,
  packageJson: Record<string, unknown> | null,
  timeoutMs = 180_000,
): Promise<CompileEvidence> {
  const chosen = chooseTypecheckCommand(packageJson);
  if (chosen === null) {
    return {
      findings: [],
      skipped: { reason: 'the project declares no typecheck script and does not depend on typescript' },
      filesChecked: null,
    };
  }

  // **The timeout is the caller's**, and **the runner is the only thing that executes** - so this module's own
  // correctness does not depend on a process being available.
  const timeout = new Promise<{ stdout: string; exitCode: number }>((resolve) => {
    setTimeout(() => resolve({ stdout: '', exitCode: 124 }), timeoutMs).unref?.();
  });
  const result = await Promise.race([runner.run(chosen.command, chosen.args, rootPath), timeout]);

  if (result.exitCode === 124) {
    return { findings: [], skipped: { reason: `the typecheck did not finish within ${timeoutMs}ms` }, filesChecked: null };
  }

  const findings = parseTscOutput(result.stdout);
  // **Exit zero with no diagnostics is the only path that means "clean"**, and **a non-zero exit with no parsable
  // diagnostics is a tool that failed rather than a project that is wrong.**
  if (result.exitCode !== 0 && findings.length === 0) {
    return {
      findings: [],
      skipped: { reason: `the typecheck exited ${result.exitCode} without a diagnostic this could read` },
      filesChecked: null,
    };
  }

  return { findings, skipped: null, filesChecked: null };
}
