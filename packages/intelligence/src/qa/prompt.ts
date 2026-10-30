// @code-analyzer/intelligence — the prompt an answer is asked with
//
// **Three instructions and a numbered context, and every one of the three is there because its absence was a failure
// mode worth naming.**
//
// 1. **Answer only from the blocks.** A model that knows Django will answer a question about a Flask repository from
//    its memory of Django, correctly and uselessly. The instruction narrows the evidence, and the citation check
//    makes the narrowing observable.
// 2. **Cite a block for every factual claim, with `[n]`.** A pointer is what turns prose into something a reader can
//    audit, and what `verifyCitations` compares against the list it handed out.
// 3. **Say so when the blocks do not answer it.** The honest answer is the one thing an unconstrained model will not
//    produce, because producing an answer is what it is for. **Asking for abstention explicitly is the cheapest
//    improvement available to any grounded surface**, and the alternative - silence from the model - cannot be
//    distinguished from a model that had nothing to say.
//
// **The blocks are rendered with their path and line span first**, because a claim's value to a reader is mostly
// "where", and a model that sees the path writes a claim that can be followed.

import type { ContextBlock } from './types.js';

/** How a block is rendered. **Exported so a test can assert the contract rather than the whole prompt.** */
export function renderBlock(block: ContextBlock): string {
  const where = block.filePath + (block.startLine === null ? '' : `:${block.startLine}`);
  const lines = [`[${block.id}] ${block.qualifiedName} (${block.label}) — ${where}`];
  if (block.signature) lines.push(`    signature: ${block.signature}`);
  if (block.reachedBy) {
    lines.push(`    reached by: ${block.reachedBy.relation} from block [${block.reachedBy.from}]`);
  }
  if (block.body) {
    for (const line of block.body.split('\n')) lines.push(`    ${line}`);
  }
  return lines.join('\n');
}

/**
 * The whole prompt.
 *
 * **`reachedBy` is rendered**, because a structural block that appears without saying why it is there reads as a
 * non-sequitur and a model will invent a relationship to explain it.
 */
export function answerPrompt(question: string, blocks: ContextBlock[]): string {
  return [
    'You are answering a question about a codebase. The numbered blocks below are excerpts from that codebase and',
    'they are the only evidence you have.',
    '',
    `Question: ${question}`,
    '',
    'Context:',
    blocks.map(renderBlock).join('\n\n'),
    '',
    'Rules:',
    '1. Answer only from the blocks above. If they do not contain the answer, say "The indexed code does not answer',
    '   this" and name what would be needed. Do not use knowledge of similar projects.',
    '2. Every factual claim must cite the block it came from, in square brackets, like [3] or [3, 5].',
    '3. Cite only numbers that appear above. There are ' + String(blocks.length) + ' blocks.',
    '4. Be concrete: name the function, the file, and the line. Two or three sentences plus citations is usually',
    '   enough; a list is fine when the answer is a set.',
    '',
    'Answer:',
  ].join('\n');
}
