# Martian's Code Review Bench, as a corpus this harness can read

<!-- figures: citations:martian-code-review-bench -->

## Where this came from

`golden_comments/*.json` are five files copied byte-for-byte from
[`withmartian/code-review-benchmark`](https://github.com/withmartian/code-review-benchmark), path
`offline/golden_comments/`, at the repository's `main` as of 2026-11-18. The benchmark is **MIT licensed**; the upstream
`LICENSE` governs these files. They are committed here rather than fetched at run time so that a run is a checkout, and
so that a figure can be audited against the key it was scored on long after upstream has moved (it has moved twice: the
key held 137 comments at launch in February 2026, 136 after a March correction, and **173 after an August audit that
removed two, rewrote twenty-five and added thirty-eight**).

`positive_samples.json` is generated from them by `scripts/build-martian-corpus.mjs` and committed. **It is a pure
function of the raw files**, and `tests/unit/scripts/the-answer-key-we-are-scored-on-is-the-one-they-publish.test.ts`
rebuilds it and fails if the two differ by a byte.

## What the conversion does, and what it cannot

Our harness reads AACR-Bench's `PRDataItem`: `{githubPrUrl, source_commit, target_commit, comments[{note, path,
from_line, to_line, category}]}`. Martian's rows carry `{url, pr_title, comments[{comment, severity, category}]}`.

| our field                      | theirs     | note                                                                                                      |
| ------------------------------ | ---------- | --------------------------------------------------------------------------------------------------------- |
| `githubPrUrl`                  | `url`      | identity - the fork under `ai-code-review-evaluation/`, whose diff is the change the other tools reviewed |
| `note`                         | `comment`  | identity - the sentence the judge is asked about                                                          |
| `category`                     | `category` | identity, and the three scoring profiles are cuts of it                                                   |
| `severity`                     | `severity` | kept, unused by the score                                                                                 |
| `path`, `from_line`, `to_line` | —          | **null, because they do not exist**: their judge compares two sentences and never asks where either stood |

**The `null` coordinates are the honest part of this file.** Every one of the 173 goldens lands in the `noPath` bucket
of `golden-attribution.mjs`, so the attribution table this harness prints is uninformative on this corpus - it can say
which goldens were missed and not where they were. That is a property of the key, not a defect in the run, and a
diagnosis bought on this corpus has to come from reading the findings.

## The three profiles, reproduced

Upstream publishes counts for its three scoring profiles. This conversion reproduces them exactly, which is the check
that a category was not renamed on the way through:

| profile | categories                            | goldens |
| ------- | ------------------------------------- | ------- |
| Strict  | bug, security, concurrency, data, api | 139     |
| Core    | Strict + perf, test_gap, doc_defect   | 158     |
| All     | Core + style, speculative             | 173     |

The corpus is scored with the harness's `advisory` profile, which keeps every category - **the `All` column**. Upstream's
dashboard defaults to **Core F2**, so a figure from here and a figure from there are the same measurement only after
both are cut to the same profile and the same beta.

## What a figure from this corpus is not

1. **Not the same judge.** Upstream scores with `claude-opus-4-5`, `claude-sonnet-4-5` and `gpt-5.2`; this harness scores
   with `deepseek-chat`. Upstream's own documentation reports the top five tools are identical across its three judges
   but that individual tools move by **up to nine F1 points**, so a run here carries a judge term of that size.
2. **Not the same instrument.** Upstream extracts candidates from what a tool _posted_ and dedups them with an LLM before
   judging. This harness scores what our engine _emitted_, with `keep` applying our own operating point first. Both count
   precision over the emission; neither can see the other's extraction.
3. **Not contamination-free.** These are well-known repositories, forked in July 2025 and public since; upstream says so
   itself, and it is why it also publishes an online arm. A model that has seen these diffs scores higher here than it
   would on a fresh one.
4. **Not a claim about the field's ranking.** A low number here is a statement about **our reviewer against this key**,
   not a re-ranking of nineteen products whose runs this repository did not perform.

## Rebuilding

```bash
node scripts/build-martian-corpus.mjs
```

and to score against it, dispatch `AACR Bench` with `dataset: martian`.
