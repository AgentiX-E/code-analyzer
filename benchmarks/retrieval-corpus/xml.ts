// @code-analyzer/analyzer — XML Provider

import { HtmlProvider } from './html.js';

/**
 * XML, which **extends `HtmlProvider` because the HTML grammar reads XML** - **both are markup, both are a tree of
 * elements with attributes, and `tree-sitter-html` accepts the well-formed subset that XML is.**
 *
 * **And the difference that matters is what the two languages are FOR**, which is **why the taint vocabulary is inherited
 * rather than invented**: **an HTML element can carry an XSS sink, and an XML element can carry an XXE one** - **both are
 * a tag whose content comes from somewhere else**, and **the walker that finds them is the same walker.**
 *
 * **The extensions are the ones a repository of a JVM or Android project actually contains**: `.xml` for `pom.xml`,
 * `AndroidManifest.xml`, `logback.xml` and the Spring bean files - **and those are the files an impact analysis needs,
 * because a class named in a `<bean>` or an `<activity>` is a class the build depends on.**
 *
 * **`web.xml`, `strings.xml` and `AndroidManifest.xml` are all `.xml`**, so **one extension covers the three ecosystems
 * where this repository's users meet XML**: **Maven, Android and the servlet container.**
 */
export class XmlProvider extends HtmlProvider {
  override readonly language = 'xml';
  override readonly displayName = 'XML';
  override readonly extensions = ['.xml', '.xsd', '.xsl', '.xslt', '.plist', '.pom'];
  override readonly globs = [
    '**/*.xml',
    '**/*.xsd',
    '**/*.xsl',
    '**/*.xslt',
    '**/*.plist',
    '**/pom.xml',
  ];
}
