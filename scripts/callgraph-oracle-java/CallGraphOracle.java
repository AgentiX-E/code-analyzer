// The Java oracle: what javac says a call site calls.
//
// **The call graph is measured in Python by `ast` and in TypeScript by the checker, and in Java by nothing.** That is
// the gap this program closes, and it is the same gap iteration 44 found for TypeScript: a resolver can be right on
// one corpus and wrong on another, and no count can tell which. The measurement has to come from an implementation
// that reads nothing the product writes.
//
// **The reader is javac's own attribution, not a parser written to agree with the product.** Python's oracle parses
// with `ast` and resolves calls by Python's scoping rules; TypeScript's asks `tsc`. Java's asks the compiler to
// *attribute* the trees - which is strictly more than parsing: `trees.getElement(path)` on a `MethodInvocationTree`
// answers with the symbol javac resolved the call to, including the inheritance and interface dispatch that a lexical
// reader would have to reimplement. So this oracle cannot be biased towards the product's rules; it does not have
// any.
//
// **What it reads from the product is only the edges**, as a tab-separated list the driver writes: the caller's file
// and name, the callee's file and name, and the arm that claimed it. Everything on the *expected* side is produced
// here, from source alone.
//
// **Three verdicts, and the difference matters to the score.** A site whose target is a declaration in this corpus is
// `internal` and becomes an expected pair. A site javac attributes to the JDK or a library is `external` - the graph
// cannot have an edge for it and is neither rewarded nor punished. A site javac cannot attribute, because a
// dependency is missing from the classpath, is `unknown` and is excluded: an oracle that guessed there would be
// scoring its own guess.
//
// Usage:
//   java CallGraphOracle.java --root <dir> --edges <edges.tsv> --name <corpus> [--out <report.json>]

import com.sun.source.tree.ClassTree;
import com.sun.source.tree.CompilationUnitTree;
import com.sun.source.tree.IdentifierTree;
import com.sun.source.tree.MemberReferenceTree;
import com.sun.source.tree.MemberSelectTree;
import com.sun.source.tree.MethodInvocationTree;
import com.sun.source.tree.MethodTree;
import com.sun.source.tree.NewClassTree;
import com.sun.source.tree.Tree;
import com.sun.source.util.JavacTask;
import com.sun.source.util.TreePath;
import com.sun.source.util.TreePathScanner;
import com.sun.source.util.Trees;

import javax.lang.model.element.Element;
import javax.lang.model.element.ElementKind;
import javax.lang.model.element.TypeElement;
import javax.tools.Diagnostic;
import javax.tools.DiagnosticCollector;
import javax.tools.JavaCompiler;
import javax.tools.JavaFileObject;
import javax.tools.StandardJavaFileManager;
import javax.tools.ToolProvider;
import java.io.IOException;
import java.io.PrintStream;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.stream.Collectors;
import java.util.stream.Stream;

public final class CallGraphOracle {
  /** One call site, as javac's attribution sees it. */
  static final class Site {
    final String file;
    final String owner;
    final String callee;
    final String verdict;
    final String targetFile;
    /** Whether the call goes back to the very declaration it is written in, by element identity. */
    final boolean recursive;

    Site(String file, String owner, String callee, String verdict, String targetFile) {
      this(file, owner, callee, verdict, targetFile, false);
    }

    Site(String file, String owner, String callee, String verdict, String targetFile, boolean recursive) {
      this.file = file;
      this.owner = owner;
      this.callee = callee;
      this.verdict = verdict;
      this.targetFile = targetFile;
      this.recursive = recursive;
    }

    /** The pair the graph would have to contain, in the graph's own coordinates. */
    String pair() {
      return file + "|" + owner + "|" + targetFile + "|" + callee;
    }
  }

  /** A claimed edge, read out of the product's dump. */
  static final class Claim {
    final String sourceFile;
    final String owner;
    final String targetFile;
    final String callee;
    final String arm;

    Claim(String sourceFile, String owner, String targetFile, String callee, String arm) {
      this.sourceFile = sourceFile;
      this.owner = owner;
      this.targetFile = targetFile;
      this.callee = callee;
      this.arm = arm;
    }

    String pair() {
      return sourceFile + "|" + owner + "|" + targetFile + "|" + callee;
    }
  }

  private static final Set<String> SKIP_DIRECTORIES = Set.of("target", "build", "out", ".git", "generated");

  public static void main(String[] args) throws IOException {
    Map<String, String> options = parseArguments(args);
    Path root = Paths.get(required(options, "root")).toAbsolutePath().normalize();
    Path edges = Paths.get(required(options, "edges"));
    String corpusName = options.getOrDefault("name", root.getFileName().toString());
    Path out = options.containsKey("out") ? Paths.get(options.get("out")) : null;

    List<Path> sources = javaFilesUnder(root);
    Attribution attribution = attribute(root, sources);

    Map<String, Integer> declarationsPerName = attribution.declarationsPerName;
    List<Site> sites = attribution.sites;
    List<Claim> claims = readClaims(edges, root);

    Set<String> expected = new LinkedHashSet<>();
    Map<String, Integer> verdicts = new TreeMap<>();
    for (Site site : sites) {
      verdicts.merge(site.verdict, 1, Integer::sum);
      if (!site.verdict.equals("internal")) {
        continue;
      }
      // **A call a function makes to itself is not an edge**, deliberately: both resolving passes refuse a self-edge
      // because recursion is a fact the graph records elsewhere, and scoring it as a miss would penalise a decision
      // already taken. **The test is the declaration and not the name**, which is the correction an overload forced:
      // `isSorted(a)` calling `isSorted(a, c)` is two declarations with one name, and every such call the product
      // resolved was being scored as a wrong self-edge.
      if (site.recursive) {
        verdicts.merge("internalRecursion", 1, Integer::sum);
        continue;
      }
      expected.add(site.pair());
    }

    Set<String> claimed = new LinkedHashSet<>();
    Map<String, int[]> perArm = new TreeMap<>();
    Map<String, String> armOf = new LinkedHashMap<>();
    for (Claim claim : claims) {
      claimed.add(claim.pair());
      armOf.putIfAbsent(claim.pair(), claim.arm);
      int[] bucket = perArm.computeIfAbsent(claim.arm, (key) -> new int[2]);
      if (expected.contains(claim.pair())) {
        bucket[0]++;
      } else {
        bucket[1]++;
      }
    }

    Set<String> truePositives = new LinkedHashSet<>(claimed);
    truePositives.retainAll(expected);
    Set<String> wrong = new LinkedHashSet<>(claimed);
    wrong.removeAll(expected);
    Set<String> missed = new LinkedHashSet<>(expected);
    missed.removeAll(claimed);

    // **The stored report samples; the diagnosis needs all of them.** Fifteen samples say what a wrong edge looks
    // like and nothing about how many share a cause, so the full list is opt-in and stays out of the artifact.
    if (System.getenv("ORACLE_WRONG") != null) {
      for (String pair : wrong) {
        System.err.println("WRONG [" + armOf.getOrDefault(pair, "unlabelled") + "] " + pair);
      }
      for (String pair : missed) {
        System.err.println("MISSED " + pair);
      }
    }

    Map<String, Integer> collisions = new TreeMap<>();
    for (Map.Entry<String, Integer> entry : declarationsPerName.entrySet()) {
      if (entry.getValue() > 1) {
        collisions.merge(entry.getKey().split("\u0000")[0], 1, Integer::sum);
      }
    }

    Set<String> oracleCallers = new LinkedHashSet<>();
    Set<String> graphCallers = new LinkedHashSet<>();
    Set<String> ownersWithAnyCall = new LinkedHashSet<>();
    for (Site site : sites) {
      if (site.verdict.equals("internal") || site.verdict.equals("external")) {
        ownersWithAnyCall.add(site.file + "\u0000" + site.owner);
      }
      if (site.verdict.equals("internal")) {
        oracleCallers.add(site.file + "\u0000" + site.owner);
      }
    }
    Set<String> graphCallerKeys = new LinkedHashSet<>();
    for (Claim claim : claims) {
      graphCallers.add(claim.sourceFile + "\u0000" + claim.owner);
      graphCallerKeys.add(claim.sourceFile + "\u0000" + claim.owner);
    }

    StringBuilder report = new StringBuilder();
    report.append("{\n");
    appendField(report, "generatedBy", "scripts/callgraph-oracle-java/CallGraphOracle.java", 1, true);
    appendField(report, "oracle", "javac attribution (com.sun.source.util.Trees)", 1, true);
    appendField(report, "corpus", corpusName, 1, true);
    appendNumber(report, "files", sources.size(), 1, true);
    report.append("  \"definitions\": {");
    report.append("\"moduleLevel\": ").append(attribution.declarationCount).append(", ");
    report.append("\"simpleNameCollisionsPerFile\": ").append(collisions.values().stream().mapToInt(Integer::intValue).sum());
    report.append("},\n");
    report.append("  \"sites\": {");
    report.append("\"total\": ").append(sites.size());
    for (String verdict : List.of("internal", "internalRecursion", "external", "unknown", "silent", "outsideMethod", "methodReference")) {
      report.append(", ");
      appendRaw(report, verdict, verdicts.getOrDefault(verdict, 0));
    }
    report.append(", \"excludedForDuplicateName\": 0");
    report.append("},\n");
    appendNumber(report, "expectedPairs", expected.size(), 1, true);
    appendNumber(report, "claimedPairs", claimed.size(), 1, true);
    report.append("  \"precision\": {");
    report.append("\"correct\": ").append(truePositives.size()).append(", ");
    report.append("\"wrong\": ").append(wrong.size()).append(", ");
    report.append("\"value\": ").append(ratio(truePositives.size(), claimed.size()));
    report.append("},\n");
    report.append("  \"recall\": {");
    report.append("\"found\": ").append(truePositives.size()).append(", ");
    report.append("\"missed\": ").append(missed.size()).append(", ");
    report.append("\"value\": ").append(ratio(truePositives.size(), expected.size()));
    report.append("},\n");
    report.append("  \"byArm\": {");
    boolean firstArm = true;
    for (Map.Entry<String, int[]> entry : perArm.entrySet()) {
      if (!firstArm) {
        report.append(", ");
      }
      firstArm = false;
      int correct = entry.getValue()[0];
      int incorrect = entry.getValue()[1];
      report.append(quote(entry.getKey())).append(": {");
      report.append("\"claimed\": ").append(correct + incorrect).append(", ");
      report.append("\"correct\": ").append(correct).append(", ");
      report.append("\"precision\": ").append(ratio(correct, correct + incorrect));
      report.append("}");
    }
    report.append("},\n");
    report.append("  \"callers\": {");
    report.append("\"oracle\": ").append(oracleCallers.size()).append(", ");
    report.append("\"graph\": ").append(intersectSize(graphCallerKeys, oracleCallers)).append(", ");
    report.append("\"graphOnly\": ").append(differenceSize(graphCallerKeys, oracleCallers)).append(", ");
    report.append("\"ownersWithAnyCall\": ").append(ownersWithAnyCall.size()).append(", ");
    report.append("\"graphCallers\": ").append(graphCallers.size());
    report.append("},\n");
    appendSamples(report, "wrongSamples", wrong.stream().map(pair -> "[" + armOf.getOrDefault(pair, "unlabelled") + "] " + pair).collect(Collectors.toList()));
    appendSamples(report, "missedSamples", new ArrayList<>(missed));
    // **The cause bucket is coarse here on purpose.** A Java reader that attributed a call to a symbol knows *what*
    // it resolved to; it does not know which of the product's rules produced a different answer. The sample list is
    // where a reader goes for that, and this key exists so the shape matches the other two oracles.
    report.append("  \"wrongCauses\": {}\n");
    report.append("}\n");

    String text = report.toString();
    if (out != null) {
      if (out.getParent() != null) {
        Files.createDirectories(out.getParent());
      }
      Files.writeString(out, text + "\n", StandardCharsets.UTF_8);
    }
    PrintStream stdout = new PrintStream(System.out, true, StandardCharsets.UTF_8);
    stdout.println(text);
  }

  /** Everything javac's attribution says about one checkout. */
  private static final class Attribution {
    final List<Site> sites = new ArrayList<>();
    final Map<String, Integer> declarationsPerName = new TreeMap<>();
    int declarationCount;
  }

  private static Attribution attribute(Path root, List<Path> sources) throws IOException {
    Attribution attribution = new Attribution();
    JavaCompiler compiler = ToolProvider.getSystemJavaCompiler();
    if (compiler == null) {
      throw new IOException("no system Java compiler: run this with a JDK, not a JRE");
    }
    DiagnosticCollector<JavaFileObject> diagnostics = new DiagnosticCollector<>();
    Path scratch = Files.createTempDirectory("callgraph-oracle-java");
    try (StandardJavaFileManager files = compiler.getStandardFileManager(diagnostics, null, StandardCharsets.UTF_8)) {
      Iterable<? extends JavaFileObject> units = files.getJavaFileObjectsFromPaths(sources);
      List<String> options = List.of(
          "-proc:none",
          "-nowarn",
          "-Xlint:none",
          "-d",
          scratch.toString());
      JavacTask task = (JavacTask) compiler.getTask(new Writer() {
        @Override
        public void write(char[] buffer, int offset, int length) {
          // Compiler chatter is not a measurement. Diagnostics are collected separately and are not printed either:
          // a missing dependency is an expected state of a checkout read without its dependencies.
        }

        @Override
        public void flush() {}

        @Override
        public void close() {}
      }, files, diagnostics, options, null, units);

      Iterable<? extends CompilationUnitTree> parsed;
      try {
        parsed = task.parse();
      } catch (RuntimeException error) {
        throw new IOException("javac refused to parse the checkout: " + error.getMessage(), error);
      }
      List<CompilationUnitTree> trees = new ArrayList<>();
      for (CompilationUnitTree unit : parsed) {
        trees.add(unit);
      }
      // **Attribution, because a parse alone cannot say what a call calls.** `analyze()` resolves symbols, and it is
      // allowed to report errors: a corpus checked out without its dependencies still attributes every call whose
      // receiver's type is in the corpus or in the JDK, which is exactly the set this measurement is about.
      try {
        task.analyze();
      } catch (RuntimeException error) {
        // A compilation unit javac cannot finish does not invalidate the units it did finish; the sites it did not
        // attribute are `unknown` below and are excluded from the score rather than guessed at.
      }
      Trees treesApi = Trees.instance(task);
      for (CompilationUnitTree unit : trees) {
        new SiteScanner(treesApi, root, attribution).scan(unit, null);
      }
    } finally {
      deleteTree(scratch);
    }
    return attribution;
  }

  /** Walks one compilation unit and records every call site inside a method body. */
  private static final class SiteScanner extends TreePathScanner<Void, Void> {
    private final Trees trees;
    private final Path root;
    private final Attribution attribution;
    /** The declarations the walk is inside, innermost last - **identity, not name**, so an overload is not recursion. */
    private final java.util.Deque<Element> enclosing = new java.util.ArrayDeque<>();

    SiteScanner(Trees trees, Path root, Attribution attribution) {
      this.trees = trees;
      this.root = root;
      this.attribution = attribution;
    }

    @Override
    public Void visitMethod(MethodTree node, Void unused) {
      String file = fileOf(getCurrentPath());
      if (file != null && node.getName() != null && !node.getName().contentEquals("<init>")) {
        attribution.declarationCount++;
        attribution.declarationsPerName.merge(file + "\u0000" + node.getName(), 1, Integer::sum);
      }
      Element declared = trees.getElement(getCurrentPath());
      enclosing.addLast(declared);
      try {
        return super.visitMethod(node, unused);
      } finally {
        enclosing.removeLast();
      }
    }

    /**
     * Whether a call goes back to the declaration it is written in.
     *
     * **A name is not a declaration, and an overload is the case that says so.** `ArrayUtils.isSorted(Comparable[])`
     * calls `isSorted(Comparable[], Comparator)` - two declarations, one name - and a rule that compared names called
     * that recursion and dropped the edge, after which every overload call the product resolved looked wrong: on
     * `apache/commons-lang` that was **240 of the 287** edges the score called false, and the product was right about
     * all of them.
     */
    private boolean callsItself(Element target) {
      return !enclosing.isEmpty() && target.equals(enclosing.peekLast());
    }

    @Override
    public Void visitNewClass(NewClassTree node, Void unused) {
      // **A constructor is a call, and the first version of this oracle refused to score it - which made 200 correct
      // edges look wrong.** The graph files the target of `new ToStringBuilder(…)` as a `Constructor` node named after
      // the class, and a site this reader declined to judge became a false positive on the product's side: on
      // `apache/commons-lang` the `import` arm read **0 of 33**, and every one of the 33 was a construction. An
      // instrument that refuses a question does not abstain from the answer; it votes against.
      TreePath path = getCurrentPath();
      String file = fileOf(path);
      String owner = enclosingMethodName(path);
      Element target = trees.getElement(path);
      String callee = constructedName(target);
      if (file == null || owner == null || callee == null) {
        merge("outsideMethod");
        return super.visitNewClass(node, unused);
      }
      attribution.sites.add(judgeConstruction(path, file, owner, callee));
      return super.visitNewClass(node, unused);
    }

    /** A construction, resolved to the file its class is declared in - the same verdicts a call gets. */
    private Site judgeConstruction(TreePath path, String file, String owner, String callee) {
      Element target = trees.getElement(path);
      if (target == null) {
        return new Site(file, owner, callee, "unknown", null);
      }
      Element declaringType = target.getKind() == ElementKind.CONSTRUCTOR ? target.getEnclosingElement() : target;
      String declaredIn = declaringType instanceof TypeElement ? sourceOf(trees, declaringType, root) : null;
      return declaredIn == null
          ? new Site(file, owner, callee, "external", null)
          : new Site(file, owner, callee, "internal", declaredIn, callsItself(target));
    }

    /** The simple name of the class a construction builds, which is the name the graph files its node under. */
    private static String constructedName(Element target) {
      if (target == null) {
        return null;
      }
      Element type = target.getKind() == ElementKind.CONSTRUCTOR ? target.getEnclosingElement() : target;
      if (!(type instanceof TypeElement element)) {
        return null;
      }
      String simple = element.getSimpleName().toString();
      return simple.isEmpty() ? null : simple;
    }

    @Override
    public Void visitMemberReference(MemberReferenceTree node, Void unused) {
      // `Foo::bar` is a call site the product does not resolve yet. Counted, not scored - the same honesty the
      // `constructor` count applies.
      merge("methodReference");
      return super.visitMemberReference(node, unused);
    }

    @Override
    public Void visitMethodInvocation(MethodInvocationTree node, Void unused) {
      TreePath path = getCurrentPath();
      String file = fileOf(path);
      String owner = enclosingMethodName(path);
      String callee = invokedName(node, trees.getElement(path));
      if (file == null || owner == null || callee == null) {
        merge("outsideMethod");
        return super.visitMethodInvocation(node, unused);
      }
      attribution.sites.add(judge(path, file, owner, callee));
      return super.visitMethodInvocation(node, unused);
    }

    private Site judge(TreePath path, String file, String owner, String callee) {
      Element target = trees.getElement(path);
      if (target == null) {
        // **Not attributed.** A receiver whose type lives in a dependency the classpath does not hold; the honest
        // answer is that this oracle does not know, not that the call goes nowhere.
        return new Site(file, owner, callee, "unknown", null);
      }
      ElementKind kind = target.getKind();
      if (kind != ElementKind.METHOD && kind != ElementKind.CONSTRUCTOR) {
        return new Site(file, owner, callee, "silent", null);
      }
      Element declaringType = target.getEnclosingElement();
      if (!(declaringType instanceof TypeElement) || !(declaringType.asType().getKind() == javax.lang.model.type.TypeKind.DECLARED)) {
        return new Site(file, owner, callee, "unknown", null);
      }
      String declaredIn = sourceOf(trees, declaringType, root);
      if (declaredIn == null) {
        // A method of the JDK or of a library: the graph has no node for it, and an edge to nothing is not a claim
        // this measurement can score.
        return new Site(file, owner, callee, "external", null);
      }
      return new Site(file, owner, callee, "internal", declaredIn, callsItself(target));
    }

    private void merge(String verdict) {
      attribution.sites.add(new Site("", "", "", verdict, null));
    }

    private String fileOf(TreePath path) {
      if (path == null || path.getCompilationUnit() == null) {
        return null;
      }
      JavaFileObject source = path.getCompilationUnit().getSourceFile();
      if (source == null) {
        return null;
      }
      Path absolute = Paths.get(source.toUri()).toAbsolutePath().normalize();
      if (!absolute.startsWith(root)) {
        return null;
      }
      return root.relativize(absolute).toString().replace(java.io.File.separatorChar, '/');
    }
  }

  /**
   * The nearest enclosing method's name, or `null` outside one.
   *
   * **A constructor is named after its class, because that is the name the graph files it under.** Java's `<init>` is
   * not a name any call writes, and the product's `Constructor` node carries the class's - so a call written inside
   * `ReflectionToStringBuilder(...) { setAppendStatics(...) }` was a site this reader declined and therefore a wrong
   * edge on the product's side. On `apache/commons-lang` that was **eight of the twenty-eight** `sameFile` claims the
   * score called false, all of them right.
   */
  private static String enclosingMethodName(TreePath path) {
    for (TreePath current = path; current != null; current = current.getParentPath()) {
      Tree leaf = current.getLeaf();
      if (leaf instanceof MethodTree method) {
        if (!method.getName().contentEquals("<init>")) return method.getName().toString();
        for (TreePath above = current.getParentPath(); above != null; above = above.getParentPath()) {
          if (above.getLeaf() instanceof ClassTree type) {
            // **An anonymous class has no simple name**, and the graph files no constructor under an empty one - so a
            // call written inside it belongs to no caller either side can name.
            String simple = type.getSimpleName().toString();
            return simple.isEmpty() ? null : simple;
          }
        }
        return null;
      }
      if (leaf instanceof ClassTree) {
        // A call in a field initialiser or an initialiser block belongs to no method, and the graph has no caller node
        // for it either. Counted as `outsideMethod` rather than attributed to the class, which would invent a caller.
        return null;
      }
    }
    return null;
  }

  /**
   * The name the call writes: `m(…)`, `x.m(…)` and `x().m(…)` all write `m`.
   *
   * **Except the two keywords, which write no name at all and still call a constructor.** `super(args)` runs the base
   * class's constructor and `this(args)` another of its own; the graph files a constructor under its class's name, so
   * that is the name the pair carries. Reading the keyword instead produced `NumberRange|super`, a pair no graph can
   * contain, and **five constructor chains** were scored as missed for it.
   */
  private static String invokedName(MethodInvocationTree node, Element target) {
    Tree select = node.getMethodSelect();
    if (select instanceof IdentifierTree identifier) {
      String written = identifier.getName().toString();
      boolean keyword = written.equals("super") || written.equals("this");
      if (keyword && target != null) {
        Element type = target.getKind() == ElementKind.CONSTRUCTOR ? target.getEnclosingElement() : target;
        if (type instanceof TypeElement element && !element.getSimpleName().isEmpty()) {
          return element.getSimpleName().toString();
        }
      }
      return keyword ? null : written;
    }
    if (select instanceof MemberSelectTree member) {
      return member.getIdentifier().toString();
    }
    return null;
  }

  /** The file a declaration is written in, relative to the corpus root, or `null` when it is not in this checkout. */
  private static String sourceOf(Trees trees, Element element, Path root) {
    TreePath path;
    try {
      path = trees.getPath(element);
    } catch (RuntimeException error) {
      // An element from a class file has no tree; `getPath` says so by throwing for some kinds.
      return null;
    }
    if (path == null || path.getCompilationUnit() == null) {
      return null;
    }
    JavaFileObject source = path.getCompilationUnit().getSourceFile();
    if (source == null) {
      return null;
    }
    Path absolute = Paths.get(source.toUri()).toAbsolutePath().normalize();
    if (!absolute.startsWith(root)) {
      return null;
    }
    return root.relativize(absolute).toString().replace(java.io.File.separatorChar, '/');
  }

  private static List<Path> javaFilesUnder(Path root) throws IOException {
    try (Stream<Path> walk = Files.walk(root)) {
      return walk
          .filter(Files::isRegularFile)
          .filter(path -> path.getFileName().toString().endsWith(".java"))
          .filter(CallGraphOracle::notGenerated)
          .sorted()
          .collect(Collectors.toList());
    }
  }

  private static boolean notGenerated(Path path) {
    for (Path part : path) {
      if (SKIP_DIRECTORIES.contains(part.toString())) {
        return false;
      }
    }
    return true;
  }

  /** The product's claimed edges, one per line: caller file, caller name, target file, target name, arm. */
  private static List<Claim> readClaims(Path edges, Path root) throws IOException {
    List<Claim> claims = new ArrayList<>();
    if (!Files.exists(edges)) {
      return claims;
    }
    for (String line : Files.readAllLines(edges, StandardCharsets.UTF_8)) {
      if (line.isEmpty()) {
        continue;
      }
      String[] parts = line.split("\t", -1);
      if (parts.length < 4) {
        continue;
      }
      claims.add(new Claim(parts[0], parts[1], parts[2], parts[3], parts.length > 4 ? parts[4] : "unlabelled"));
    }
    claims.sort(Comparator.comparing(Claim::pair));
    return claims;
  }

  private static Map<String, String> parseArguments(String[] args) {
    Map<String, String> options = new TreeMap<>();
    for (int index = 0; index < args.length - 1; index++) {
      if (args[index].startsWith("--")) {
        options.put(args[index].substring(2), args[index + 1]);
      }
    }
    return options;
  }

  private static String required(Map<String, String> options, String name) {
    String value = options.get(name);
    if (value == null) {
      throw new IllegalArgumentException("missing --" + name);
    }
    return value;
  }

  private static int intersectSize(Set<String> left, Set<String> right) {
    int count = 0;
    for (String value : left) {
      if (right.contains(value)) {
        count++;
      }
    }
    return count;
  }

  private static int differenceSize(Set<String> left, Set<String> right) {
    int count = 0;
    for (String value : left) {
      if (!right.contains(value)) {
        count++;
      }
    }
    return count;
  }

  private static String ratio(int part, int whole) {
    return whole == 0 ? "null" : String.valueOf(Math.round((double) part / whole * 10000.0) / 10000.0);
  }

  private static String quote(String value) {
    StringBuilder out = new StringBuilder("\"");
    for (char character : value.toCharArray()) {
      switch (character) {
        case '"' -> out.append("\\\"");
        case '\\' -> out.append("\\\\");
        case '\n' -> out.append("\\n");
        case '\r' -> out.append("\\r");
        case '\t' -> out.append("\\t");
        default -> {
          if (character < 0x20) {
            out.append(String.format("\\u%04x", (int) character));
          } else {
            out.append(character);
          }
        }
      }
    }
    return out.append('"').toString();
  }

  private static void appendField(StringBuilder report, String key, String value, int indent, boolean comma) {
    report.append("  ".repeat(indent)).append(quote(key)).append(": ").append(quote(value)).append(comma ? ",\n" : "\n");
  }

  private static void appendNumber(StringBuilder report, String key, int value, int indent, boolean comma) {
    report.append("  ".repeat(indent)).append(quote(key)).append(": ").append(value).append(comma ? ",\n" : "\n");
  }

  private static void appendRaw(StringBuilder report, String key, int value) {
    report.append(quote(key)).append(": ").append(value);
  }

  private static void appendSamples(StringBuilder report, String key, List<String> samples) {
    List<String> sorted = new ArrayList<>(samples);
    sorted.sort(Comparator.naturalOrder());
    int limit = Math.min(sorted.size(), 20);
    report.append("  ").append(quote(key)).append(": [");
    for (int index = 0; index < limit; index++) {
      if (index > 0) {
        report.append(", ");
      }
      report.append(quote(sorted.get(index)));
    }
    report.append("],\n");
  }

  private static void deleteTree(Path root) {
    try (Stream<Path> walk = Files.walk(root)) {
      walk.sorted(Comparator.reverseOrder()).forEach(path -> {
        try {
          Files.deleteIfExists(path);
        } catch (IOException ignored) {
          // A scratch directory that outlives the run is the operating system's problem, not the measurement's.
        }
      });
    } catch (IOException ignored) {
      // Same.
    }
  }
}
