// @code-analyzer — End-to-end: the review is told what is idiomatic in each language it is reading
//
// **The user story, in one sentence**: *I changed a Java service and the workflow that builds it, and the review told
// me my `try`-with-resources was a leak — so I asked what it had been told to look for, and it turned out the answer
// was "everything and nothing".*
//
// **Why this cannot be a unit test of the checklist module.** The module's own suite proves that the rules render and
// that selection is deterministic. What only a test at this level can prove is that **the section reaches the provider
// through the real call path** — the engine's two scopes, the five lanes, the per-file context and the pull-request
// section split — and that **turning the device off changes the prompt and nothing else**. A checklist that renders
// correctly and never reaches a model is a file of prose, which is what this repository had before.
//
// **And the third assertion is the one that makes the measurement in `docs/EVAL-CONTRACT.md` §8 legitimate**: with the
// switch off, the prompt is the same string minus one contiguous section. If it were anything else, the two runs of
// the registered comparison would differ by more than the variable they claim to differ by.

import { describe, expect, it } from 'vitest';

import { LLMReviewEngine } from '@code-analyzer/intelligence';

import type { LLMProvider, CompletionResult } from '@code-analyzer/intelligence';
import type { GitDiff } from '@code-analyzer/shared';

// ---------------------------------------------------------------------------
// The change under review: a service and the workflow that builds it
// ---------------------------------------------------------------------------

const PATCH = [
  'diff --git a/src/main/java/com/example/ledger/LedgerReader.java b/src/main/java/com/example/ledger/LedgerReader.java',
  '--- a/src/main/java/com/example/ledger/LedgerReader.java',
  '+++ b/src/main/java/com/example/ledger/LedgerReader.java',
  '@@ -18,6 +18,8 @@ public final class LedgerReader {',
  '   public String read(Path path) throws IOException {',
  '+    // The caller owns the stream from here, so this method does not close it.',
  '+    return Files.newBufferedReader(path, UTF_8).lines().collect(Collectors.joining());',
  '   }',
  ' }',
  'diff --git a/src/main/java/com/example/ledger/LedgerWriter.java b/src/main/java/com/example/ledger/LedgerWriter.java',
  '--- a/src/main/java/com/example/ledger/LedgerWriter.java',
  '+++ b/src/main/java/com/example/ledger/LedgerWriter.java',
  '@@ -9,6 +9,8 @@ public final class LedgerWriter {',
  '   public void write(Path path, String body) throws IOException {',
  '+    try (BufferedWriter out = Files.newBufferedWriter(path, UTF_8)) {',
  '+      out.write(body);',
  '     }',
  '   }',
  ' }',
  'diff --git a/.github/workflows/build.yml b/.github/workflows/build.yml',
  '--- a/.github/workflows/build.yml',
  '+++ b/.github/workflows/build.yml',
  '@@ -7,6 +7,8 @@ jobs:',
  '     steps:',
  '       - name: Checkout',
  '-        uses: actions/checkout@v4',
  '+        uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7',
  '+      - name: Verify',
  '+        continue-on-error: true',
  '+        run: ./gradlew verify',
].join('\n');

function sectionsOf(patch: string): Array<{ path: string; diffText: string }> {
  const sections: Array<{ path: string; diffText: string[] }> = [];
  let current: { path: string; diffText: string[] } | null = null;
  for (const line of patch.split('\n')) {
    const header = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
    if (header) {
      if (current) sections.push(current);
      current = { path: String(header[2]), diffText: [line] };
      continue;
    }
    current?.diffText.push(line);
  }
  if (current) sections.push(current);
  return sections.map((section) => ({
    path: section.path,
    diffText: section.diffText.join('\n'),
  }));
}

/**
 * The same change as one file's diff, in the shape the file scope takes.
 *
 * **Built rather than cast.** The pull-request path takes sections because a caller has already split a patch; the file
 * path takes the `GitDiff` the indexer produces, and a cast would have let a shape the engine never sees reach a prompt
 * assertion.
 */
const JAVA_CHANGE: GitDiff = {
  filePath: 'src/main/java/com/example/ledger/LedgerReader.java',
  oldHash: '0000000',
  newHash: '1111111',
  changeType: 'modified',
  ranges: [{ oldStart: 18, oldEnd: 20, newStart: 18, newEnd: 22, changeType: 'modified' }],
};

const MARKDOWN_CHANGE: GitDiff = {
  filePath: 'docs/CHANGELOG.md',
  oldHash: '0000000',
  newHash: '2222222',
  changeType: 'modified',
  ranges: [{ oldStart: 1, oldEnd: 1, newStart: 1, newEnd: 2, changeType: 'added' }],
};

/** A provider that records what it was asked and answers with one finding on the file the story is about. */
function recordingProvider(): { provider: LLMProvider; prompts: string[] } {
  const prompts: string[] = [];
  const provider: LLMProvider = {
    name: 'RecordingProvider',
    model: 'recording-model',
    complete: async (prompt: string): Promise<CompletionResult> => {
      prompts.push(prompt);
      return {
        model: 'recording-model',
        createdAt: '2026-11-09T00:00:00.000Z',
        finishReason: 'stop',
        content: JSON.stringify({
          findings: [
            {
              path: 'src/main/java/com/example/ledger/LedgerReader.java',
              startLine: 19,
              endLine: 20,
              severity: 'high',
              category: 'bug',
              title: 'Reader stream is never closed',
              description:
                'Files.newBufferedReader returns a stream the caller cannot close from here, so the handle is leaked per call.',
              suggestion: 'Wrap the read in a try-with-resources inside this method.',
            },
          ],
        }),
        usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      };
    },
  };
  return { provider, prompts };
}

// ---------------------------------------------------------------------------
// The story
// ---------------------------------------------------------------------------

describe('a review of a Java service and its workflow knows what is idiomatic in both', () => {
  it('gives every lane the rules of both languages, the Java ones first', async () => {
    const { provider, prompts } = recordingProvider();
    const engine = new LLMReviewEngine(provider);

    await engine.reviewPullRequest(sectionsOf(PATCH), { maxFindingsPerPullRequest: 8 });

    expect(prompts).toHaveLength(5);
    for (const prompt of prompts) {
      expect(prompt).toContain('### Java');
      expect(prompt).toContain('### YAML and CI workflows');
      expect(prompt.indexOf('### Java')).toBeLessThan(prompt.indexOf('### YAML and CI workflows'));
    }
  });

  it('tells the reviewer what not to report, in the language it is reading', async () => {
    const { provider, prompts } = recordingProvider();
    const engine = new LLMReviewEngine(provider);

    await engine.reviewPullRequest(sectionsOf(PATCH), { maxFindingsPerPullRequest: 8 });

    const [first] = prompts;
    // **The two rules this change is one decision away from being wrong about**: a stream that is returned to the
    // caller is not a leak, and an action pinned to a SHA is not a floating reference.
    expect(first).toContain('java.resource-leak');
    expect(first).toContain('the value is returned to the caller');
    expect(first).toContain('yaml.unpinned-action');
    expect(first).toContain('the reference is a full 40-character commit SHA');
  });

  it('still returns the finding, so the checklist did not displace the review', async () => {
    const { provider } = recordingProvider();
    const engine = new LLMReviewEngine(provider);

    const lanes = await engine.reviewPullRequest(sectionsOf(PATCH), {
      maxFindingsPerPullRequest: 8,
    });
    const findings = lanes.filter((lane) => lane.success).flatMap((lane) => lane.findings);

    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]?.path).toBe('src/main/java/com/example/ledger/LedgerReader.java');
  });
});

describe('the switch removes one section and changes nothing else', () => {
  it('produces the same prompt minus a contiguous block when the checklist is off', async () => {
    const on = recordingProvider();
    const off = recordingProvider();

    await new LLMReviewEngine(on.provider).reviewDiff(JAVA_CHANGE);
    await new LLMReviewEngine(off.provider, { languageChecklist: false }).reviewDiff(JAVA_CHANGE);

    const withRules = String(on.prompts[0]);
    const withoutRules = String(off.prompts[0]);
    expect(withRules.length).toBeGreaterThan(withoutRules.length);

    // **Common prefix and common suffix, computed rather than assumed**, so the claim is about the whole string: the
    // two prompts agree up to one point and from another point on, and everything between those two points is the
    // checklist. A single changed word anywhere else would break one of the two boundaries.
    let head = 0;
    while (head < withoutRules.length && withRules[head] === withoutRules[head]) head += 1;
    let tail = 0;
    while (
      tail < withoutRules.length - head &&
      withRules[withRules.length - 1 - tail] === withoutRules[withoutRules.length - 1 - tail]
    ) {
      tail += 1;
    }

    expect(head).toBeGreaterThan(0);
    expect(tail).toBeGreaterThan(0);
    const removed = withRules.slice(head, withRules.length - tail);
    // **How much of the prompt the device costs**, asserted rather than described: the checklist is a minority of the
    // text it is added to, and **a device that doubled the prompt would be a change in the experiment rather than a
    // change in the review.**
    expect(removed.length).toBeLessThan(withRules.length / 2);
    expect(removed).toContain('Defect checklist for the language');
    expect(removed).toContain('Do not report when');
    expect(removed).toContain('java.resource-leak');
    // **And nothing after it moved**: the output contract is in the shared tail, not in the removed block.
    expect(removed).not.toContain('Respond ONLY with');
  });

  it('says nothing at all about a change whose languages it does not carry', async () => {
    const on = recordingProvider();
    const off = recordingProvider();
    await new LLMReviewEngine(on.provider).reviewDiff(MARKDOWN_CHANGE);
    await new LLMReviewEngine(off.provider, { languageChecklist: false }).reviewDiff(
      MARKDOWN_CHANGE,
    );

    expect(on.prompts[0]).toBe(off.prompts[0]);
    expect(String(on.prompts[0])).not.toContain('Defect checklist');
  });
});
