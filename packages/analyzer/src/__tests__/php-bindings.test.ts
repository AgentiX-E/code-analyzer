import { CAPTURE_TAGS } from '@code-analyzer/shared';
import { describe, expect, it } from 'vitest';

import { PhpProvider } from '../languages/php.js';

/**
 * PHP's bindings and calls, read from the productions rather than from the text.
 *
 * **`simple_parameter` is `name: (variable_name)`, and `member_call_expression` is `object '->' name(arguments)`** -
 * so the parameter name is one level deeper than a direct-child search looks, and **the method name is a field rather
 * than the tail of `$this->save`**. Both defects named a real node, which is why neither showed up as a wrong count.
 */
describe('PhpProvider bindings and calls', () => {
  const provider = new PhpProvider();
  const names = (source: string, tag: string): string[] =>
    provider
      .parse(source, 'sample.php')
      .filter((c) => c.tag === tag)
      .map((c) => String(c.name));

  it('binds every parameter of a function', () => {
    const source = '<?php\nfunction send($host, $port, $secure) { return $host; }\n';
    expect(names(source, CAPTURE_TAGS.VARIABLE_DEF)).toEqual(
      expect.arrayContaining(['$host', '$port', '$secure']),
    );
  });

  it('binds the parameters of a method, behind its visibility modifier', () => {
    const source = '<?php\nclass C {\n  public function m($id) {}\n}\n';
    expect(names(source, CAPTURE_TAGS.VARIABLE_DEF)).toContain('$id');
  });

  it('names a method call after the method, not after its receiver', () => {
    const source = '<?php\nclass C {\n  function m() { $this->save(); }\n}\n';
    const calls = provider
      .parse(source, 'sample.php')
      .filter((c) => c.tag === CAPTURE_TAGS.METHOD_CALL);
    expect(calls.map((c) => String(c.name))).toEqual(['save']);
  });

  it('records the receiver of a method call as a use', () => {
    const source = '<?php\nclass C {\n  function m() { $this->save(); }\n}\n';
    expect(names(source, CAPTURE_TAGS.VARIABLE_ACCESS)).toContain('$this');
  });

  it('records a free function call', () => {
    expect(names('<?php\nfunction m() { strlen($x); }\n', CAPTURE_TAGS.FUNCTION_CALL)).toContain(
      'strlen',
    );
  });

  it('binds a variable assignment target and records its value as a use', () => {
    const source = '<?php\nfunction m($in) { $out = $in; return $out; }\n';
    expect(names(source, CAPTURE_TAGS.VARIABLE_DEF)).toContain('$out');
    expect(names(source, CAPTURE_TAGS.VARIABLE_ACCESS)).toContain('$in');
  });

  it('does not bind a property assignment as a variable', () => {
    // `$obj->prop = $v` assigns to a property, so the left side is a `member_access_expression` rather than a
    // `variable_name` - it is a use of both names and a def of neither.
    const source = '<?php\nfunction m($v) { $this->prop = $v; }\n';
    expect(names(source, CAPTURE_TAGS.VARIABLE_DEF)).not.toContain('$this->prop');
    expect(names(source, CAPTURE_TAGS.VARIABLE_ACCESS)).toContain('$v');
  });
});
