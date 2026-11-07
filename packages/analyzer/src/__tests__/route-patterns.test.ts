// @code-analyzer/analyzer — route detection, read from the source rather than from a pipeline run
//
// **The old detector could not be tested without a graph, and it was wrong in three ways a graph would not show.** Four
// of its patterns matched one Express route, so a file with one endpoint produced four `Route` nodes with one qualified
// name — the graph deduplicated them and the inventory looked right, while every count taken before the graph saw four.
// Every Spring endpoint was reported as `ALL`, because the annotation family shared one literal verb. And the framework
// label was inferred from syntax that Gin, Echo, Chi and Fiber all use.
//
// These cases are written as `(verb, path)` pairs because that is the answer a reader wants: *which endpoints does this
// file answer*. The framework label is asserted where the label is evidence and not where it is a guess.

import { describe, expect, it } from 'vitest';

import { detectRoutes, ROUTE_LANGUAGES } from '../pipeline/phases/route-patterns.js';

/** The `(method, path)` pairs a source produces, in the order they are found. */
function pairs(source: string, file = 'src/a.ts', language?: string): string[] {
  return detectRoutes(file, source, file.split('/').pop() ?? file, language).map(
    (route) => `${route.method} ${route.path}`,
  );
}

describe('an endpoint is a verb and a path', () => {
  it('reads the Express family once, not once per library that shares the syntax', () => {
    // `app.get(…)` matched the Express, Express-router, Koa and Hono patterns, and the phase counted four routes.
    expect(pairs(`app.get('/api/health', handler);`, 'src/server.ts', 'typescript')).toEqual([
      'GET /api/health',
    ]);
    expect(pairs(`router.post('/api/data', handler);`, 'src/router.ts', 'javascript')).toEqual([
      'POST /api/data',
    ]);
  });

  it('collapses two declarations of the same endpoint in one file', () => {
    const source = [`app.get('/api/x', a);`, `app.get('/api/x', b);`].join('\n');
    expect(pairs(source, 'src/server.ts', 'typescript')).toEqual(['GET /api/x']);
  });

  it('keeps two verbs on one path, because they are two endpoints', () => {
    const source = [`app.get('/api/x', a);`, `app.post('/api/x', b);`].join('\n');
    expect(pairs(source, 'src/server.ts', 'typescript').sort()).toEqual([
      'GET /api/x',
      'POST /api/x',
    ]);
  });

  it('derives the path a Next.js app-router file answers from its directory', () => {
    const source = [
      'export async function GET() { return Response.json({}); }',
      'export async function POST() { return Response.json({}); }',
    ].join('\n');
    expect(pairs(source, 'app/api/hello/route.ts', 'typescript').sort()).toEqual([
      'GET /api/hello',
      'POST /api/hello',
    ]);
  });

  it('gives a Next.js route file with no exported verb one route that answers everything', () => {
    expect(pairs('export const runtime = "edge";', 'app/api/x/route.ts', 'typescript')).toEqual([
      'ALL /api/x',
    ]);
  });
});

describe('Spring names its verb in the annotation', () => {
  const CONTROLLER = [
    '@RestController',
    'public class OwnerController {',
    '  @GetMapping("/owners")',
    '  public List<Owner> list() { return null; }',
    '  @PostMapping("/owners")',
    '  public Owner create() { return null; }',
    '  @PutMapping(path = "/owners/{id}")',
    '  public Owner update() { return null; }',
    '  @DeleteMapping("/owners/{id}")',
    '  public void delete() {}',
    '}',
  ].join('\n');

  it('reads the verb from the annotation instead of reporting ALL for the family', () => {
    // `spring-petclinic` has 17 endpoints across GET and POST; this detector reported 17 × ALL.
    expect(pairs(CONTROLLER, 'OwnerController.java', 'java').sort()).toEqual([
      'DELETE /owners/{id}',
      'GET /owners',
      'POST /owners',
      'PUT /owners/{id}',
    ]);
  });

  /**
   * **Spring accepts the path as an array**, and `spring-petclinic` writes its vet list that way. A pattern that expected
   * a quote immediately after the parenthesis read the canonical sample application as 16 endpoints; the real number is
   * 17, and the polyglot corpus test is the one that noticed.
   */
  it('reads the array form of a mapping', () => {
    expect(pairs('@GetMapping({ "/vets" })', 'VetController.java', 'java')).toEqual(['GET /vets']);
  });

  it('reads the verb out of a @RequestMapping argument list, and ALL when it names none', () => {
    const source = [
      '@RequestMapping("/all")',
      '@RequestMapping(value = "/x", method = RequestMethod.DELETE)',
      '@RequestMapping(method = RequestMethod.PATCH, value = "/y")',
    ].join('\n');
    expect(pairs(source, 'Mapping.java', 'java').sort()).toEqual([
      'ALL /all',
      'DELETE /x',
      'PATCH /y',
    ]);
  });

  /**
   * **`@RequestMapping` is legal on a class and on a method, and only the method form is an endpoint.** The class form
   * states where its handlers live — `@RestController @RequestMapping("/owners") class OwnerController` — and reading it
   * as a route added a sixth endpoint to a five-endpoint checkout in the end-to-end test for this feature.
   */
  it('reads a class-level prefix as a namespace, and joins it onto the handlers under it', () => {
    const source = [
      '@RestController',
      '@RequestMapping("/owners")',
      'public class OwnerController {',
      '  @GetMapping',
      '  public List<Owner> list() { return null; }',
      '  @GetMapping("/{ownerId}")',
      '  public Owner show() { return null; }',
      '}',
    ].join('\n');
    // Three facts at once: the class annotation is not an endpoint of its own, a handler with no path answers the
    // class's, and a handler with one answers the two joined.
    expect(pairs(source, 'OwnerController.java', 'java').sort()).toEqual([
      'GET /owners',
      'GET /owners/{ownerId}',
    ]);
  });

  it('joins a nested controller’s path onto its parent’s', () => {
    const source = [
      '@RequestMapping("/owners/{ownerId}")',
      'public class PetController {',
      '  @GetMapping("/pets/new")',
      '  public String init() { return null; }',
      '}',
    ].join('\n');
    // `spring-petclinic` serves this handler at `/owners/{ownerId}/pets/new`, and reporting `/pets/new` leaves the
    // reader to open the file.
    expect(pairs(source, 'PetController.java', 'java')).toEqual(['GET /owners/{ownerId}/pets/new']);
  });

  it('does not read a mapping with no path as an endpoint at the empty string', () => {
    expect(pairs('@RequestMapping(method = RequestMethod.GET)', 'Mapping.java', 'java')).toEqual(
      [],
    );
  });
});

describe('the class a handler belongs to is decided by where it sits', () => {
  const FILE = [
    '@RestController',
    '@RequestMapping("/api")',
    'public class Controller {',
    '  private String brace = "}";',
    '  @GetMapping("/inside")',
    '  public String inside() { return brace; }',
    '}',
    '',
    'class Unrelated {',
    '  @GetMapping("/outside")',
    '  public String outside() { return "x"; }',
    '}',
  ].join('\n');

  it('composes a handler inside the class and leaves one in the next class alone', () => {
    // **The `}` inside a string literal is not the end of the block.** Counting braces without blanking the literals
    // would close `Controller` on line 4 and report `/inside` uncomposed while prefixing `/outside` — two wrong answers
    // from one line of text.
    expect(pairs(FILE, 'Controller.java', 'java').sort()).toEqual([
      'GET /api/inside',
      'GET /outside',
    ]);
  });

  it('composes nothing in a language whose classes carry no path', () => {
    const source = ['const app = express();', 'app.get("/x", h);'].join('\n');
    expect(pairs(source, 'src/a.ts', 'typescript')).toEqual(['GET /x']);
  });

  it('ignores a class declaration with no annotation above it', () => {
    const source = [
      'class Plain {',
      '  @GetMapping("/x")',
      '  String x() { return ""; }',
      '}',
    ].join('\n');
    expect(pairs(source, 'Plain.java', 'java')).toEqual(['GET /x']);
  });
});

describe('a declaration that names no path is not an endpoint', () => {
  it('skips a Spring mapping whose path is the empty string', () => {
    expect(pairs('@RequestMapping("")', 'Mapping.java', 'java')).toEqual([]);
    expect(pairs('@GetMapping("")', 'Mapping.java', 'java')).toEqual([]);
  });

  it('skips a Grails mapping whose pattern is the empty string', () => {
    expect(pairs('""(controller: "book")', 'UrlMappings.groovy', 'groovy')).toEqual([]);
  });

  it('answers the Pages Router index with the directory it is in', () => {
    expect(
      pairs('export default function handler(req, res) {}', 'pages/api/index.ts', 'typescript'),
    ).toEqual(['ALL /api']);
  });

  it('skips a Pages Router file that does not export a default handler', () => {
    expect(pairs('export const x = 1;', 'pages/api/users.ts', 'typescript')).toEqual([]);
  });
});

describe('the other frameworks', () => {
  it('reads ASP.NET attributes, and skips one whose template nothing supplies', () => {
    const source = [
      '[HttpGet("/api/users")]',
      '[HttpPost(Template = "/api/users")]',
      '[HttpDelete]',
    ].join('\n');
    // A file with no `[Route]` above the class leaves `[HttpDelete]` with no path at all, and a route at the empty
    // string is worse than no route: it is indistinguishable from a real endpoint when counted.
    expect(pairs(source, 'UsersController.cs', 'csharp').sort()).toEqual([
      'GET /api/users',
      'POST /api/users',
    ]);
  });

  it('supplies an ASP.NET template from [Route] and the class name', () => {
    const source = [
      '[ApiController]',
      '[Route("api/[controller]")]',
      'public class WidgetController : ControllerBase {',
      '  [HttpGet]',
      '  public IActionResult List() => Ok();',
      '  [HttpGet("{id}")]',
      '  public IActionResult Show(int id) => Ok();',
      '}',
    ].join('\n');
    // `[controller]` is the class name without its `Controller` suffix — ASP.NET's own token, not a guess.
    expect(pairs(source, 'WidgetController.cs', 'csharp').sort()).toEqual([
      'GET /api/Widget',
      'GET /api/Widget/{id}',
    ]);
  });

  it('reads NestJS decorators, and skips the ones that inherit the controller prefix', () => {
    const source = [
      '@Controller("widgets")',
      'export class WidgetController {',
      "  @Get('all')",
      '  list() {}',
      '  @Post()',
      '  create() {}',
      '}',
    ].join('\n');
    // `@Post()` has no path of its own and answers the controller's; `@Get('all')` answers the two joined.
    expect(pairs(source, 'widget.controller.ts', 'typescript').sort()).toEqual([
      'GET /widgets/all',
      'POST /widgets',
    ]);
  });

  it('reads Ktor routes and skips a decorator with no path', () => {
    const source = [
      'routing {',
      '  get("/health") { call.respondText("ok") }',
      '  post("/owners") { call.respond(HttpStatusCode.Created) }',
      '}',
    ].join('\n');
    expect(pairs(source, 'Application.kt', 'kotlin').sort()).toEqual([
      'GET /health',
      'POST /owners',
    ]);
  });

  it('reads a Grails URL mapping with its optional verb', () => {
    const source = [
      '"/books"(controller: "book", action: "index")',
      '"/books"(controller: "book", action: "save", method: "POST")',
    ].join('\n');
    expect(pairs(source, 'UrlMappings.groovy', 'groovy').sort()).toEqual([
      'ALL /books',
      'POST /books',
    ]);
  });

  it('reads FastAPI decorators, Flask routes with a methods list, and Django patterns', () => {
    expect(pairs('@app.get("/items")', 'src/api.py', 'python')).toEqual(['GET /items']);
    expect(pairs('@app.route("/items", methods=["POST", "PUT"])', 'src/api.py', 'python')).toEqual([
      'POST /items',
    ]);
    expect(pairs('@app.route("/health")', 'src/api.py', 'python')).toEqual(['GET /health']);
    expect(
      pairs(`urlpatterns = [path("owners/<int:pk>/", view)]`, 'src/urls.py', 'python'),
    ).toEqual(['ALL owners/<int:pk>/']);
  });

  it('reads the Go routers and keeps the verb the call names', () => {
    // The old table labelled these `gin`/`echo`/`chi`/`fiber` from the receiver's name and reported `ALL`, because its
    // verb capture was group 1 and its path was group 2 — the same swap that broke Spring.
    expect(pairs('r.GET("/api/ping", handler)', 'main.go', 'go')).toEqual(['GET /api/ping']);
    expect(pairs('e.POST("/api/users", handler)', 'main.go', 'go')).toEqual(['POST /api/users']);
  });

  it('reads Rails routes and collective resources', () => {
    const source = [
      'Rails.application.routes.draw do',
      '  get "/owners"',
      '  resources :books',
      'end',
    ].join('\n');
    expect(pairs(source, 'config/routes.rb', 'ruby').sort()).toEqual(['ALL /books', 'GET /owners']);
  });

  it('reads Laravel facades and Phoenix routers', () => {
    expect(
      pairs(`Route::post('/owners', [OwnerController::class, 'store']);`, 'routes/web.php', 'php'),
    ).toEqual(['POST /owners']);
    expect(pairs('get "/owners", OwnerController, :index', 'lib/router.ex', 'elixir')).toEqual([
      'GET /owners',
    ]);
  });

  it('reads both of Rust’s spellings of a route', () => {
    expect(pairs('#[get("/owners")]', 'src/routes.rs', 'rust')).toEqual(['GET /owners']);
    expect(pairs('.route("/owners", web::post())', 'src/routes.rs', 'rust')).toEqual([
      'POST /owners',
    ]);
  });
});

describe('the language of the file decides which syntax is allowed', () => {
  it('does not read a Rails route out of a Kotlin file', () => {
    expect(pairs('get "/owners"', 'a.kt', 'kotlin')).toEqual([]);
  });

  it('does not read a Ktor route out of a Ruby file', () => {
    expect(pairs('get("/health") { }', 'a.rb', 'ruby')).toEqual([]);
  });

  it('does not read a route out of a language that cannot declare one', () => {
    for (const language of ['yaml', 'json', 'html', 'css', 'markdown']) {
      expect(pairs('app.get("/x", h)', `a.${language}`, language), language).toEqual([]);
    }
  });

  it('names twenty languages as able to declare a route', () => {
    // A language in this set that no pattern can match is a language the inventory silently omits.
    expect([...ROUTE_LANGUAGES].sort()).toEqual([
      'cpp',
      'csharp',
      'dart',
      'elixir',
      'go',
      'groovy',
      'java',
      'javascript',
      'kotlin',
      'lua',
      'php',
      'python',
      'r',
      'ruby',
      'rust',
      'scala',
      'svelte',
      'swift',
      'typescript',
      'zig',
    ]);
  });

  /**
   * **A language in the set that no pattern can match is an inventory that silently omits it.** The gate above says
   * which languages may declare a route; this says that each of them can, and it is written as a table so the next
   * language added to `ROUTE_LANGUAGES` has to bring the syntax with it.
   */
  const SYNTAX: Readonly<Record<string, { file: string; source: string }>> = {
    typescript: { file: 'src/a.ts', source: `app.get('/x', h)` },
    javascript: { file: 'src/a.js', source: `app.get('/x', h)` },
    python: { file: 'src/a.py', source: `@app.get('/x')` },
    java: { file: 'src/A.java', source: `@GetMapping("/x")` },
    kotlin: { file: 'src/A.kt', source: `get("/x") { }` },
    go: { file: 'main.go', source: `r.GET("/x", h)` },
    ruby: { file: 'config/routes.rb', source: `get "/x"` },
    php: { file: 'routes/web.php', source: `Route::get('/x', h);` },
    csharp: { file: 'Api.cs', source: `[HttpGet("/x")]` },
    rust: { file: 'src/r.rs', source: `#[get("/x")]` },
    scala: { file: 'Controller.scala', source: `@GetMapping("/x")` },
    elixir: { file: 'lib/router.ex', source: `get "/x", H` },
    dart: { file: 'bin/server.dart', source: `app.get('/x', h)` },
    swift: { file: 'Sources/App/main.swift', source: `app.get("/x", h)` },
    groovy: { file: 'grails-app/UrlMappings.groovy', source: `"/x"(controller: "x")` },
    cpp: { file: 'src/main.cpp', source: `CROW_ROUTE(app, "/x")()` },
    lua: { file: 'app.lua', source: `app:get("/x", h)` },
    r: { file: 'plumber.R', source: `#' @get /x` },
    zig: { file: 'src/main.zig', source: `try app.get("/x", h);` },
    svelte: {
      file: 'src/routes/x/+server.ts',
      source: `export function GET() { return new Response(); }`,
    },
  };

  it('finds a route in every language the set names, from that language’s own syntax', () => {
    const silent = [...ROUTE_LANGUAGES].filter((language) => {
      const syntax = SYNTAX[language];
      if (syntax === undefined) return true;
      const file = syntax.file.split('/').pop() ?? syntax.file;
      return detectRoutes(syntax.file, syntax.source, file, language).length === 0;
    });
    expect(silent, 'languages in ROUTE_LANGUAGES that no pattern can match').toEqual([]);
  });

  it('has no syntax for a language the set does not name', () => {
    const extra = Object.keys(SYNTAX).filter((language) => !ROUTE_LANGUAGES.has(language));
    expect(extra, 'languages with a route syntax that ROUTE_LANGUAGES does not admit').toEqual([]);
  });
});

describe('a file convention is a route the directory declares', () => {
  it('derives a SvelteKit path and drops the route groups from it', () => {
    const routes = detectRoutes(
      'src/routes/(app)/api/users/+server.ts',
      'export function GET() { return new Response(); }',
      '+server.ts',
      'svelte',
    );
    expect(routes.map((route) => `${route.method} ${route.path}`)).toEqual(['ALL /api/users']);
  });
});

describe('a route knows where it was written', () => {
  it('reports the line the declaration starts on', () => {
    const source = ['const x = 1;', '', "app.get('/owners', h);"].join('\n');
    expect(detectRoutes('src/a.ts', source, 'a.ts', 'typescript')[0]?.line).toBe(3);
  });

  it('reports the file the caller named, unchanged', () => {
    const routes = detectRoutes('/repo/src/a.ts', "app.get('/x', h);", 'a.ts', 'typescript');
    expect(routes.map((route) => route.filePath)).toEqual(['/repo/src/a.ts']);
  });
});
