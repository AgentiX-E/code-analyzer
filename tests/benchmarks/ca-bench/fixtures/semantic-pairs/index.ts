// CA-Bench Fixtures — Semantic Pairs
// Curated pairs of code snippets with varying semantic similarity levels.
// Used by the embedding-quality benchmark suite to validate
// that code embeddings capture semantic meaning correctly.

import type { EmbeddingPair } from '../../types.js';

// ---------------------------------------------------------------------------
// High Similarity Pairs (same logic, different variable names / syntax)
// ---------------------------------------------------------------------------

export const HIGH_SIMILARITY_PAIRS: EmbeddingPair[] = [
  {
    id: 'hs-01',
    textA: 'function add(a, b) { return a + b; }',
    textB: 'function sum(x, y) { return x + y; }',
    expectedSimilarity: 'high',
    minCosSimilarity: 0.85,
  },
  {
    id: 'hs-02',
    textA: 'const result = items.filter(x => x.active).map(x => x.name);',
    textB: 'const names = data.filter(d => d.active).map(d => d.name);',
    expectedSimilarity: 'high',
    minCosSimilarity: 0.85,
  },
  {
    id: 'hs-03',
    textA: 'async function fetchUser(id) { const res = await fetch(`/api/users/${id}`); return res.json(); }',
    textB: 'async function getUser(userId) { const resp = await fetch(`/api/users/${userId}`); return resp.json(); }',
    expectedSimilarity: 'high',
    minCosSimilarity: 0.85,
  },
  {
    id: 'hs-04',
    textA: 'class UserService { async findById(id: number): Promise<User> { return db.users.findOne({ id }); } }',
    textB: 'class UserRepository { async findById(id: number): Promise<User> { return this.db.users.findOne({ id }); } }',
    expectedSimilarity: 'high',
    minCosSimilarity: 0.80,
  },
];

// ---------------------------------------------------------------------------
// Medium Similarity Pairs (related concepts, different implementation)
// ---------------------------------------------------------------------------

export const MEDIUM_SIMILARITY_PAIRS: EmbeddingPair[] = [
  {
    id: 'ms-01',
    textA: 'function validateEmail(email) { return /^[^@]+@[^@]+$/.test(email); }',
    textB: 'function isValidEmail(input) { return input.includes("@") && input.includes("."); }',
    expectedSimilarity: 'medium',
    maxCosSimilarity: 0.85,
    minCosSimilarity: 0.50,
  },
  {
    id: 'ms-02',
    textA: 'SELECT * FROM users WHERE email = ? AND active = true ORDER BY created_at DESC LIMIT 10',
    textB: 'SELECT id, name FROM users WHERE email = ? AND active = 1 ORDER BY created_at DESC LIMIT 10',
    expectedSimilarity: 'medium',
    maxCosSimilarity: 0.90,
    minCosSimilarity: 0.60,
  },
  {
    id: 'ms-03',
    textA: 'const server = express(); server.use(cors()); server.use(express.json()); server.get("/health", (req, res) => res.json({ status: "ok" }));',
    textB: 'app.use(cors()); app.use(bodyParser.json()); app.get("/ping", (req, res) => res.send({ status: "ok" }));',
    expectedSimilarity: 'medium',
    maxCosSimilarity: 0.85,
    minCosSimilarity: 0.55,
  },
];

// ---------------------------------------------------------------------------
// Low Similarity Pairs (completely different concepts)
// ---------------------------------------------------------------------------

export const LOW_SIMILARITY_PAIRS: EmbeddingPair[] = [
  {
    id: 'ls-01',
    textA: 'function connectDatabase(url) { return mongoose.connect(url, { useNewUrlParser: true }); }',
    textB: 'function renderTemplate(template, data) { return mustache.render(template, data); }',
    expectedSimilarity: 'low',
    maxCosSimilarity: 0.50,
  },
  {
    id: 'ls-02',
    textA: 'def fibonacci(n): return n if n <= 1 else fibonacci(n-1) + fibonacci(n-2)',
    textB: 'def read_config(path): return yaml.safe_load(open(path))',
    expectedSimilarity: 'low',
    maxCosSimilarity: 0.50,
  },
  {
    id: 'ls-03',
    textA: 'public class PaymentProcessor { public void process(Payment p) { gateway.charge(p); } }',
    textB: 'public class ImageResizer { public void resize(Image img, int w, int h) { return img.scale(w, h); } }',
    expectedSimilarity: 'low',
    maxCosSimilarity: 0.50,
  },
  {
    id: 'ls-04',
    textA: 'terraform { required_providers { aws = { source = "hashicorp/aws" } } } resource "aws_instance" "web" { ami = "ami-123" }',
    textB: '#include <stdio.h>\nint main() { printf("Hello, World!\\n"); return 0; }',
    expectedSimilarity: 'low',
    maxCosSimilarity: 0.30,
  },
];

// ---------------------------------------------------------------------------
// All Pairs
// ---------------------------------------------------------------------------

export const ALL_SEMANTIC_PAIRS: EmbeddingPair[] = [
  ...HIGH_SIMILARITY_PAIRS,
  ...MEDIUM_SIMILARITY_PAIRS,
  ...LOW_SIMILARITY_PAIRS,
];
