import { describe, expect, it } from 'vitest';

import { XmlProvider } from '../xml.js';

/**
 * XML, which should read the files an impact analysis actually needs.
 *
 * **`pom.xml` and `AndroidManifest.xml` are the reason this provider exists**: **a `<bean>`, a `<dependency>` and an
 * `<activity>` all name a class or a package that the build depends on**, and **a file the indexer cannot open is a
 * dependency it cannot see.**
 */
describe('XML Provider', () => {
  const provider = new XmlProvider();

  it('names the language and the markup extensions', () => {
    expect(provider.language).toBe('xml');
    expect(provider.displayName).toBe('XML');
    expect(provider.extensions).toContain('.xml');
    expect(provider.extensions).toContain('.xsd');
  });

  it('claims `pom.xml` even though the glob is broader', () => {
    expect(provider.globs).toContain('**/*.xml');
    expect(provider.globs).toContain('**/pom.xml');
  });

  it('parses a Maven POM and reports its elements', () => {
    const pom = [
      '<project>',
      '  <groupId>com.example</groupId>',
      '  <artifactId>demo</artifactId>',
      '  <dependencies>',
      '    <dependency>',
      '      <groupId>junit</groupId>',
      '    </dependency>',
      '  </dependencies>',
      '</project>',
    ].join('\n');
    const captures = provider.parse(pom, 'pom.xml');
    expect(captures.length).toBeGreaterThan(0);
  });

  it('parses an Android manifest and reports its elements', () => {
    const manifest = [
      '<manifest xmlns:android="http://schemas.android.com/apk/res/android">',
      '  <application android:name=".App">',
      '    <activity android:name=".MainActivity" />',
      '  </application>',
      '</manifest>',
    ].join('\n');
    const captures = provider.parse(manifest, 'AndroidManifest.xml');
    expect(captures.length).toBeGreaterThan(0);
  });

  it('reports a self-closing element, which XML uses more than HTML does', () => {
    const captures = provider.parse('<bean id="a" class="com.example.A"/>\n', 'beans.xml');
    expect(captures.length).toBeGreaterThan(0);
  });
});
