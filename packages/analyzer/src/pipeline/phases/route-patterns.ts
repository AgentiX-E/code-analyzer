// @code-analyzer/analyzer — Pipeline Phase: Route Patterns
//
// **A route is a triple — a verb, a path, and the syntax that declared it — and the phase used to lose two of the
// three.** The old table was seventeen `RegExp`s applied to every file of every language, with a heuristic in place of
// the verb: whichever capture looked like `get` was read as the method and the rest were read as the path. Three things
// followed from that, and all three are fixed here rather than documented:
//
// 1. **One endpoint was counted four times.** `app.get('/x')` matches the Express pattern, the Express-router pattern,
//    the Koa pattern and the Hono pattern — all four are the same syntax, and they disagreed only in the label. The
//    graph deduplicated the nodes by qualified name, so the *inventory* looked right while `routesFound` reported four,
//    and every consumer that counted routes counted the framework table rather than the endpoints.
// 2. **Every Spring endpoint was `ALL`.** `@GetMapping("/owners")` captures the path in group 1, so `isHttpMethod` was
//    false, so the verb fell back to the pattern's literal — which the table had written as `ALL` for the whole
//    annotation family. `spring-petclinic` has 17 endpoints across `GET` and `POST`; the inventory said 17 × `ALL`.
// 3. **The framework label was a guess from syntax that libraries share.** Gin, Echo, Chi and Fiber spell a route
//    `r.GET("/x", h)`; Rails, Sinatra and Phoenix all spell it `get "/x"`. There is no evidence in the shape, so the
//    label is now the *family* the shape belongs to and the language the file is written in narrows it.
//
// The fix is a table of patterns that each say where the path is and where the verb is, gated by the language of the
// file, and a deduplication pass keyed on `(verb, path)` — because **the endpoint is the unit a reader asks about**, not
// the pattern that happened to match it.

/** The verb a route answers, or `ALL` for a declaration that does not name one. */
export type RouteVerb = string;

/** One endpoint declaration found in one file. */
export interface DetectedRoute {
  /** The path as written, without the framework's prefix resolution. */
  readonly path: string;
  /** Upper-case HTTP verb, or `ALL` when the syntax names none. */
  readonly method: RouteVerb;
  /** The family the declaring syntax belongs to, not a guess at the package. */
  readonly framework: string;
  /** 1-based line the declaration starts on. */
  readonly line: number;
  /** The file the declaration was read from, as the scanner spells it. */
  readonly filePath: string;
}

/**
 * **A pattern that knows which capture is the path and which is the verb.**
 *
 * `path` and `verb` are capture indices; `verb` may instead be a literal when the syntax fixes it (`@GetMapping` can
 * only be `GET`). `adjust` exists for the two syntaxes whose verb is not a single token — `@RequestMapping(method =
 * RequestMethod.POST)` writes it inside an argument list, and `path("/x")` writes it in a sibling argument — and it
 * returns `null` for a declaration that names no path at all, such as `[HttpGet]` without a template.
 */
interface RoutePattern {
  readonly framework: string;
  readonly regex: RegExp;
  readonly path: number;
  readonly verb: number | RouteVerb;
  /** Languages whose files this syntax can appear in, from `SUPPORTED_LANGUAGES`. */
  readonly languages?: readonly string[];
  readonly adjust?: (
    match: RegExpExecArray,
    content: string,
  ) => { path: string; verb: RouteVerb } | null;
}

/** The upper-case spelling of a verb capture, or `ALL` when the token is not one. */
function verbOf(token: string | undefined): RouteVerb {
  const upper = (token ?? '').toUpperCase();
  return /^(GET|POST|PUT|DELETE|PATCH|OPTIONS|HEAD|ALL|ANY)$/u.test(upper) ? upper : 'ALL';
}

/** The first quoted literal in a fragment of source, which is how every framework spells a path. */
function firstQuoted(text: string): string | null {
  const match = /["'`]([^"'`]*)["'`]/u.exec(text);
  return match === null ? null : group(match, 1);
}

/**
 * **The capture at `index`, or the empty string when the pattern made that group optional.**
 *
 * Reading captures through one function is what keeps the detector's branches about *syntax* — a mapping with no path, a
 * class-level prefix, a Flask route with a `methods` list — rather than about the type system. `[HttpGet]` is the case
 * that makes the empty string real: its template group does not participate, and the route it declares inherits its path
 * from `[Route("api")]`, which this detector does not resolve.
 */
function group(match: RegExpExecArray, index: number): string {
  return match[index] ?? '';
}

/**
 * **`@RequestMapping` names a path and, optionally, a verb.**
 *
 * The annotation is the only Spring form that can answer more than one verb: `@RequestMapping("/owners")` answers all
 * of them, and `@RequestMapping(value = "/owners", method = RequestMethod.POST)` answers one. Both are one declaration,
 * so both are one route, and reading the argument list is the only way to tell them apart.
 */
function springRequestMapping(
  match: RegExpExecArray,
  content: string,
): { path: string; verb: RouteVerb } | null {
  const args = group(match, 1);
  const path = firstQuoted(args);
  if (path === null || path.length === 0) return null;

  // **`@RequestMapping` on a class is a prefix, not an endpoint.** The annotation is legal on both, and the one on
  // `@RestController class OwnerController` states where its handlers live rather than adding a handler of its own — so
  // the declaration that follows it decides, and a `class` before the next method signature means the annotation is a
  // namespace.
  const after = content.slice(match.index + match[0].length);
  const head = after.slice(0, Math.max(0, after.search(/[({;]/u)));
  if (/\b(?:class|interface|enum|record)\b/u.test(head)) return null;

  const verb = /RequestMethod\.(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)/u.exec(args);
  return { path, verb: verb === null ? 'ALL' : verbOf(verb[1]) };
}

/** Flask's `@app.route("/x", methods=["POST", "PUT"])` names its verbs in a list, and defaults to `GET`. */
function flaskRoute(
  match: RegExpExecArray,
  content: string,
): { path: string; verb: RouteVerb } | null {
  // `[^"']+` in the pattern means a matched path is never empty, so there is no empty case to guard against here.
  const path = group(match, 1);
  // The `methods` list is in the same call but outside the match — the pattern stops at the closing quote of the path,
  // because a path is the only thing every one of these decorators has in common. Reading it needs the call's text.
  const from = match.index;
  const call = content.slice(
    from,
    content.indexOf('\n', from) === -1 ? content.length : content.indexOf('\n', from),
  );
  const methods = /methods\s*=\s*\[([^\]]*)\]/u.exec(call);
  const first = methods === null ? null : firstQuoted(group(methods, 1));
  return { path, verb: first === null ? 'GET' : verbOf(first) };
}

/**
 * **A route with no path is not a route.** `[HttpGet]` and `@Get()` inherit their path from `[Route("api")]` or
 * `@Controller("api")`, which this detector does not resolve into a prefix, so an empty path would be an endpoint at
 * the empty string — worse than no endpoint, because it is indistinguishable from a real one when counted.
 */
function withPathRequired(
  extract: (match: RegExpExecArray) => { path: string; verb: RouteVerb },
): (match: RegExpExecArray) => { path: string; verb: RouteVerb } | null {
  return (match) => {
    const value = extract(match);
    return value.path.length === 0 ? null : value;
  };
}

/**
 * **Every syntax this detector knows, most specific first.**
 *
 * The order decides the label a duplicated endpoint keeps — `@GetMapping` is claimed by `spring` before the generic
 * `@Request…` forms see it, and the Go routers never claim a verb the ASP.NET attribute already explained.
 */
const PATTERNS: readonly RoutePattern[] = [
  // Spring's verb-per-annotation forms. The verb is fixed by the annotation, so it is a literal rather than a capture.
  // The optional `{` is the array form — `@GetMapping({ "/vets" })` — which `spring-petclinic` writes for its vet list
  // and which a pattern that expected a quote straight after the parenthesis read as no endpoint at all.
  {
    framework: 'spring',
    regex:
      /@(Get|Post|Put|Delete|Patch)Mapping\s*\(\s*(?:value\s*=\s*|path\s*=\s*)?\{?\s*["']([^"']*)["']/gu,
    path: 2,
    verb: 1,
    languages: ['java', 'kotlin', 'groovy', 'scala'],
  },
  // Spring's one-annotation-many-verbs form, whose verb lives in the argument list.
  {
    framework: 'spring',
    regex: /@RequestMapping\s*\(([^)]*)\)/gu,
    path: 1,
    verb: 'ALL',
    adjust: springRequestMapping,
    languages: ['java', 'kotlin', 'groovy', 'scala'],
  },
  // ASP.NET Core attribute routing: `[HttpGet("/x")]`, `[HttpPost(Template = "/x")]`, and `[HttpDelete]` with no path.
  {
    framework: 'aspnet',
    regex:
      /\[Http(Get|Post|Put|Delete|Patch|Options|Head)(?:Attribute)?\s*(?:\(\s*(?:Template\s*=\s*)?["']([^"']*)["']\s*\))?\s*\]/gu,
    path: 2,
    verb: 1,
    adjust: withPathRequired((match) => ({ path: group(match, 2), verb: verbOf(group(match, 1)) })),
    languages: ['csharp'],
  },
  // NestJS decorators. `@Get()` with an empty path inherits `@Controller('prefix')` and is not a route on its own.
  {
    framework: 'nestjs',
    regex: /@(Get|Post|Put|Delete|Patch|Options|All|Head)\s*\(\s*["']([^"']*)["']\s*\)/gu,
    path: 2,
    verb: 1,
    adjust: withPathRequired((match) => ({ path: group(match, 2), verb: verbOf(group(match, 1)) })),
    languages: ['typescript', 'javascript'],
  },
  // Ktor: `get("/x") { … }` inside a `routing { }` block.
  {
    framework: 'ktor',
    regex: /\b(get|post|put|delete|patch|options|head)\s*\(\s*["']([^"'\n]+)["']\s*\)\s*\{/gu,
    path: 2,
    verb: 1,
    languages: ['kotlin'],
  },
  // Grails URL mappings: `"/books"(controller: "book", action: "index", method: "GET")`.
  {
    framework: 'grails',
    regex: /["']([^"']+)["']\s*\(\s*(?:controller|action)\s*:/gu,
    path: 1,
    verb: 'ALL',
    adjust: (match, content) => {
      const from = match.index;
      const line = content.slice(
        from,
        content.indexOf('\n', from) === -1 ? content.length : content.indexOf('\n', from),
      );
      const method = /method\s*:\s*["']?([A-Za-z]+)/u.exec(line);
      return { path: group(match, 1), verb: verbOf(method?.[1]) };
    },
    languages: ['groovy'],
  },
  // The Express family — Express, Koa, Hono, Restify, Vapor and Shelf all spell a route `app.get('/x', h)`.
  {
    framework: 'express',
    regex:
      /(?:app|router|server|api)\.(get|post|put|delete|patch|options|all|head)\s*\(\s*["'`]([^"'`]+)["'`]/gu,
    path: 2,
    verb: 1,
    languages: ['typescript', 'javascript', 'swift', 'dart', 'groovy'],
  },
  // FastAPI and Flask's verb decorators.
  {
    framework: 'fastapi',
    regex:
      /@(?:app|router|blueprint|api)\.(get|post|put|delete|patch|options|head)\s*\(\s*["']([^"']+)["']/gu,
    path: 2,
    verb: 1,
    languages: ['python'],
  },
  // Flask's path decorator, whose verbs live in a `methods=` list.
  {
    framework: 'flask',
    regex: /@\w+\.route\s*\(\s*["']([^"']+)["']/gu,
    path: 1,
    verb: 'GET',
    adjust: flaskRoute,
    languages: ['python'],
  },
  // Django's URL configuration.
  {
    framework: 'django',
    regex: /\b(?:path|re_path|url)\s*\(\s*r?["']([^"']+)["']/gu,
    path: 1,
    verb: 'ALL',
    languages: ['python'],
  },
  // The Go routers: Gin, Echo, Chi and Fiber write `r.GET("/x", h)` and differ only in the receiver's name.
  {
    framework: 'go-router',
    regex:
      /\.(GET|POST|PUT|DELETE|PATCH|OPTIONS|HEAD|Get|Post|Put|Delete|Patch|Options|Head)\s*\(\s*["']([^"']+)["']/gu,
    path: 2,
    verb: 1,
    languages: ['go'],
  },
  // Rails and Phoenix route files: `get "/owners"`, at the start of a line.
  {
    framework: 'rails',
    regex: /^[ \t]*(get|post|put|patch|delete|options|head)\s+["']([^"']+)["']/gmu,
    path: 2,
    verb: 1,
    languages: ['ruby', 'elixir'],
  },
  // Rails' collective forms, which name a resource rather than a path.
  {
    framework: 'rails',
    regex: /^[ \t]*resources?\s+:?(\w+)/gmu,
    path: 1,
    verb: 'ALL',
    adjust: (match) => ({ path: `/${group(match, 1)}`, verb: 'ALL' }),
    languages: ['ruby'],
  },
  // Laravel's facade.
  {
    framework: 'laravel',
    regex: /Route::(get|post|put|delete|patch|options|any|match)\s*\(\s*["']([^"']+)["']/gu,
    path: 2,
    verb: 1,
    languages: ['php'],
  },
  // Crow (C++): `CROW_ROUTE(app, "/x")` — a macro that fixes no verb, so the route answers all of them.
  {
    framework: 'crow',
    regex: /CROW_ROUTE\s*\(\s*\w+\s*,\s*["']([^"']+)["']\s*\)/gu,
    path: 1,
    verb: 'ALL',
    languages: ['cpp'],
  },
  // Lapis (Lua): `app:get("/x", handler)`.
  {
    framework: 'lapis',
    regex: /app:(get|post|put|delete|patch|options|head)\s*\(\s*["']([^"']+)["']/gu,
    path: 2,
    verb: 1,
    languages: ['lua'],
  },
  // Zap (Zig): `try app.get("/x", handler)`.
  {
    framework: 'zap',
    regex: /\b(?:try\s+)?\w+\.(get|post|put|delete|patch|options|head)\s*\(\s*["']([^"']+)["']/gu,
    path: 2,
    verb: 1,
    languages: ['zig'],
  },
  // Plumber (R): the route is a roxygen comment, `#' @get /x`, which is the only place R states one.
  {
    framework: 'plumber',
    regex: /#'\s*@(get|post|put|delete|patch|head)\s+(\S+)/gu,
    path: 2,
    verb: 1,
    languages: ['r'],
  },
  // Actix Web's attribute macro and Axum's builder, which declare the same endpoint two ways.
  {
    framework: 'actix',
    regex: /#\[(get|post|put|delete|patch)\s*\(\s*["']([^"']+)["']\s*\)\]/gu,
    path: 2,
    verb: 1,
    languages: ['rust'],
  },
  {
    framework: 'axum',
    regex: /\.route\s*\(\s*["']([^"']+)["']\s*,\s*(?:web::)?(get|post|put|delete|patch)/gu,
    path: 1,
    verb: 2,
    languages: ['rust'],
  },
];

/**
 * **The languages whose files can declare a route.**
 *
 * A route is declared in code; markup merely links to one. The Rails pattern — `get "/owners"` at the start of a line —
 * reads a Thymeleaf `th:href="@{/owners}"` as an endpoint once templates are indexed, and on `spring-petclinic` the
 * phase reported **55 routes for a 17-endpoint application** the moment HTML was admitted. The gate is in the phase as
 * well as here, because a detector that trusts its caller is a detector that reports a template as an endpoint.
 */
export const ROUTE_LANGUAGES: ReadonlySet<string> = new Set([
  'cpp',
  'lua',
  'r',
  'svelte',
  'typescript',
  'javascript',
  'python',
  'java',
  'kotlin',
  'go',
  'ruby',
  'php',
  'csharp',
  'rust',
  'scala',
  'elixir',
  'dart',
  'swift',
  'groovy',
  'zig',
]);

/** The path a Next.js app-router file declares, from its directory: `app/api/users/route.ts` answers `/api/users`. */
function nextAppRouterPath(filePath: string): string | null {
  // The scanner hands absolute paths, a test hands `app/api/x/route.ts`, and a repository may have the folder at any
  // depth — so the segment is found rather than assumed to start the string. **A file outside `app/` is not an app
  // router file**, and saying so is better than answering `/`.
  const match = /(?:^|\/)app\/(.+)\/[^/]+$/u.exec(filePath);
  return match === null ? null : `/${group(match, 1)}`;
}

/**
 * **SvelteKit declares a route by where the file sits.** `src/routes/api/users/+server.ts` answers `/api/users`, and the
 * segments in parentheses — `(app)`, `(marketing)` — are route groups that do not appear in the URL. Reading the
 * directory is the whole rule, so there is no syntax to match and no verb to guess: the file exports one function per
 * verb, exactly as the Next.js app router does.
 */
function svelteKitPath(filePath: string): string | null {
  const match = /(?:^|\/)routes\/(.*)\/\+server\.[cm]?[jt]s$/u.exec(filePath);
  if (match === null) return null;
  const segments = group(match, 1)
    .split('/')
    .filter((segment) => segment.length > 0 && !/^\(.*\)$/u.test(segment));
  return `/${segments.join('/')}`;
}

/**
 * **The Pages Router answered every verb from one function, and the path is the directory.** `pages/api/users.ts`
 * exports a default handler that switches on `req.method`, so the file answers whatever the handler does — `ALL`, with
 * the path taken from where it sits. The app router split the same file into one export per verb; that convention is
 * handled above.
 */
function pagesApiPath(filePath: string): string | null {
  const match = /(?:^|\/)pages\/api\/(.+)\.[cm]?[jt]sx?$/u.exec(filePath);
  if (match === null) return null;
  const name = group(match, 1);
  const withoutIndex = name.replace(/(?:^|\/)index$/u, '');
  return withoutIndex.length === 0 ? '/api' : `/api/${withoutIndex}`;
}

const NEXT_ROUTE_FILES: ReadonlySet<string> = new Set([
  'route.ts',
  'route.tsx',
  'route.js',
  'route.jsx',
  'route.mts',
  'route.cts',
]);

/**
 * **Every endpoint one file declares, deduplicated by `(verb, path)`.**
 *
 * The deduplication is the point. Four regexes match one Express route because four libraries share the syntax, and a
 * caller that counted matches would report four endpoints for one — which is what the phase did. The first pattern to
 * claim a `(verb, path)` pair names its framework, and the patterns are ordered from the most specific syntax to the
 * most general so that claim is the informative one.
 *
 * `language` narrows the table: without it, a Ruby route file's `get "/x"` and a Phoenix router's are the same shape,
 * and every pattern that can match is allowed to. Callers that know the language should pass it, and the phase does.
 */
export function detectRoutes(
  filePath: string,
  content: string,
  fileName: string,
  language?: string,
): DetectedRoute[] {
  const found = new Map<string, DetectedRoute>();
  const routes: DetectedRoute[] = [];

  const claim = (route: DetectedRoute): void => {
    const key = `${route.method} ${route.path}`;
    if (found.has(key)) return;
    found.set(key, route);
    routes.push(route);
  };

  const sveltePath = svelteKitPath(filePath);
  if (sveltePath !== null) {
    claim({ path: sveltePath, method: 'ALL', framework: 'sveltekit', line: 1, filePath });
  }

  const pagesPath = pagesApiPath(filePath);
  if (pagesPath !== null && /export\s+default\s+/u.test(content)) {
    claim({ path: pagesPath, method: 'ALL', framework: 'nextjs-pages-api', line: 1, filePath });
  }

  if (NEXT_ROUTE_FILES.has(fileName)) {
    // A Next.js app-router file answers every verb its exported functions name, and the path is the directory.
    const path = nextAppRouterPath(filePath) ?? '/';
    const verbs = [
      ...content.matchAll(
        /export\s+(?:async\s+)?function\s+(GET|POST|PUT|DELETE|PATCH|OPTIONS|HEAD)\b/gu,
      ),
    ].map((match) => verbOf(match[1]));
    if (verbs.length === 0) {
      claim({ path, method: 'ALL', framework: 'nextjs-app-router', line: 1, filePath });
    } else {
      for (const verb of new Set(verbs)) {
        claim({ path, method: verb, framework: 'nextjs-app-router', line: 1, filePath });
      }
    }
  }

  for (const pattern of PATTERNS) {
    if (
      language !== undefined &&
      pattern.languages !== undefined &&
      !pattern.languages.includes(language)
    ) {
      continue;
    }

    // A fresh `lastIndex` per file, because a shared global regex carries the offset from the previous file.
    const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
    for (const match of content.matchAll(regex)) {
      const adjusted = pattern.adjust?.(match, content);
      // **An `adjust` that returns null is a declaration that is not an endpoint**, and falling back to the raw
      // capture would turn `@RequestMapping(method = RequestMethod.GET)` into a route at that argument list.
      if (pattern.adjust !== undefined && adjusted === null) continue;
      const path = adjusted?.path ?? group(match, pattern.path);
      const verb =
        adjusted?.verb ??
        (typeof pattern.verb === 'number' ? verbOf(match[pattern.verb]) : pattern.verb);
      if (path.length === 0) continue;

      const line = content.slice(0, match.index).split('\n').length;
      claim({ path, method: verb, framework: pattern.framework, line, filePath });
    }
  }

  return routes;
}
