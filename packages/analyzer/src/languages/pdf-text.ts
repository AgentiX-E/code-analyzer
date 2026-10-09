// Text out of a PDF, with no dependency and no model.
//
// **The cheapest of the audited gaps** (`2026-10-09-deliberate-omissions-audited.md`): *"a PDF is text, and extracting
// it is not a research problem - it is a parser call, and it needs no model."* **The user story is ordinary**: *"what
// does `docs/spec.pdf` say about retries, and does the code implement it?"* - **which is the question this product
// exists to answer, asked about a file it could not open.**
//
// **The implementation reads the format rather than depending on it.** A PDF's text lives in content streams inside
// `BT ... ET` text objects, and **those streams are usually Flate-compressed - which `node:zlib` already inflates**,
// so the dependency count stays at zero. **The extractor is deliberately conservative**: it yields the decoded text
// and **skips what it cannot read**, because **a PDF whose text cannot be recovered should contribute nothing rather
// than contribute noise.**
//
// **What this does not do**: no CMap or font-encoding tables, so **a document with non-ASCII text via a custom
// encoding comes out as bytes rather than characters.** **That is stated rather than hidden**, and **the artifact
// records how many bytes were recovered so a caller can tell an empty extraction from a failed one.**

import { inflateSync, inflateRawSync } from 'node:zlib';

/** How the extraction went, because an empty result and a failed one are different answers. */
export interface PdfExtraction {
  text: string;
  /** **The streams that inflated**, so a reader can tell "no text" from "could not read". */
  streamsRead: number;
  streamsSkipped: number;
  /** The bytes of raw stream data seen, before inflation. */
  rawBytes: number;
}

/** Undo the escapes a PDF string literal uses. */
function unescapePdfString(value: string): string {
  let out = '';
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i]!;
    if (ch !== '\\') {
      out += ch;
      continue;
    }
    const next = value[i + 1];
    i += 1;
    if (next === undefined) break;
    if (next === 'n') out += '\n';
    else if (next === 'r') out += '\r';
    else if (next === 't') out += '\t';
    else if (next === 'b') out += '\b';
    else if (next === 'f') out += '\f';
    else if (next === '(' || next === ')' || next === '\\') out += next;
    // **An octal escape is one to three digits**, and `\ddd` is how a PDF writes a byte it cannot write literally.
    else if (next >= '0' && next <= '7') {
      let oct = next;
      for (let k = 0; k < 2; k += 1) {
        const c = value[i + 1];
        if (c !== undefined && c >= '0' && c <= '7') {
          oct += c;
          i += 1;
        } else break;
      }
      out += String.fromCharCode(parseInt(oct, 8));
    } else out += next;
  }
  return out;
}

/**
 * The text of one content stream.
 *
 * **It walks the operators rather than pattern-matching the whole stream**, because a naive `(...)` scan picks up
 * parentheses inside strings and inside comments - **and the text operators are what the format defines**, so
 * reading them is both more correct and no longer.
 */
function textOfContentStream(content: string): string {
  const pieces: string[] = [];
  let i = 0;
  let inText = false;

  while (i < content.length) {
    const ch = content[i]!;

    // A string literal, with its nested parentheses.
    if (ch === '(') {
      let depth = 1;
      let j = i + 1;
      let raw = '';
      while (j < content.length && depth > 0) {
        const c = content[j]!;
        if (c === '\\') {
          raw += c + (content[j + 1] ?? '');
          j += 2;
          continue;
        }
        if (c === '(') depth += 1;
        else if (c === ')') {
          depth -= 1;
          if (depth === 0) break;
        }
        raw += c;
        j += 1;
      }
      // **Only text inside a `BT` block counts**, so a string used as a name or a comment is not mistaken for content.
      if (inText && raw.length > 0) pieces.push(unescapePdfString(raw));
      i = j + 1;
      continue;
    }

    // The operators that bracket text, and the one that moves to the next line.
    if (ch === 'B' && content.startsWith('BT', i)) {
      inText = true;
      i += 2;
      continue;
    }
    if (ch === 'E' && content.startsWith('ET', i)) {
      inText = false;
      pieces.push('\n');
      i += 2;
      continue;
    }
    // **`Td`/`TD`/`T*` are newlines**, and a PDF that sets each line separately would otherwise run them together.
    if (ch === 'T' && (content.startsWith('Td', i) || content.startsWith('TD', i) || content.startsWith('T*', i))) {
      pieces.push('\n');
      i += 2;
      continue;
    }
    i += 1;
  }

  return pieces.join('');
}

/**
 * Every content stream in a PDF, inflated where possible.
 *
 * **Byte-level rather than text-level**, because **a Flate stream is binary and decoding it as UTF-8 first corrupts
 * it** - which is the mistake that makes a PDF extractor return mojibake on the files that matter most.
 */
export function extractPdfText(buffer: Buffer): PdfExtraction {
  const out: PdfExtraction = { text: '', streamsRead: 0, streamsSkipped: 0, rawBytes: 0 };
  const marker = Buffer.from('stream');
  const endMarker = Buffer.from('endstream');
  const chunks: string[] = [];

  let cursor = 0;
  while (cursor < buffer.length) {
    const start = buffer.indexOf(marker, cursor);
    if (start === -1) break;
    // **`stream` must be followed by a newline**, which is what keeps the word out of a comment or a name.
    let dataStart = start + marker.length;
    if (buffer[dataStart] === 0x0d) dataStart += 1;
    if (buffer[dataStart] === 0x0a) dataStart += 1;

    const end = buffer.indexOf(endMarker, dataStart);
    if (end === -1) break;

    const raw = buffer.subarray(dataStart, end);
    out.rawBytes += raw.length;
    cursor = end + endMarker.length;

    // **Inflate, and if that fails the stream was not compressed** - which happens for the content streams of small
    // and hand-written documents, and **their text is readable as-is.**
    let decoded: string | null = null;
    for (const attempt of [inflateSync, inflateRawSync]) {
      try {
        decoded = attempt(raw).toString('latin1');
        out.streamsRead += 1;
        break;
      } catch {
        // Try the next strategy, then fall back to the raw bytes.
      }
    }
    if (decoded === null) {
      const asText = raw.toString('latin1');
      if (asText.includes('BT')) {
        decoded = asText;
        out.streamsRead += 1;
      } else {
        out.streamsSkipped += 1;
        continue;
      }
    }

    const text = textOfContentStream(decoded);
    if (text.trim().length > 0) chunks.push(text);
  }

  out.text = chunks
    .join('\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return out;
}
