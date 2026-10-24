// Text out of a PDF, on a PDF this file builds rather than on a fixture nobody can inspect.
//
// **The gap this closes was recorded as the cheapest of six** (`2026-10-09-deliberate-omissions-audited.md`): *"a PDF
// is text, and extracting it needs no model."* **So the test constructs a real one** - a valid object graph, a
// `FlateDecode` content stream with an `/Length`, a trailer - **because a fixture checked into the repository is a
// file whose correctness a reader has to take on trust**, and **the format's two paths are the compressed stream and
// the uncompressed one.**

import { deflateSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

import { extractPdfText, textOfContentStream, unescapePdfString } from '../pdf-text.js';

/** A minimal valid PDF whose content stream is either compressed or not. */
function makePdf(lines: string[], compress: boolean): Buffer {
  const content = `BT /F1 12 Tf 72 720 Td (${lines[0]}) Tj 0 -14 Td (${lines[1]}) Tj ET`;
  return pdfWithContent(content, compress);
}

/**
 * A PDF around an arbitrary content stream, with the line ending the caller asks for.
 *
 * **The line ending is a parameter because the format allows both**: a producer that writes `stream\r\n` is as correct
 * as one that writes `stream\n`, and the second newline byte is what decides where the stream data starts.
 */
function pdfWithContent(content: string, compress: boolean, eol = '\n'): Buffer {
  const stream = compress
    ? deflateSync(Buffer.from(content, 'latin1'))
    : Buffer.from(content, 'latin1');
  const filter = compress ? ' /Filter /FlateDecode' : '';
  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
    '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>\nendobj\n',
    `4 0 obj\n<< /Length ${stream.length}${filter} >>\nstream${eol}`,
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

  it('finds the stream data when the producer writes CRLF after the keyword', () => {
    // **`stream\r\n` is as legal as `stream\n`**, and the second byte is what says where the data begins. A reader
    // that only skips the line feed leaves a carriage return in front of the first operator.
    const result = extractPdfText(pdfWithContent('BT (crlf body) Tj ET', false, '\r\n'));
    expect(result.text).toBe('crlf body');
  });

  it('skips an uncompressed stream that carries no text object', () => {
    // **A stream that inflated fails to inflate and holds no `BT`** is a font program, an image or a metadata blob -
    // it is counted as skipped rather than decoded as text, because its bytes are not text.
    const result = extractPdfText(pdfWithContent('\u0000\u0001JFIF\u0000raw-bytes', false));
    expect(result.text).toBe('');
    expect(result.streamsSkipped).toBe(1);
    expect(result.streamsRead).toBe(0);
  });

  it('contributes no text when a decoded stream contains only whitespace', () => {
    // **A text object that sets a blank string is not a paragraph**, so it adds nothing to the extraction - and an
    // empty answer must stay empty rather than become a newline.
    const result = extractPdfText(pdfWithContent('BT (   ) Tj ET', false));
    expect(result.text).toBe('');
    expect(result.streamsRead).toBe(1);
  });
});

describe('content stream text', () => {
  it('keeps a backslash that ends the stream, which a truncated document has', () => {
    // The escape pair is incomplete, so there is no next character to read: the loop must stop rather than append
    // `undefined`.
    expect(textOfContentStream('BT (abc\\')).toBe('abc');
  });

  it('reads one, two and three digit octal escapes', () => {
    expect(unescapePdfString('\\101\\60\\12')).toBe('A0\n');
  });

  it('reads the escapes that stand for a character', () => {
    expect(unescapePdfString('a\\nb\\rc\\td\\be\\ff')).toBe('a\nb\rc\td\be\ff');
  });

  it('keeps an escaped parenthesis and backslash literally', () => {
    expect(unescapePdfString('\\(\\)\\\\')).toBe('()\\');
  });

  it('drops the backslash of an escape it does not know', () => {
    expect(unescapePdfString('\\q')).toBe('q');
  });

  it('treats a backslash followed by a non-digit as one escape', () => {
    // `\9` is not octal, so the backslash is dropped and the digit kept.
    expect(unescapePdfString('\\9')).toBe('9');
  });

  it('starts a new line at Td, TD and T*', () => {
    expect(textOfContentStream('BT (one) Td (two) TD (three) T* (four) ET')).toBe(
      'one\ntwo\nthree\nfour\n',
    );
  });

  it('keeps nested parentheses inside a string', () => {
    expect(textOfContentStream('BT (a (b) c) Tj ET')).toBe('a (b) c\n');
  });
});
