// What a file's arithmetic says about which of its statements can run at all.
//
// **The gap this closes was measured, not guessed.** OWASP Benchmark's safe cases and its vulnerable cases are the same
// five lines with the arms of one conditional swapped:
//
//     int num = 106;
//     bar = (7 * 18) + num > 200 ? "This_should_always_happen" : param;   // safe: the tainted arm is dead
//     bar = (7 * 18) + num > 200 ? param : "This_should_always_happen";   // vulnerable: the constant arm is dead
//
// A single-block CFG records both assignments as `may`, so `bar` inherits the taint of `param` in both files and the
// analysis is *sound* under a model that cannot ask the question. The benchmark's `switch` cases are the same question
// in another shape - `char switchTarget = guess.charAt(1)` with `guess = "ABC"` decides which arm runs - so both are
// answered here, by one vocabulary and one fixpoint.
//
// The facts below are what a reachability analysis needs and nothing more: **values that a name can only ever hold**,
// and **lines no path reaches**. What to do with them belongs to the analysis, which is where the policy lives.

import { evaluateConstant } from './constant-expression.js';
import { cursorNode, walkPreOrder } from './syntax-cursor.js';

import type { ConditionalOrder, ConstantValue } from './constant-expression.js';
import type { CursorWalkable } from './syntax-cursor.js';
import type { TreeSitterSyntaxNode } from './tree-sitter-base.js';

/** Everything a file's constants say about it. */
export interface ConstantFacts {
  /**
   * Names that can only ever hold one value, in the scope they were written in.
   *
   * **Per scope, not per file**: two methods may both call their local `num`, and a value folded in one is not evidence
   * about the other. The key is `<the callable's first line>:<name>`, and `0` is the file level.
   */
  readonly constants: ReadonlyMap<string, ConstantValue>;
  /**
   * Function names whose every return folds to one value, by name.
   *
   * **A function that can only return `"bob"` hands the caller a constant**, and OWASP Benchmark's `helper` cases are
   * exactly that shape: `String bar = new Test().doSomething(request, param)` where `doSomething` ends in
   * `bar = (7 * 18) + num > 200 ? "This_should_always_happen" : param; return bar;`. The taint analysis sees a call
   * whose argument is tainted and cannot tell that the callee ignores it.
   *
   * **By name, and only when the name is unique in the file**, because this is the one fact that crosses a call
   * boundary and the caller's only handle on the callee is the name it wrote.
   */
  readonly constantReturns: ReadonlyMap<string, ConstantValue>;
  /**
   * The 1-based lines no execution path reaches.
   *
   * **Lines rather than ranges, because the analysis asks per line.** An `if` closes a range and a `switch` closes
   * individual case groups; converting both to one shape here keeps the consumer from re-deriving it.
   */
  readonly unreachableLines: ReadonlySet<number>;
}

/**
 * The node names and field names one grammar uses.
 *
 * **A table rather than a subclass per language**, because the difference between the grammars this project reads is
 * entirely a vocabulary: Java and TypeScript call a declaration the same thing, C wraps it in `init_declarator`, and
 * Python's `if` carries no field names at all. An empty list means "this grammar has no such production".
 */
export interface ConstantDialect {
  /** Nodes that declare a name and may initialise it. */
  readonly declaratorTypes: readonly string[];
  /** Nodes that write an existing name. */
  readonly assignmentTypes: readonly string[];
  /** Nodes that conditionally run a subtree. */
  readonly ifTypes: readonly string[];
  /** Nodes that branch on one value - `switch` in every grammar this project reads. */
  readonly switchTypes: readonly string[];
  /** Nodes that group one or more labels with their statements. */
  readonly switchGroupTypes: readonly string[];
  /** Nodes that form a `default` group of their own, which is how JavaScript and TypeScript spell it. */
  readonly switchDefaultTypes: readonly string[];
  /** Field that carries a `case` label where the grammar has no label node of its own (JavaScript, TypeScript). */
  readonly switchCaseValueField: string;
  /** Nodes whose body is a scope of its own. */
  readonly callableTypes: readonly string[];
  /** Nodes that hand a value back to the caller. */
  readonly returnTypes: readonly string[];
  /**
   * Nodes whose subtree may run zero times, more than once, or only on some paths.
   *
   * **This is the vocabulary of "may not execute", and it is what makes a definition a kill or not.** A definition
   * outside every one of these nodes is reached by every path from the entry and reached once, so it replaces what it
   * overwrites; a definition inside one is a may-definition. A lambda is deliberately absent: its body is a function
   * of its own, and the line ranges that divide functions already keep its statements out of the enclosing one.
   */
  readonly conditionalTypes: readonly string[];
  /** Fields that carry a declarator's name, tried in order. `init_declarator` uses `declarator`. */
  readonly declaratorNameFields: readonly string[];
  /** Field that carries a declarator's initial value. */
  readonly declaratorValueField: string;
  /** Fields of an assignment's two sides. */
  readonly assignmentLeftField: string;
  readonly assignmentRightField: string;
  /** Fields of an `if`, in the order they are tried before falling back to position. */
  readonly ifConditionField: string;
  readonly ifConsequenceField: string;
  readonly ifAlternativeField: string;
  /** Field that carries a `switch` subject, tried before falling back to the first named child. */
  readonly switchConditionField: string;
  /** How the grammar spells a conditional expression. */
  readonly conditionalOrder: ConditionalOrder;
}

/**
 * The vocabulary Java, JavaScript, TypeScript, C, C++, C#, Kotlin, Swift and PHP share.
 *
 * `init_declarator` is listed beside `variable_declarator` because C and C++ wrap the name in the former, and a
 * dialect that named only one of them would silently fold nothing in half the languages it claims.
 */
export const C_FAMILY_CONSTANTS: ConstantDialect = {
  declaratorTypes: ['variable_declarator', 'init_declarator'],
  assignmentTypes: ['assignment_expression', 'assignment'],
  ifTypes: ['if_statement', 'if_expression'],
  switchTypes: ['switch_expression', 'switch_statement'],
  switchGroupTypes: ['switch_block_statement_group', 'switch_case', 'switch_default'],
  switchDefaultTypes: ['switch_default'],
  switchCaseValueField: 'value',
  callableTypes: [
    'method_declaration',
    'constructor_declaration',
    'function_declaration',
    'function_definition',
    'method_definition',
    'arrow_function',
    'local_function',
  ],
  // `return_statement` is the spelling Java, JavaScript, TypeScript, Python, C, C++, C#, Go and PHP share. A grammar
  // that spells it otherwise names its own, which is why this is a table entry rather than a constant in the walk.
  returnTypes: ['return_statement'],
  // Spelled out rather than derived from `ifTypes` and `switchTypes`, because the set is larger than either: a loop
  // body may run zero times, and a `catch` may not run at all. Every grammar this project reads shares these names
  // except Python, which overrides the list below.
  conditionalTypes: [
    'if_statement',
    'if_expression',
    'ternary_expression',
    'conditional_expression',
    'for_statement',
    'for_in_statement',
    'for_of_statement',
    'enhanced_for_statement',
    'while_statement',
    'do_statement',
    'switch_statement',
    'switch_expression',
    'try_statement',
    'try_with_resources_statement',
    'catch_clause',
    'finally_clause',
  ],
  declaratorNameFields: ['name', 'declarator'],
  declaratorValueField: 'value',
  assignmentLeftField: 'left',
  assignmentRightField: 'right',
  ifConditionField: 'condition',
  ifConsequenceField: 'consequence',
  ifAlternativeField: 'alternative',
  switchConditionField: 'condition',
  conditionalOrder: 'condition-consequence-alternative',
};

/** Python's spelling: one `assignment` node, an `if` with no field names, and the condition between the arms. */
export const PYTHON_CONSTANTS: ConstantDialect = {
  ...C_FAMILY_CONSTANTS,
  declaratorTypes: [],
  assignmentTypes: ['assignment'],
  callableTypes: ['function_definition'],
  // Python's `try`/`except`/`with` spell the clause differently and its `if` is the shared name, so only the
  // differences are listed: `elif_clause` and `else_clause` sit inside an `if_statement` and are named anyway, because
  // a caller reading this field alone should not have to know the grammar's nesting.
  conditionalTypes: [
    'if_statement',
    'conditional_expression',
    'for_statement',
    'while_statement',
    'try_statement',
    'except_clause',
    'elif_clause',
    'else_clause',
    'with_statement',
    'match_statement',
    'case_clause',
  ],
  conditionalOrder: 'consequence-condition-alternative',
};

/** A plain identifier, which is the only thing this module can name in an environment. */
const SIMPLE_NAME = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** Statement kinds that leave the switch, and therefore end a fall-through. */
const JUMPS_OUT: ReadonlySet<string> = new Set([
  'break_statement',
  'return_statement',
  'throw_statement',
  'continue_statement',
]);

/**
 * How many times the two halves are solved against each other.
 *
 * **A line a constant closes stops its writes from counting**, and a write that stops counting can decide another
 * constant, so the two answers depend on each other. Each round is monotone in the dead lines - a suppressed write can
 * only add constants, and more constants can only close more lines - so the fixpoint is reached in a handful of rounds.
 * Three is enough for every corpus this has run on and cheap enough to always spend.
 */
const MAX_ROUNDS = 3;

/** A pair of inclusive lines. */
interface LineSpan {
  readonly startLine: number;
  readonly endLine: number;
}

/** One statement that writes a name. */
interface WriteEvent {
  readonly kind: 'write';
  readonly scope: number;
  readonly line: number;
  readonly name: string;
  readonly text: string;
}

/** An `if` whose arms are decided once the environment is known. */
interface BranchEvent {
  readonly kind: 'branch';
  readonly scope: number;
  readonly line: number;
  readonly condition: string;
  readonly consequence: LineSpan | null;
  readonly alternative: LineSpan | null;
}

/** What one arm matches: the literals its label names, or the `default` arm. */
type ArmLabel =
  { readonly kind: 'labels'; readonly values: readonly string[] } | { readonly kind: 'default' };

/** One arm of a `switch`, with what it matches and whether it falls through. */
interface SwitchArm {
  readonly label: ArmLabel;
  readonly span: LineSpan;
  /** Whether this arm's own statements leave the switch, ending a fall-through into the next arm. */
  readonly jumpsOut: boolean;
}

/** A `return`, whose value may fold once the environment is known. */
interface ReturnEvent {
  readonly kind: 'return';
  readonly scope: number;
  readonly line: number;
  readonly text: string;
}

/** A `switch` whose arms are decided once the environment is known. */
interface SwitchEvent {
  readonly kind: 'switch';
  readonly scope: number;
  readonly line: number;
  readonly subject: string;
  readonly arms: readonly SwitchArm[];
}

type Event = WriteEvent | BranchEvent | SwitchEvent | ReturnEvent;

/**
 * Everything one file's constants say about it.
 *
 * @param root the tree (or node) to read; nothing is materialised except the nodes a rule names
 */
export function extractConstantFacts(
  root: CursorWalkable,
  dialect: ConstantDialect = C_FAMILY_CONSTANTS,
): ConstantFacts {
  const { events, scopeNames } = collect(root, dialect);
  // Source order, so a value is only ever substituted into a statement that follows the one that produced it.
  events.sort((left, right) => left.line - right.line);

  let dead = new Set<number>();
  let environments = new Map<number, Map<string, ConstantValue>>();

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const solved = solve(events, dead, dialect);
    const settled = noNewDeadLines(dead, solved.dead);
    dead = solved.dead;
    environments = solved.environments;
    if (settled) break;
  }

  return {
    constants: flatten(environments),
    constantReturns: constantReturns(events, environments, scopeNames, dead, dialect),
    unreachableLines: dead,
  };
}

/**
 * Functions whose every return folds to one value.
 *
 * **One return, or several that agree.** A function with two returns that fold to the same constant hands back that
 * constant whatever path ran; a function with two that disagree hands back either, and neither is a fact a caller can
 * use. A return the evaluator cannot read leaves the function out entirely - the conservative direction, because the
 * caller's argument may be what comes back.
 *
 * **A return on a dead line does not count**, for the same reason its statements do not run.
 */
function constantReturns(
  events: readonly Event[],
  environments: ReadonlyMap<number, Map<string, ConstantValue>>,
  scopeNames: ReadonlyMap<number, string>,
  dead: ReadonlySet<number>,
  dialect: ConstantDialect,
): Map<string, ConstantValue> {
  const folded = new Map<number, ConstantValue | null>();

  for (const event of events) {
    if (event.kind !== 'return' || dead.has(event.line)) continue;
    const value = evaluateConstant(event.text, environments.get(event.scope) ?? new Map(), {
      conditionalOrder: dialect.conditionalOrder,
    });
    const previous = folded.get(event.scope);
    if (previous === undefined) {
      folded.set(event.scope, value ?? null);
      continue;
    }
    // Two returns that disagree, or one that could not be read, make the function's result unknown.
    if (value === undefined || previous === null || previous !== value)
      folded.set(event.scope, null);
  }

  // **A name written twice in one file answers nothing.** The caller knows the callee by name alone, so a second
  // declaration with the same spelling makes the answer ambiguous, and an ambiguous constant is not a constant.
  const seen = new Set<string>();
  const duplicated = new Set<string>();
  for (const name of scopeNames.values()) {
    if (seen.has(name)) duplicated.add(name);
    seen.add(name);
  }

  const returns = new Map<string, ConstantValue>();
  for (const [scope, value] of folded) {
    const name = scopeNames.get(scope);
    if (value === null || name === undefined || duplicated.has(name)) continue;
    returns.set(name, value);
  }
  return returns;
}

/** Read the tree once, recording every write and every branch without deciding anything. */
function collect(
  root: CursorWalkable,
  dialect: ConstantDialect,
): { events: Event[]; scopeNames: Map<number, string> } {
  const events: Event[] = [];

  /** The innermost callable being walked, by its first line, or 0 outside every one of them. */
  let scope = 0;
  let scopeDepth = -1;
  /** What each callable is called, so a return can be named for a caller that only knows the name it wrote. */
  const scopeNames = new Map<number, string>();

  walkPreOrder(root, (type, depth, cursor) => {
    // **Leaving a callable is detected by depth**, because the walk has no exit event and the next node after a body is
    // at the body's depth or above it. A nested callable becomes the scope; returning from it does not restore the
    // outer one, which is the conservative direction - an outer statement then shares a scope with nobody.
    if (scopeDepth >= 0 && depth <= scopeDepth) {
      scope = 0;
      scopeDepth = -1;
    }

    if (dialect.callableTypes.includes(type)) {
      scope = cursor.startPosition.row + 1;
      scopeDepth = depth;
      const name = cursorNode<TreeSitterSyntaxNode>(cursor).childForFieldName('name')?.text;
      if (name !== undefined) scopeNames.set(scope, name);
      return;
    }

    if (dialect.returnTypes.includes(type)) {
      const statement = cursorNode<TreeSitterSyntaxNode>(cursor);
      // A bare `return;` returns nothing, and nothing here has a value to fold.
      if (statement.namedChildCount === 0) return;
      events.push({
        kind: 'return',
        scope,
        line: statement.startPosition.row + 1,
        text: statement.namedChild(0).text,
      });
      return;
    }

    if (dialect.declaratorTypes.includes(type) || dialect.assignmentTypes.includes(type)) {
      const write = readWrite(cursorNode<TreeSitterSyntaxNode>(cursor), type, dialect);
      if (!write) return;
      events.push({ kind: 'write', scope, line: write.line, name: write.name, text: write.text });
      return;
    }

    if (dialect.ifTypes.includes(type)) {
      const node = cursorNode<TreeSitterSyntaxNode>(cursor);
      // Every grammar's `if` carries a condition - it is the field named here, or the node's first child - so there is
      // no absent-condition case to branch on.
      const condition = fieldOrChild(node, dialect.ifConditionField, 0)!;
      events.push({
        kind: 'branch',
        scope,
        line: node.startPosition.row + 1,
        condition: condition.text,
        consequence: spanOf(fieldOrChild(node, dialect.ifConsequenceField, 1)),
        alternative: spanOf(fieldOrChild(node, dialect.ifAlternativeField, 2)),
      });
      return;
    }

    if (!dialect.switchTypes.includes(type)) return;
    events.push(readSwitch(cursorNode<TreeSitterSyntaxNode>(cursor), scope, dialect));
  });

  return { events, scopeNames };
}

/** A `switch`, as the arms that decide which of its statements can run. */
function readSwitch(
  node: TreeSitterSyntaxNode,
  scope: number,
  dialect: ConstantDialect,
): SwitchEvent {
  // Every grammar's `switch` carries a subject, whether the field is named `condition` or `value` or only the first
  // named child holds it.
  const subject = fieldOrChild(node, dialect.switchConditionField, 0)!;
  const arms: SwitchArm[] = [];

  walkPreOrder(node, (type, depth, cursor) => {
    if (depth === 0 || !dialect.switchGroupTypes.includes(type)) return;
    arms.push(readArm(cursorNode<TreeSitterSyntaxNode>(cursor), dialect));
  });

  return {
    kind: 'switch',
    scope,
    line: node.startPosition.row + 1,
    subject: subject.text,
    arms,
  };
}

/**
 * One arm, read from its group's own children.
 *
 * **The label is spelled two ways, and both of them are text.** Java wraps it in a `switch_label` node whose text is
 * `case 'A':`; JavaScript and TypeScript have no such node and hang the label on the `case` as the `value` field, whose
 * text is `'A'`. Reading the text rather than the node type is what lets one function serve both - and it is why this
 * file needs no per-language branch here, only a field name.
 */
function readArm(group: TreeSitterSyntaxNode, dialect: ConstantDialect): SwitchArm {
  const span = spanOf(group)!;
  const last = group.namedChild(group.namedChildCount - 1);
  const jumpsOut = last !== null && JUMPS_OUT.has(last.type);
  // `default` is a group of its own in JavaScript and TypeScript, and a label inside the group in Java.
  if (dialect.switchDefaultTypes.includes(group.type))
    return { label: { kind: 'default' }, span, jumpsOut };
  return { label: labelFromText(labelText(group, dialect)), span, jumpsOut };
}

/** The text that names what an arm matches: the label node where the grammar has one, the value field where it does not. */
function labelText(group: TreeSitterSyntaxNode, dialect: ConstantDialect): string {
  return (group.childForFieldName(dialect.switchCaseValueField) ?? group.namedChild(0)).text;
}

/**
 * The label a piece of text names.
 *
 * **A `case` label may carry several literals and a bare one carries exactly one.** `case 'A', 'B':` matches either in
 * Java, so its text is split on commas; JavaScript's and TypeScript's label is already the value expression, and there
 * a comma would be a comma *operator* - `case (1, 2):` matches only 2 - so it is not split.
 */
function labelFromText(text: string): ArmLabel {
  const trimmed = text.trim();
  if (trimmed.startsWith('default')) return { kind: 'default' };
  if (!trimmed.startsWith('case')) return { kind: 'labels', values: [trimmed] };
  const body = trimmed
    .replace(/^case\s*/, '')
    .replace(/:\s*$/, '')
    .trim();
  return { kind: 'labels', values: body.split(',').map((entry) => entry.trim()) };
}

/** The lines one node spans, or `null` for an arm that is not there. */
function spanOf(node: TreeSitterSyntaxNode | null): LineSpan | null {
  return node === null
    ? null
    : { startLine: node.startPosition.row + 1, endLine: node.endPosition.row + 1 };
}

/** Fold every event against a given set of dead lines, and report what falls out. */
function solve(
  events: readonly Event[],
  dead: ReadonlySet<number>,
  dialect: ConstantDialect,
): { environments: Map<number, Map<string, ConstantValue>>; dead: Set<number> } {
  // **A write on a dead line does not count**, which is what lets a `switch` whose other arms are closed fold the one
  // name it does write. Counting it would make every switch-written name look written many times and fold nothing.
  const writes = new Map<string, number>();
  for (const event of events) {
    if (event.kind !== 'write' || dead.has(event.line)) continue;
    const key = `${event.scope}:${event.name}`;
    writes.set(key, (writes.get(key) ?? 0) + 1);
  }

  const environments = new Map<number, Map<string, ConstantValue>>();
  const nextDead = new Set<number>();

  for (const event of events) {
    // A return is not a branch: which statements run does not depend on it here, and its value is read in
    // `constantReturns` once the environment has settled.
    if (event.kind === 'return') continue;
    if (event.kind === 'write') {
      if (dead.has(event.line)) continue;
      // A name written more than once holds no single value, and writes nothing into the environment either - a stale
      // value from before the second write would be exactly the mistake this guard exists to prevent.
      if (writes.get(`${event.scope}:${event.name}`) !== 1) continue;
      const environment = environmentFor(environments, event.scope);
      const value = evaluateConstant(event.text, environment, {
        conditionalOrder: dialect.conditionalOrder,
      });
      if (value !== undefined) environment.set(event.name, value);
      continue;
    }

    const environment = environmentFor(environments, event.scope);
    if (event.kind === 'branch') {
      const value = evaluateConstant(event.condition, environment, {
        conditionalOrder: dialect.conditionalOrder,
      });
      if (typeof value !== 'boolean') continue;
      addSpan(nextDead, value ? event.alternative : event.consequence);
      continue;
    }

    const value = evaluateConstant(event.subject, environment, {
      conditionalOrder: dialect.conditionalOrder,
    });
    if (value === undefined) continue;
    for (const span of closedArms(event.arms, value, dialect, environment)) {
      addSpan(nextDead, span);
    }
  }

  return { environments, dead: nextDead };
}

/**
 * The arms of a `switch` whose statements cannot run, given the value of its subject.
 *
 * **Fall-through is the whole difficulty.** A `case` with no `break` runs into the next one, so every arm after the one
 * that matches is reachable until some arm leaves the switch. Marking those dead would suppress a real flow, which is
 * the one direction this module must never take.
 */
function closedArms(
  arms: readonly SwitchArm[],
  value: ConstantValue,
  dialect: ConstantDialect,
  environment: ReadonlyMap<string, ConstantValue>,
): LineSpan[] {
  const verdicts = arms.map((arm) => verdictOf(arm, value, dialect, environment));
  const closed: LineSpan[] = [];

  // **A label that cannot be folded makes the whole switch open.** The arm it names may be the one that runs, and
  // entering a fall-through chain in the middle makes every arm after it reachable - so nothing here is closed.
  if (verdicts.includes('unknown')) return closed;

  const entry = verdicts.indexOf('match');
  const fallback = verdicts.indexOf('default');

  // Nothing matches and there is no `default`: no arm runs at all.
  if (entry < 0 && fallback < 0) return arms.map((arm) => arm.span);

  const start = entry >= 0 ? entry : fallback;
  for (let index = 0; index < start; index++) closed.push(arms[index]!.span);

  // From the entry onwards, an arm runs until an arm before it leaves the switch.
  let reachedJump = false;
  for (let index = start; index < arms.length; index++) {
    const arm = arms[index]!;
    // **A `default` arm that is not the entry cannot run once a `case` matched**, because the match decides the jump.
    const shadowed = index > start && verdicts[index] === 'default' && entry >= 0;
    if (reachedJump || shadowed) {
      closed.push(arm.span);
      continue;
    }
    if (arm.jumpsOut) reachedJump = true;
  }

  return closed;
}

/** Whether one arm matches the subject's value. */
function verdictOf(
  arm: SwitchArm,
  value: ConstantValue,
  dialect: ConstantDialect,
  environment: ReadonlyMap<string, ConstantValue>,
): 'match' | 'no' | 'default' | 'unknown' {
  if (arm.label.kind === 'default') return 'default';

  let matched = false;
  for (const label of arm.label.values) {
    const folded = evaluateConstant(label, environment, {
      conditionalOrder: dialect.conditionalOrder,
    });
    // A label the evaluator cannot read is a label that may match, and guessing either way is worse than saying so.
    if (folded === undefined) return 'unknown';
    if (folded === value) matched = true;
  }
  return matched ? 'match' : 'no';
}

/** Add every line of a span, or nothing when there is no span. */
function addSpan(lines: Set<number>, span: LineSpan | null): void {
  if (!span) return;
  for (let line = span.startLine; line <= span.endLine; line++) lines.add(line);
}

/**
 * Whether a round added no dead line, which is what ends the fixpoint.
 *
 * **Comparing counts is enough because the dead lines only ever grow.** A suppressed write can only add constants, and
 * a constant can only close more lines, so a round that closes nothing new closes nothing at all: different dead lines
 * of the same size would mean some line had been un-closed, which nothing in the model can do. The set comparison that
 * stood here was therefore a second answer to a question the sizes had already settled.
 */
function noNewDeadLines(previous: ReadonlySet<number>, next: ReadonlySet<number>): boolean {
  return previous.size === next.size;
}

/**
 * One map of name to value, with each scope's namespaced away from every other scope's.
 *
 * **The key carries the scope, because the value does not**: a caller asks "can the name `num` in this function hold
 * anything but this", and two functions' `num` are two different questions with the same spelling.
 */
function flatten(
  environments: ReadonlyMap<number, Map<string, ConstantValue>>,
): Map<string, ConstantValue> {
  const flat = new Map<string, ConstantValue>();
  for (const [scope, environment] of environments) {
    for (const [name, value] of environment) flat.set(`${scope}:${name}`, value);
  }
  return flat;
}

function environmentFor(
  environments: Map<number, Map<string, ConstantValue>>,
  scope: number,
): Map<string, ConstantValue> {
  let environment = environments.get(scope);
  if (!environment) {
    environment = new Map();
    environments.set(scope, environment);
  }
  return environment;
}

/** The name and right-hand side of one write, or `null` when either is not something this module can read. */
function readWrite(
  node: TreeSitterSyntaxNode,
  type: string,
  dialect: ConstantDialect,
): { line: number; name: string; text: string } | null {
  const isDeclaration = dialect.declaratorTypes.includes(type);
  const nameNode = isDeclaration
    ? firstField(node, dialect.declaratorNameFields)
    : node.childForFieldName(dialect.assignmentLeftField);
  const valueNode = isDeclaration
    ? node.childForFieldName(dialect.declaratorValueField)
    : node.childForFieldName(dialect.assignmentRightField);

  // **A declaration without an initialiser writes nothing**, which is the difference between `String bar;` and
  // `bar = ...`: counting the former as a write would make every declared-then-assigned variable look written twice and
  // stop the one assignment it has from ever folding.
  if (!nameNode || !valueNode) return null;
  const name = nameNode.text;
  if (!SIMPLE_NAME.test(name)) return null;
  return { line: node.startPosition.row + 1, name, text: valueNode.text };
}

/** A field, falling back to the n-th named child for a grammar that has no field names. */
function fieldOrChild(
  node: TreeSitterSyntaxNode,
  field: string,
  index: number,
): TreeSitterSyntaxNode | null {
  const byField = node.childForFieldName(field);
  if (byField) return byField;
  return node.namedChildCount > index ? node.namedChild(index) : null;
}

/** The first of several possible name fields that is present. */
function firstField(
  node: TreeSitterSyntaxNode,
  fields: readonly string[],
): TreeSitterSyntaxNode | null {
  for (const field of fields) {
    const found = node.childForFieldName(field);
    if (found) return found;
  }
  return null;
}
