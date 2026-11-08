// @code-analyzer/intelligence — reading the head of a file, bounded by a cap rather than by the file
//
// **One function, because two readers need the same guarantee and the guarantee is the whole of it.** The benchmark's
// lexical control indexes a file's text; the file-level fallback indexes its path and its import statements. Both run in
// the process that has to survive a checkout the analyser was killed on, so neither may read a 6 MB minified bundle into
// memory to count its words, and neither may decide how much to read from anything but a stated cap.
//
// **A cap on bytes read rather than on lines or tokens** is the only form of the rule that can be checked before the
// read: a line cap requires reading the file to know where the lines are, which is the cost the cap exists to avoid.

import { closeSync, constants, fstatSync, openSync, readSync } from 'node:fs';

/**
 * Read at most `cap` bytes of a file, or `null` when it cannot be read.
 *
 * **One syscall decides what the path is, and it is the one that opens it.** The earlier version asked `statSync` first
 * and `openSync` second, which is two answers to one question: between them the path can become something else, and the
 * guard that kept a directory or a fifo out of the read was a property of a file that might no longer be there when the
 * handle was taken. It now opens once and asks `fstat` about the descriptor it actually holds, so what is checked and
 * what is read are the same object. That is also one fewer system call on a function every measurement goes through.
 *
 * **`O_NONBLOCK`, because the guard now runs after the open.** A fifo opened read-only blocks until a writer appears,
 * which would hang a job that has a clock before any check could refuse it; opened non-blocking it returns a descriptor
 * that `fstat` identifies as not a regular file, and the function answers `null`. A regular file is unaffected by the
 * flag.
 *
 * **One read, because the length is already bounded by the file's own size.** `wanted` is `min(size, cap)`, so a
 * regular file has at least that many bytes standing and the call cannot come back empty on its own account. The
 * earlier version filled the buffer in a loop, which required a branch for a zero-length read - a branch that no
 * fixture can produce on a regular file, because producing it means shrinking the file between the `stat` and the
 * `read`, which is another process's doing. **The loop was removed rather than excused**: an untestable branch in the
 * function every measurement reads through is a place where a defect could hide for a whole iteration.
 *
 * A short read is still possible - a signal arriving mid-transfer ends the call early - and it yields a **shorter
 * head** rather than an error or a spin. That is inside this function's contract ("at most `cap` bytes"), and it is
 * symmetric between the two instruments that share it: the control and the fallback both read through this call, so a
 * truncated head cannot bias one against the other.
 */
export function readHead(absolute: string, cap: number): string | null {
  let handle: number | null = null;
  try {
    handle = openSync(absolute, constants.O_RDONLY | constants.O_NONBLOCK);
    // **A directory is not an empty file.** Opening one succeeds on Linux and the read then yields nothing, so without
    // this check a directory in the answer space would be indexed as a document with no terms and would be counted
    // among the files the control *did* read - a quiet widening of the denominator. It is also the check that keeps a
    // fifo (which a blocking `open` would wait on forever) out of a job that has a clock.
    const stat = fstatSync(handle);
    if (!stat.isFile()) return null;
    const wanted = Math.min(stat.size, cap);
    const buffer = Buffer.allocUnsafe(wanted);
    const filled = readSync(handle, buffer, 0, wanted, 0);
    return buffer.subarray(0, filled).toString('utf8');
  } catch {
    return null;
  } finally {
    if (handle !== null) closeSync(handle);
  }
}
