// @code-analyzer/analyzer — Svelte Language Provider Tests
import { describe, it, expect } from 'vitest';
import { CAPTURE_TAGS } from '@code-analyzer/shared';

import { SvelteProvider } from '../languages/svelte.js';

describe('SvelteProvider', () => {
  const provider = new SvelteProvider();

  describe('language metadata', () => {
    it('should report correct language', () => {
      expect(provider.language).toBe('svelte');
    });

    it('should have correct display name', () => {
      expect(provider.displayName).toBe('Svelte');
    });

    it('should have .svelte extension', () => {
      expect(provider.extensions).toContain('.svelte');
      expect(provider.extensions.length).toBe(1);
    });

    it('should have correct globs', () => {
      expect(provider.globs).toContain('**/*.svelte');
    });

    it('should have "named" import semantics', () => {
      expect(provider.importSemantics).toBe('named');
    });
  });

  describe('parse', () => {
    it('should parse import statements from script blocks', () => {
      const code = `<script>
  import { onMount } from 'svelte';
  import Component from './Component.svelte';
</script>
<h1>Hello</h1>`;
      const captures = provider.parse(code, 'test.svelte');
      const imports = captures.filter((c) => c.tag === CAPTURE_TAGS.IMPORT);
      expect(imports.length).toBeGreaterThanOrEqual(2);
      expect(imports.some((c) => c.name === 'svelte')).toBe(true);
      expect(imports.some((c) => c.name === './Component.svelte')).toBe(true);
    });

    it('should parse import with namespace in script blocks', () => {
      const code = `<script>
  import * as utils from './utils.js';
</script>`;
      const captures = provider.parse(code, 'test.svelte');
      const imports = captures.filter((c) => c.tag === CAPTURE_TAGS.IMPORT);
      expect(imports.length).toBeGreaterThanOrEqual(1);
      expect(imports[0]!.name).toBe('./utils.js');
    });

    it('should parse reactive declarations ($:)', () => {
      const code = `<script>
  let count = 0;
  $: doubled = count * 2;
  $: console.log(count);
</script>`;
      const captures = provider.parse(code, 'test.svelte');
      const reactive = captures.filter(
        (c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF && c.properties?.reactive === 'true',
      );
      expect(reactive.some((c) => c.name === 'doubled')).toBe(true);
    });

    it('should parse component props (export let)', () => {
      const code = `<script>
  export let title = '';
  export let count = 0;
</script>`;
      const captures = provider.parse(code, 'test.svelte');
      const props = captures.filter((c) => c.tag === CAPTURE_TAGS.COMPONENT_PROPS);
      expect(props.some((c) => c.name === 'title')).toBe(true);
      expect(props.some((c) => c.name === 'count')).toBe(true);
      expect(props[0]!.properties?.componentProp).toBe('true');
    });

    it('should parse exported functions', () => {
      const code = `<script context="module">
  export function preload() {
    return { props: {} };
  }
</script>`;
      const captures = provider.parse(code, 'test.svelte');
      const funcs = captures.filter(
        (c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF && c.properties?.exported === 'true',
      );
      expect(funcs.some((c) => c.name === 'preload')).toBe(true);
    });

    it('should parse exported constants', () => {
      const code = `<script context="module">
  export const prerender = true;
  export const ssr = false;
</script>`;
      const captures = provider.parse(code, 'test.svelte');
      const constants = captures.filter(
        (c) => c.tag === CAPTURE_TAGS.CONSTANT_DEF && c.properties?.exported === 'true',
      );
      expect(constants.some((c) => c.name === 'prerender')).toBe(true);
      expect(constants.some((c) => c.name === 'ssr')).toBe(true);
    });

    it('should parse non-exported function definitions', () => {
      const code = `<script>
  function handleClick() {
    alert('clicked');
  }

  function reset() {
    count = 0;
  }
</script>`;
      const captures = provider.parse(code, 'test.svelte');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs.some((c) => c.name === 'handleClick')).toBe(true);
      expect(funcs.some((c) => c.name === 'reset')).toBe(true);
    });

    it('should parse arrow functions', () => {
      const code = `<script>
  const formatDate = (date) => {
    return date.toISOString();
  };

  let items = [];
</script>`;
      const captures = provider.parse(code, 'test.svelte');
      const arrowFuncs = captures.filter(
        (c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF && c.properties?.arrow === 'true',
      );
      expect(arrowFuncs.some((c) => c.name === 'formatDate')).toBe(true);
    });

    it('should parse exported arrow functions', () => {
      const code = `<script context="module">
  export const load = async ({ fetch }) => {
    const res = await fetch('/api/data');
    return { props: { data: await res.json() } };
  };
</script>`;
      const captures = provider.parse(code, 'test.svelte');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs.some((c) => c.name === 'load')).toBe(true);
    });

    it('should parse async functions', () => {
      const code = `<script>
  async function fetchData() {
    const res = await fetch('/api');
    return res.json();
  }
</script>`;
      const captures = provider.parse(code, 'test.svelte');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs.some((c) => c.name === 'fetchData')).toBe(true);
    });

    it('should parse variable declarations', () => {
      const code = `<script>
  let name = 'world';
  const MAX_ITEMS = 100;
  var oldStyle = 'legacy';
</script>`;
      const captures = provider.parse(code, 'test.svelte');
      const vars = captures.filter((c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF);
      expect(vars.some((c) => c.name === 'name')).toBe(true);
      const constants = captures.filter((c) => c.tag === CAPTURE_TAGS.CONSTANT_DEF);
      expect(constants.some((c) => c.name === 'MAX_ITEMS')).toBe(true);
    });

    it('should parse plain declarations without an initializer', () => {
      const code = `<script>
  let pending;
  const ready;
</script>`;
      const captures = provider.parse(code, 'test.svelte');
      const vars = captures.filter((c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF);
      expect(vars.some((c) => c.name === 'pending')).toBe(true);
      expect(vars.some((c) => c.name === 'ready')).toBe(true);
    });

    it('should detect custom components in template', () => {
      const code = `<script>
  import Header from './Header.svelte';
</script>

<Header title="Home" />
<main>
  <UserCard name="Alice" />
  <footer-items />
</main>`;
      const captures = provider.parse(code, 'test.svelte');
      const components = captures.filter(
        (c) => c.tag === CAPTURE_TAGS.FUNCTION_CALL && c.properties?.component === 'true',
      );
      expect(components.some((c) => c.name === 'Header')).toBe(true);
      expect(components.some((c) => c.name === 'UserCard')).toBe(true);
      expect(components.some((c) => c.name === 'footer-items')).toBe(true);
    });

    it('should not detect standard HTML tags as components', () => {
      const code = `<script>
  let name = 'world';
</script>

<main>
  <div class="container">
    <h1>Hello {name}</h1>
    <p>Welcome</p>
    <button on:click={handleClick}>Click</button>
  </div>
</main>`;
      const captures = provider.parse(code, 'test.svelte');
      const components = captures.filter(
        (c) => c.tag === CAPTURE_TAGS.FUNCTION_CALL && c.properties?.component === 'true',
      );
      // No custom components (div, h1, p, button are standard HTML)
      expect(components.length).toBe(0);
    });

    it('should handle empty files', () => {
      const captures = provider.parse('', 'empty.svelte');
      expect(Array.isArray(captures)).toBe(true);
      expect(captures.length).toBe(0);
    });

    it('should handle files with only template (no script)', () => {
      const code = '<h1>Hello World</h1>';
      const captures = provider.parse(code, 'template-only.svelte');
      expect(Array.isArray(captures)).toBe(true);
    });

    it('should handle files with only style block', () => {
      const code = `<style>
  h1 { color: red; }
</style>`;
      const captures = provider.parse(code, 'style-only.svelte');
      expect(Array.isArray(captures)).toBe(true);
    });

    it('should return captures sorted by line', () => {
      const code = `<script>
  import { onMount } from 'svelte';
  let count = 0;
  $: doubled = count * 2;
  function increment() { count++; }
</script>

<Header />
<Footer />`;
      const captures = provider.parse(code, 'test.svelte');
      for (let i = 1; i < captures.length; i++) {
        expect(captures[i].startLine).toBeGreaterThanOrEqual(captures[i - 1].startLine);
      }
    });

    it('should include filePath in properties', () => {
      const code = `<script>
  let name = 'test';
</script>`;
      const captures = provider.parse(code, 'my-component.svelte');
      const v = captures.find((c) => c.name === 'name');
      expect(v?.properties?.filePath).toBe('my-component.svelte');
    });

    it('should handle script with TypeScript lang attribute', () => {
      const code = `<script lang="ts">
  export let title: string;
  const items: string[] = [];
</script>`;
      const captures = provider.parse(code, 'ts-component.svelte');
      const props = captures.filter((c) => c.tag === CAPTURE_TAGS.COMPONENT_PROPS);
      expect(props.some((c) => c.name === 'title')).toBe(true);
    });

    it('should not capture elements inside script or style blocks', () => {
      const code = `<script>
  let component = '<div>test</div>';
</script>
<style>
  .header { color: blue; }
</style>
<Header />`;
      const captures = provider.parse(code, 'test.svelte');
      // Header is PascalCase (custom component), not a standard HTML tag
      // But the template section has <Header /> which should be captured
      const components = captures.filter(
        (c) => c.tag === CAPTURE_TAGS.FUNCTION_CALL && c.properties?.component === 'true',
      );
      expect(components.length).toBeGreaterThanOrEqual(1);
    });

    it('should skip component-like tags inside script and style blocks', () => {
      const code = `<script>
  const template = '<MyComponent />';
  const el = '<my-widget></my-widget>';
</script>
<style>
  /* <AnotherComponent /> */
</style>`;
      const captures = provider.parse(code, 'test.svelte');
      const components = captures.filter(
        (c) => c.tag === CAPTURE_TAGS.FUNCTION_CALL && c.properties?.component === 'true',
      );
      expect(components.length).toBe(0);
    });

    it('should handle multiple script blocks', () => {
      const code = `<script context="module">
  export const load = async () => ({ props: {} });
</script>

<script>
  export let data;
  let localState = 'test';
</script>`;
      const captures = provider.parse(code, 'multi-script.svelte');
      const funcs = captures.filter((c) => c.tag === CAPTURE_TAGS.FUNCTION_DEF);
      expect(funcs.some((c) => c.name === 'load')).toBe(true);
      const variables = captures.filter((c) => c.tag === CAPTURE_TAGS.VARIABLE_DEF);
      expect(variables.some((c) => c.name === 'localState')).toBe(true);
    });
  });

  describe('extractImports', () => {
    it('should extract default imports', () => {
      const code = `<script>
  import App from './App.svelte';
</script>`;
      const imports = provider.extractImports(code);
      expect(imports.length).toBeGreaterThanOrEqual(1);
      expect(imports[0]!.source).toBe('./App.svelte');
      expect(imports[0]!.type).toBe('default');
    });

    it('should extract named imports', () => {
      const code = `<script>
  import { onMount, tick } from 'svelte';
</script>`;
      const imports = provider.extractImports(code);
      expect(imports.length).toBeGreaterThanOrEqual(1);
      expect(imports[0]!.source).toBe('svelte');
      expect(imports[0]!.type).toBe('named');
      expect(imports[0]!.names).toContain('onMount');
      expect(imports[0]!.names).toContain('tick');
    });

    it('should extract namespace imports', () => {
      const code = `<script>
  import * as svelte from 'svelte';
</script>`;
      const imports = provider.extractImports(code);
      expect(imports.length).toBeGreaterThanOrEqual(1);
      expect(imports[0]!.type).toBe('namespace');
    });

    it('should extract imports with aliases', () => {
      const code = `<script>
  import { onMount as mount } from 'svelte';
</script>`;
      const imports = provider.extractImports(code);
      expect(imports.length).toBeGreaterThanOrEqual(1);
      expect(imports[0]!.names).toContain('mount');
    });

    it('should include line numbers in imports', () => {
      const code = `<script>
import { onMount } from 'svelte';
</script>`;
      const imports = provider.extractImports(code);
      expect(imports.length).toBeGreaterThanOrEqual(1);
      expect(imports[0]!.lineNumber).toBe(2);
    });

    it('should handle files without imports', () => {
      const code = `<script>
  let x = 1;
</script>`;
      const imports = provider.extractImports(code);
      expect(imports.length).toBe(0);
    });

    it('should extract imports from context="module" script blocks', () => {
      const code = `<script context="module">
  import { browser } from '$app/environment';
</script>`;
      const imports = provider.extractImports(code);
      expect(imports.length).toBeGreaterThanOrEqual(1);
      expect(imports[0]!.source).toBe('$app/environment');
    });

    it('should extract dynamic imports', () => {
      const code = `<script>
  const mod = import('./lazy.js');
</script>`;
      const imports = provider.extractImports(code);
      expect(imports.some((i) => i.source === './lazy.js')).toBe(true);
    });
  });

  describe('isExported', () => {
    it('should detect exported function', () => {
      const code = `<script>
  export function myFunc() {}
</script>`;
      expect(provider.isExported(code, 'myFunc')).toBe(true);
    });

    it('should detect exported const', () => {
      const code = `<script>
  export const myConst = 42;
</script>`;
      expect(provider.isExported(code, 'myConst')).toBe(true);
    });

    it('should detect exported let', () => {
      const code = `<script>
  export let myProp;
</script>`;
      expect(provider.isExported(code, 'myProp')).toBe(true);
    });

    it('should detect named exports', () => {
      const code = `<script>
  function helper() {}
  export { helper };
</script>`;
      expect(provider.isExported(code, 'helper')).toBe(true);
    });

    it('should return false for non-exported symbols', () => {
      const code = `<script>
  function internalHelper() {}
  let localVar = 5;
</script>`;
      expect(provider.isExported(code, 'internalHelper')).toBe(false);
      expect(provider.isExported(code, 'localVar')).toBe(false);
    });

    it('should handle empty source', () => {
      expect(provider.isExported('', 'anything')).toBe(false);
    });
  });

  describe('edge cases', () => {
    it('should handle script blocks with additional attributes', () => {
      const code = `<script lang="ts" context="module">
  export const version = '1.0';
</script>`;
      expect(provider.isExported(code, 'version')).toBe(true);
    });

    it('should handle reactive statement with function call', () => {
      const code = `<script>
  let count = 0;
  $: if (count > 10) {
    alert('High!');
  }
</script>`;
      const captures = provider.parse(code, 'test.svelte');
      expect(Array.isArray(captures)).toBe(true);
    });

    it('should handle reactive block statement', () => {
      const code = `<script>
  $: {
    console.log('Reactive block');
  }
</script>`;
      const captures = provider.parse(code, 'test.svelte');
      expect(Array.isArray(captures)).toBe(true);
    });

    it('should handle export let with type annotation', () => {
      const code = `<script lang="ts">
  export let items: Item[] = [];
  export let name: string;
</script>`;
      const captures = provider.parse(code, 'test.svelte');
      const props = captures.filter((c) => c.tag === CAPTURE_TAGS.COMPONENT_PROPS);
      expect(props.length).toBeGreaterThanOrEqual(2);
    });

    it('should handle kebab-case component tags', () => {
      const code = `<nav-bar />
<side-panel>
  <content>
    <slot />
  </content>
</side-panel>`;
      const captures = provider.parse(code, 'test.svelte');
      const components = captures.filter(
        (c) => c.tag === CAPTURE_TAGS.FUNCTION_CALL && c.properties?.component === 'true',
      );
      expect(components.some((c) => c.name === 'nav-bar')).toBe(true);
      expect(components.some((c) => c.name === 'side-panel')).toBe(true);
    });

    it('should handle self-closing custom components', () => {
      const code = `<UserAvatar />
<UserProfile name="Alice" />`;
      const captures = provider.parse(code, 'test.svelte');
      const components = captures.filter(
        (c) => c.tag === CAPTURE_TAGS.FUNCTION_CALL && c.properties?.component === 'true',
      );
      expect(components.length).toBeGreaterThanOrEqual(2);
    });

    it('should detect exported default function', () => {
      const code = `<script>
  export default function Gallery() {}
</script>`;
      expect(provider.isExported(code, 'Gallery')).toBe(true);
    });

    it('should detect exported class', () => {
      const code = `<script>
  export class MyStore {
    constructor() {}
  }
</script>`;
      expect(provider.isExported(code, 'MyStore')).toBe(true);
    });
  });
});
