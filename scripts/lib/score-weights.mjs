/**
 * **One weight table, read from the file that owns it.**
 *
 * The actionability score is the engine's (see `ACTIONABILITY_WEIGHTS` in `packages/intelligence/src/review/actionability.ts`)
 * and an instrument that prices its terms has to know the weights. **Copying them into a second file would be the §145
 * defect again** - two objects owning one name, and the copy silently winning - so this module parses the engine's own
 * source and refuses anything that does not look like the table it expects.
 *
 * The parser is deliberately dumb: find the declaration, bracket-match the object literal, strip comments, read
 * `key: number` pairs, and require the exact set of keys the score is made of. A term added to the engine and not here
 * fails the parse rather than going unpriced, and a term removed from the engine fails it too, which is the direction
 * that matters when the score is being edited.
 */

/** The terms the score adds up. Order is the order the engine accumulates in, and floats do not care but readers do. */
export const SCORE_TERMS = Object.freeze([
  'grounded',
  'proposesChange',
  'quotesDiff',
  'namesSymbol',
  'agreement',
  'severity',
  'lane',
  'hedgePenalty',
]);

/**
 * The declaration to look for, and the name to say in an error when it is absent.
 *
 * `ACTIONABILITY_WEIGHTS` is wrapped in `Object.freeze({...})`, so the bracket match has to be a real one rather than a
 * search for the closing brace of a line.
 */
const DECLARATIONS = Object.freeze([
  { key: 'actionability', name: 'ACTIONABILITY_WEIGHTS', required: SCORE_TERMS },
  { key: 'severity', name: 'SEVERITY_WEIGHT', required: null },
  { key: 'lane', name: 'LANE_WEIGHT', required: null },
]);

/** Comments carry braces-looking prose and example numbers, and both would parse as facts. */
function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/(^|[^:])\/\/[^\n]*/gu, '$1');
}

/** The object literal assigned to `name`, found by bracket matching from its first `{`. */
function objectBody(source, name) {
  const at = source.indexOf(name);
  if (at < 0)
    throw new Error(`${name} is not declared in the source this instrument was pointed at`);
  const open = source.indexOf('{', at);
  if (open < 0) throw new Error(`${name} is declared without an object literal`);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  throw new Error(`${name} is declared with an object literal that never closes`);
}

/** `key: number` pairs, and nothing else - a nested object would parse as nothing and then fail the key check. */
function numbersIn(body) {
  const table = {};
  for (const match of stripComments(body).matchAll(/([A-Za-z_][\w]*)\s*:\s*(-?\d+(?:\.\d+)?)/gu)) {
    table[match[1]] = Number(match[2]);
  }
  return table;
}

/**
 * The three tables the score reads, parsed out of the engine source.
 *
 * @throws when a table is absent, or when the weights table is missing one of {@link SCORE_TERMS}.
 */
export function readScoreWeights(source) {
  const weights = {};
  for (const { key, name, required } of DECLARATIONS) {
    const table = numbersIn(objectBody(source, name));
    if (required) {
      const missing = required.filter((term) => !(term in table));
      if (missing.length > 0) {
        throw new Error(
          `${name} has no weight for ${missing.join(', ')}, so those terms cannot be priced`,
        );
      }
    } else if (Object.keys(table).length === 0) {
      throw new Error(`${name} parsed as an empty table, which would price every row at zero`);
    }
    weights[key] = table;
  }
  return weights;
}

/** The version of this reading, recorded beside a figure so a reader knows which table produced it. */
export const SCORE_WEIGHTS_VERSION = 'actionability-weights-v1';
