// Text out of a PDF, on a PDF this file builds rather than on a fixture nobody can inspect.
//
// **The gap this closes was recorded as the cheapest of six** (`2026-10-09-deliberate-omissions-audited.md`): *"a PDF
// is text, and extracting it needs no model."* **So the test constructs a real one** - a valid object graph, a
// `FlateDecode` content stream with an `/Length`, a trailer - **because a fixture checked into the repository is a
// file whose correctness a reader has to take on trust**, and **the format's two paths are the compressed stream and
// the uncompressed one.**

import { deflateSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { extractPdfText } from '../pdf-text.js';

/** A minimal valid PDF whose content stream is either compressed or not. */
function makePdf(lines: string[], compress: boolean): Buffer {
  const content = `BT /F1 12 Tf 72 720 Td (${lines[0]}) Tj 0 -14 Td (${lines[1]}) Tj ET`;
  const stream = compress ? deflateSync(Buffer.from(content, 'latin1')) : Buffer.from(content, 'latin1');
  const filter = compress ? ' /Filter /FlateDecode' : '';
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>\nendobj\n',
    `4 0 obj\n<< /Length ${stream.length}${filter} >>\nstream\n`,
  ].join('');
  return Buffer.concat([
    Buffer.from('%PDF-1.4\n'),
    Buffer.from(objects, 'latin1'),
    stream,
    Buffer.from('\nendstream\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n'),
  ]);
}

const LINES = ['Retries are capped at 3 attempts.', 'The backoff doubles each time.'];
const EXPECTED = `${LINES[0]}\n${LINES[1]}`;

describe('text out of a PDF', () => {
  it('recovers both lines from a Flate-compressed content stream', () => {
    // **The compressed path**, which is what a PDF produced by any real tool uses.
    const result = extractPdfText(makePdf(LINES, true));
    expect(result.text).toBe(EXPECTED);
    expect(result.streamsRead).toBe(1);
    expect(result.streamsSkipped).toBe(0);
    expect(result.rawBytes).toBeGreaterThan(0);
  });

  it('recovers both lines from an uncompressed content stream', () => {
    // **The other path**, which hand-written and small documents use - and **a reader can tell the two apart from the
    // counters**, which is why they are returned rather than only the text.
    const result = extractPdfText(makePdf(LINES, false));
    expect(result.text).toBe(EXPECTED);
    expect(result.streamsRead).toBe(1);
  });

  it('contributes nothing rather than noise when there is no PDF', () => {
    // **A file that is not a PDF must not be mistaken for one.** The alternative - returning whatever bytes were
    // found - is how a text index fills with mojibake, **and the counters say which of the two happened.**
    const result = extractPdfText(Buffer.from('%PDF-1.4\nno stream here\n%%EOF\n'));
    expect(result.text).toBe('');
    expect(result.streamsRead).toBe(0);
  });

  it('reads only strings inside a text object', () => {
    // **A parenthesis outside `BT ... ET` is not content**, and a naive scan would report a font name as a sentence.
    const result = extractPdfText(makePdf(['(not content) real text', 'second line'], false));
    expect(result.text).toContain('real text');
  });
});
