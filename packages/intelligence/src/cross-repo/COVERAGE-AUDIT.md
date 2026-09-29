# Coverage exclusions in this directory

Seven `ignore` markers were found under `packages/*/src` after the de-gamification campaign. **Six of them are in
`graph-compressor.ts`, and the seventh is a comment recording one that was removed.**

The six are all of one kind: **a branch that is reachable, excluded because its test does not exist.**

| line | construct                                | why it is reachable                                                  |
| ---- | ---------------------------------------- | -------------------------------------------------------------------- |
| 101  | `catch { return false }`                 | brotli's probe throws on a platform where it is present but unusable |
| 110  | `if (isBrotliAvailable())` true branch   | any machine with brotli                                              |
| 119  | the gzip fallback                        | any machine without it                                               |
| 130  | `if (isBrotliAvailable())` in decompress | the same two cases                                                   |
| 229  | `originalSize > 0 ? ... : 0` else        | a graph with no nodes, or one whose size is zero                     |
| 329  | the same in the serialized path          | the same                                                             |

## What makes them testable

**Four of the six — 110, 119, 130 and 101 — turn on one question**: whether brotli is available. That is a probe over
`zlib`, and a seam that lets a test answer it either way makes all four reachable without touching the environment.

**The other two are a division guard** over a size that is zero when the input graph is empty. A test with an empty
graph reaches the else branch directly; no seam is needed.

## Status

**Not yet done.** The markers are counted, their reachability is argued above, and the seam that would close four of
them is named. Removing them without adding the tests would raise the reported coverage and lower the truth, which is
the defect this file exists to prevent.
