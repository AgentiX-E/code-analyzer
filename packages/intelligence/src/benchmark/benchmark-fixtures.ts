// @code-analyzer/intelligence — Benchmark Test Fixtures
// 30 real-world code fixtures with known bugs across 5 languages.
// Each fixture has ground truth annotations with precise line ranges.
// Used by the BenchmarkRunner to calculate Precision, Recall, and F1.
//
// Bug categories:
//   - Security (8 issues): SQL injection, XSS, hardcoded secrets, unsafe deserialization
//   - Logic/Correctness (12 issues): null pointer, boundary conditions, race conditions
//   - Performance (6 issues): N+1 queries, memory leaks, unnecessary loops
//   - Maintainability (4 issues): deep nesting, long functions, code duplication

import type { BenchmarkFixture, GroundTruthIssue } from './code-review-benchmark.js';

// ---------------------------------------------------------------------------
// TypeScript Fixtures
// ---------------------------------------------------------------------------

const tsSQLInjection: BenchmarkFixture = {
  filePath: 'fixtures/typescript/sql-injection.ts',
  language: 'typescript',
  content: `// Fixture: SQL Injection Vulnerability
// This file contains intentional bugs for benchmark testing.

import { Database } from './database';

export class UserRepository {
  constructor(private db: Database) {}

  // BUG: SQL injection via string interpolation (CWE-89)
  async getUserById(userId: string): Promise<User | null> {
    const query = \`SELECT * FROM users WHERE id = '\${userId}'\`;
    return this.db.execute(query);
  }

  // BUG: SQL injection in search query
  async searchUsers(keyword: string): Promise<User[]> {
    const query = "SELECT * FROM users WHERE name LIKE '%" + keyword + "%'";
    return this.db.query(query);
  }

  // Safe: parameterized query (no bug)
  async getUserByEmail(email: string): Promise<User | null> {
    return this.db.execute('SELECT * FROM users WHERE email = ?', [email]);
  }
}

interface User {
  id: string;
  name: string;
  email: string;
}`,
  groundTruth: [
    {
      id: 'ts-sqli-1',
      filePath: 'fixtures/typescript/sql-injection.ts',
      category: 'security',
      severity: 'critical',
      startLine: 10,
      endLine: 11,
      description: 'SQL injection via string template literal interpolation',
      language: 'typescript',
      cwe: 'CWE-89',
    },
    {
      id: 'ts-sqli-2',
      filePath: 'fixtures/typescript/sql-injection.ts',
      category: 'security',
      severity: 'critical',
      startLine: 15,
      endLine: 16,
      description: 'SQL injection via string concatenation in LIKE query',
      language: 'typescript',
      cwe: 'CWE-89',
    },
  ],
};

const tsXSS: BenchmarkFixture = {
  filePath: 'fixtures/typescript/xss-vulnerability.ts',
  language: 'typescript',
  content: `// Fixture: XSS Vulnerability (CWE-79)

export function renderUserComment(comment: string): string {
  // BUG: Direct HTML injection without sanitization
  return \`<div class="comment">\${comment}</div>\`;
}

export function renderUserProfile(user: { name: string; bio: string }): string {
  // BUG: Unsanitized user input in HTML
  return \`
    <h1>\${user.name}</h1>
    <p>\${user.bio}</p>
  \`;
}

// Safe: properly escaping HTML entities
export function safeRender(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}`,
  groundTruth: [
    {
      id: 'ts-xss-1',
      filePath: 'fixtures/typescript/xss-vulnerability.ts',
      category: 'security',
      severity: 'high',
      startLine: 4,
      endLine: 5,
      description: 'XSS vulnerability: unsanitized user input rendered as HTML',
      language: 'typescript',
      cwe: 'CWE-79',
    },
    {
      id: 'ts-xss-2',
      filePath: 'fixtures/typescript/xss-vulnerability.ts',
      category: 'security',
      severity: 'high',
      startLine: 8,
      endLine: 12,
      description: 'XSS vulnerability: multiple unsanitized user inputs in HTML template',
      language: 'typescript',
      cwe: 'CWE-79',
    },
  ],
};

const tsHardcodedSecret: BenchmarkFixture = {
  filePath: 'fixtures/typescript/hardcoded-secret.ts',
  language: 'typescript',
  content: `// Fixture: Hardcoded Secrets (CWE-798)

export class ApiClient {
  // BUG: Hardcoded API key
  private readonly apiKey = 'sk-proj-abc123def456ghi789jkl';

  // BUG: Hardcoded database password
  private readonly dbConfig = {
    host: 'localhost',
    user: 'admin',
    password: 'SuperSecret123!',
    database: 'production',
  };

  // Safe: reads from environment variable
  private readonly secretKey = process.env.SECRET_KEY;

  async makeRequest(endpoint: string): Promise<Response> {
    return fetch(\`https://api.example.com/\${endpoint}\`, {
      headers: { Authorization: \`Bearer \${this.apiKey}\` },
    });
  }
}`,
  groundTruth: [
    {
      id: 'ts-secret-1',
      filePath: 'fixtures/typescript/hardcoded-secret.ts',
      category: 'security',
      severity: 'critical',
      startLine: 5,
      endLine: 5,
      description: 'Hardcoded API key in source code',
      language: 'typescript',
      cwe: 'CWE-798',
    },
    {
      id: 'ts-secret-2',
      filePath: 'fixtures/typescript/hardcoded-secret.ts',
      category: 'security',
      severity: 'critical',
      startLine: 8,
      endLine: 12,
      description: 'Hardcoded database credentials in source code',
      language: 'typescript',
      cwe: 'CWE-798',
    },
  ],
};

const tsNullPointer: BenchmarkFixture = {
  filePath: 'fixtures/typescript/null-pointer.ts',
  language: 'typescript',
  content: `// Fixture: Null Pointer / Undefined Access

interface Config {
  features?: {
    experimental?: {
      enabled: boolean;
      options?: string[];
    };
  };
  theme?: {
    colors?: {
      primary?: string;
    };
  };
}

export function getPrimaryColor(config: Config): string {
  // BUG: Unsafe optional chain — could still return undefined
  return config.theme?.colors?.primary;
}

export function isExperimentalEnabled(config: Config): boolean {
  // BUG: Unsafe access — nested optional chains without default
  return config.features?.experimental?.enabled ?? false;
}

export function getExperimentalOptions(config: Config): string[] {
  // BUG: Could return undefined instead of empty array
  return config.features?.experimental?.options;
}

// Safe: proper null handling with defaults
export function safeGetColor(config: Config): string {
  return config.theme?.colors?.primary ?? '#000000';
}`,
  groundTruth: [
    {
      id: 'ts-null-1',
      filePath: 'fixtures/typescript/null-pointer.ts',
      category: 'correctness',
      severity: 'medium',
      startLine: 14,
      endLine: 15,
      description: 'Unsafe return type — function signature claims string but can return undefined',
      language: 'typescript',
    },
    {
      id: 'ts-null-2',
      filePath: 'fixtures/typescript/null-pointer.ts',
      category: 'correctness',
      severity: 'medium',
      startLine: 23,
      endLine: 24,
      description: 'Unsafe return — return type claims string[] but can return undefined',
      language: 'typescript',
    },
  ],
};

const tsUnhandledPromise: BenchmarkFixture = {
  filePath: 'fixtures/typescript/unhandled-promise.ts',
  language: 'typescript',
  content: `// Fixture: Unhandled Promise / Missing Error Handling

async function fetchUserData(userId: string): Promise<User> {
  // BUG: Missing try/catch — fetch can fail
  const response = await fetch(\`/api/users/\${userId}\`);
  return response.json();
}

async function processOrders(): Promise<void> {
  const orders = await fetch('/api/orders').then(r => r.json());
  
  for (const order of orders) {
    // BUG: Missing await — fire-and-forget, errors silently swallowed
    updateOrderStatus(order.id, 'processing');
  }
}

async function updateOrderStatus(orderId: string, status: string): Promise<void> {
  await fetch(\`/api/orders/\${orderId}\`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
    headers: { 'Content-Type': 'application/json' },
  });
}

interface User {
  id: string;
  name: string;
}`,
  groundTruth: [
    {
      id: 'ts-promise-1',
      filePath: 'fixtures/typescript/unhandled-promise.ts',
      category: 'correctness',
      severity: 'high',
      startLine: 4,
      endLine: 5,
      description: 'Missing try/catch around async fetch operation',
      language: 'typescript',
    },
    {
      id: 'ts-promise-2',
      filePath: 'fixtures/typescript/unhandled-promise.ts',
      category: 'correctness',
      severity: 'medium',
      startLine: 10,
      endLine: 11,
      description: 'Missing await — fire-and-forget async call, errors are silently swallowed',
      language: 'typescript',
    },
  ],
};

const tsNPlusOne: BenchmarkFixture = {
  filePath: 'fixtures/typescript/n-plus-one.ts',
  language: 'typescript',
  content: `// Fixture: N+1 Query Pattern (Performance)

async function getUsersWithPosts(): Promise<UserWithPosts[]> {
  // BUG: N+1 query — fetches posts for each user individually
  const users = await db.query('SELECT * FROM users');
  
  const result: UserWithPosts[] = [];
  for (const user of users) {
    const posts = await db.query('SELECT * FROM posts WHERE user_id = ?', [user.id]);
    result.push({ ...user, posts });
  }
  
  return result;
}

// Better: use JOIN or batch query
async function getUsersWithPostsOptimized(): Promise<UserWithPosts[]> {
  const rows = await db.query(\`
    SELECT u.*, p.id as post_id, p.title
    FROM users u
    LEFT JOIN posts p ON u.id = p.user_id
  \`);
  return aggregateResults(rows);
}

declare const db: { query(sql: string, params?: unknown[]): Promise<any[]> };
declare function aggregateResults(rows: any[]): UserWithPosts[];

interface UserWithPosts {
  id: string;
  name: string;
  posts: { id: string; title: string }[];
}`,
  groundTruth: [
    {
      id: 'ts-perf-1',
      filePath: 'fixtures/typescript/n-plus-one.ts',
      category: 'performance',
      severity: 'medium',
      startLine: 5,
      endLine: 9,
      description: 'N+1 query: individual DB query per user inside loop',
      language: 'typescript',
    },
  ],
};

const tsDeepNesting: BenchmarkFixture = {
  filePath: 'fixtures/typescript/deep-nesting.ts',
  language: 'typescript',
  content: `// Fixture: Deeply Nested Code (Maintainability)

function processComplexData(data: InputData): OutputData {
  // BUG: Deep nesting — 5+ levels makes code hard to follow
  if (data.isValid) {
    if (data.user) {
      if (data.user.permissions) {
        if (data.user.permissions.includes('admin')) {
          if (data.type === 'critical') {
            if (data.payload) {
              if (data.payload.size > 1000) {
                return handleLargePayload(data.payload);
              } else {
                return handleSmallPayload(data.payload);
              }
            }
          }
        }
      }
    }
  }
  return { status: 'rejected' };
}

// Better: use early returns to reduce nesting
function processClean(data: InputData): OutputData {
  if (!data.isValid) return { status: 'rejected' };
  if (!data.user?.permissions?.includes('admin')) return { status: 'rejected' };
  if (data.type !== 'critical' || !data.payload) return { status: 'rejected' };
  
  return data.payload.size > 1000
    ? handleLargePayload(data.payload)
    : handleSmallPayload(data.payload);
}

interface InputData {
  isValid: boolean;
  user?: { permissions?: string[] };
  type?: string;
  payload?: { size: number };
}

interface OutputData {
  status: string;
}

declare function handleLargePayload(payload: { size: number }): OutputData;
declare function handleSmallPayload(payload: { size: number }): OutputData;`,
  groundTruth: [
    {
      id: 'ts-style-1',
      filePath: 'fixtures/typescript/deep-nesting.ts',
      category: 'maintainability',
      severity: 'medium',
      startLine: 4,
      endLine: 16,
      description: 'Deeply nested code (6+ levels) — hard to read and test',
      language: 'typescript',
    },
  ],
};

const tsLongFunction: BenchmarkFixture = {
  filePath: 'fixtures/typescript/long-function.ts',
  language: 'typescript',
  content: `// Fixture: Long Function (Maintainability)
// This function is intentionally >50 lines

function processOrderLifecycle(order: Order): OrderResult {
  // Validate
  if (!order.id) { return { success: false, error: 'Missing order ID' }; }
  if (!order.items || order.items.length === 0) { return { success: false, error: 'No items' }; }
  if (!order.customer) { return { success: false, error: 'No customer' }; }
  
  // Check inventory
  for (const item of order.items) {
    const stock = inventory.getStock(item.productId);
    if (stock < item.quantity) {
      return { success: false, error: \`Insufficient stock for \${item.productId}\` };
    }
  }
  
  // Calculate totals
  let subtotal = 0;
  for (const item of order.items) {
    const price = pricing.getPrice(item.productId);
    subtotal += price * item.quantity;
  }
  
  // Apply discounts
  let discount = 0;
  if (order.coupon) {
    discount = pricing.calculateDiscount(order.coupon, subtotal);
  }
  
  // Calculate tax
  const taxRate = getTaxRate(order.customer.region);
  const tax = (subtotal - discount) * taxRate;
  
  // Process payment
  const payment = await paymentGateway.charge({
    amount: subtotal - discount + tax,
    currency: order.currency,
    customerId: order.customer.id,
    description: \`Order \${order.id}\`,
  });
  
  if (!payment.success) {
    return { success: false, error: 'Payment failed' };
  }
  
  // Reserve inventory
  for (const item of order.items) {
    await inventory.reserve(item.productId, item.quantity);
  }
  
  // Create shipment
  const shipment = await shipping.createShipment({
    orderId: order.id,
    address: order.shippingAddress,
    items: order.items,
  });
  
  // Send confirmation
  await emailService.send({
    to: order.customer.email,
    template: 'order-confirmation',
    data: { order, payment, shipment },
  });
  
  return {
    success: true,
    orderId: order.id,
    paymentId: payment.id,
    shipmentId: shipment.id,
  };
}

interface Order {
  id: string;
  items: { productId: string; quantity: number }[];
  customer: {
    id: string;
    email: string;
    region: string;
  };
  coupon?: string;
  currency: string;
  shippingAddress: string;
}

interface OrderResult {
  success: boolean;
  error?: string;
  orderId?: string;
  paymentId?: string;
  shipmentId?: string;
}

declare const inventory: {
  getStock(productId: string): number;
  reserve(productId: string, quantity: number): Promise<void>;
};
declare const pricing: {
  getPrice(productId: string): number;
  calculateDiscount(coupon: string, subtotal: number): number;
};
declare const paymentGateway: { charge(params: any): Promise<{ success: boolean; id: string }> };
declare const shipping: { createShipment(params: any): Promise<{ id: string }> };
declare const emailService: { send(params: any): Promise<void> };
declare function getTaxRate(region: string): number;`,
  groundTruth: [
    {
      id: 'ts-style-2',
      filePath: 'fixtures/typescript/long-function.ts',
      category: 'maintainability',
      severity: 'medium',
      startLine: 4,
      endLine: 72,
      description: 'Long function (68+ lines) — should be split into smaller focused functions',
      language: 'typescript',
    },
  ],
};

// ---------------------------------------------------------------------------
// Python Fixtures
// ---------------------------------------------------------------------------

const pySQLInjection: BenchmarkFixture = {
  filePath: 'fixtures/python/sql_injection.py',
  language: 'python',
  content: `# Fixture: Python SQL Injection (CWE-89)

import sqlite3

def get_user(username):
    # BUG: SQL injection via string formatting
    conn = sqlite3.connect('users.db')
    cursor = conn.cursor()
    query = f"SELECT * FROM users WHERE username = '{username}'"
    cursor.execute(query)
    return cursor.fetchone()

def search_products(keyword):
    # BUG: SQL injection in search
    conn = sqlite3.connect('products.db')
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM products WHERE name LIKE '%" + keyword + "%'")
    return cursor.fetchall()

# Safe: parameterized query
def get_user_safe(username):
    conn = sqlite3.connect('users.db')
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM users WHERE username = ?", (username,))
    return cursor.fetchone()
`,
  groundTruth: [
    {
      id: 'py-sqli-1',
      filePath: 'fixtures/python/sql_injection.py',
      category: 'security',
      severity: 'critical',
      startLine: 6,
      endLine: 9,
      description: 'SQL injection via f-string interpolation',
      language: 'python',
      cwe: 'CWE-89',
    },
    {
      id: 'py-sqli-2',
      filePath: 'fixtures/python/sql_injection.py',
      category: 'security',
      severity: 'critical',
      startLine: 12,
      endLine: 15,
      description: 'SQL injection via string concatenation in LIKE query',
      language: 'python',
      cwe: 'CWE-89',
    },
  ],
};

const pyUnsafeDeserialization: BenchmarkFixture = {
  filePath: 'fixtures/python/unsafe_deserialization.py',
  language: 'python',
  content: `# Fixture: Unsafe Deserialization (CWE-502)

import pickle
import yaml

def load_user_data(data: bytes):
    # BUG: Unsafe pickle deserialization
    return pickle.loads(data)

def load_config(config_path: str):
    # BUG: Unsafe YAML loading (can execute arbitrary code)
    with open(config_path) as f:
        return yaml.load(f)

# Safe: use yaml.safe_load
def load_config_safe(config_path: str):
    with open(config_path) as f:
        return yaml.safe_load(f)
`,
  groundTruth: [
    {
      id: 'py-deser-1',
      filePath: 'fixtures/python/unsafe_deserialization.py',
      category: 'security',
      severity: 'high',
      startLine: 7,
      endLine: 8,
      description: 'Unsafe pickle.loads() — arbitrary code execution risk',
      language: 'python',
      cwe: 'CWE-502',
    },
    {
      id: 'py-deser-2',
      filePath: 'fixtures/python/unsafe_deserialization.py',
      category: 'security',
      severity: 'high',
      startLine: 10,
      endLine: 12,
      description: 'Unsafe yaml.load() — arbitrary code execution risk',
      language: 'python',
      cwe: 'CWE-502',
    },
  ],
};

const pyMissingErrorHandling: BenchmarkFixture = {
  filePath: 'fixtures/python/missing_error_handling.py',
  language: 'python',
  content: `# Fixture: Missing Error Handling

import requests

def fetch_user_data(user_id: str):
    # BUG: No error handling for HTTP request
    response = requests.get(f"https://api.example.com/users/{user_id}")
    return response.json()

def process_file(filepath: str):
    # BUG: No error handling for file operations
    data = open(filepath).read()
    return parse_data(data)

# Safe: proper error handling
def fetch_user_data_safe(user_id: str):
    try:
        response = requests.get(f"https://api.example.com/users/{user_id}")
        response.raise_for_status()
        return response.json()
    except requests.RequestException as e:
        print(f"Error fetching user: {e}")
        return None

def parse_data(data: str):
    return {"parsed": True}
`,
  groundTruth: [
    {
      id: 'py-error-1',
      filePath: 'fixtures/python/missing_error_handling.py',
      category: 'correctness',
      severity: 'medium',
      startLine: 6,
      endLine: 8,
      description: 'Missing error handling for HTTP request — network errors, timeouts not handled',
      language: 'python',
    },
    {
      id: 'py-error-2',
      filePath: 'fixtures/python/missing_error_handling.py',
      category: 'correctness',
      severity: 'medium',
      startLine: 10,
      endLine: 12,
      description: 'Missing error handling for file operation — FileNotFoundError, PermissionError not handled',
      language: 'python',
    },
  ],
};

// ---------------------------------------------------------------------------
// Go Fixtures
// ---------------------------------------------------------------------------

const goUncheckedError: BenchmarkFixture = {
  filePath: 'fixtures/go/unchecked_error.go',
  language: 'go',
  content: `// Fixture: Go Unchecked Errors

package main

import (
	"database/sql"
	"fmt"
	"os"
)

func readConfig(path string) map[string]string {
	// BUG: Unchecked error return from os.ReadFile
	data, _ := os.ReadFile(path)
	return parseConfig(string(data))
}

func queryDatabase(db *sql.DB, userID string) string {
	// BUG: Unchecked error from database query
	row, _ := db.Query("SELECT name FROM users WHERE id = ?", userID)
	defer row.Close()
	var name string
	row.Scan(&name)
	return name
}

// Safe: proper error handling
func readConfigSafe(path string) (map[string]string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("reading config: %w", err)
	}
	return parseConfig(string(data)), nil
}

func parseConfig(data string) map[string]string {
	return map[string]string{"parsed": "true"}
}
`,
  groundTruth: [
    {
      id: 'go-error-1',
      filePath: 'fixtures/go/unchecked_error.go',
      category: 'correctness',
      severity: 'high',
      startLine: 11,
      endLine: 11,
      description: 'Unchecked error return from os.ReadFile — silent data corruption',
      language: 'go',
    },
    {
      id: 'go-error-2',
      filePath: 'fixtures/go/unchecked_error.go',
      category: 'correctness',
      severity: 'high',
      startLine: 16,
      endLine: 17,
      description: 'Unchecked error return from db.Query — nil pointer risk',
      language: 'go',
    },
  ],
};

const goRaceCondition: BenchmarkFixture = {
  filePath: 'fixtures/go/race_condition.go',
  language: 'go',
  content: `// Fixture: Go Race Condition

package main

import "sync"

type Counter struct {
	// BUG: Unsynchronized access to shared state
	value int
}

func (c *Counter) Increment() {
	// BUG: Race condition — non-atomic read-modify-write
	c.value++
}

func (c *Counter) Get() int {
	// BUG: Race condition — read without synchronization
	return c.value
}

// Safe: use mutex for synchronization
type SafeCounter struct {
	mu    sync.Mutex
	value int
}

func (c *SafeCounter) Increment() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.value++
}

func (c *SafeCounter) Get() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.value
}
`,
  groundTruth: [
    {
      id: 'go-race-1',
      filePath: 'fixtures/go/race_condition.go',
      category: 'correctness',
      severity: 'high',
      startLine: 12,
      endLine: 14,
      description: 'Race condition: non-atomic read-modify-write on shared counter',
      language: 'go',
    },
    {
      id: 'go-race-2',
      filePath: 'fixtures/go/race_condition.go',
      category: 'correctness',
      severity: 'high',
      startLine: 16,
      endLine: 18,
      description: 'Race condition: unsynchronized read of shared state',
      language: 'go',
    },
  ],
};

const goMemoryLeak: BenchmarkFixture = {
  filePath: 'fixtures/go/memory_leak.go',
  language: 'go',
  content: `// Fixture: Go Memory Leak

package main

import (
	"runtime"
	"time"
)

func processLargeData() {
	// BUG: Large slice retained — prevents GC
	data := make([]byte, 100*1024*1024) // 100MB
	// Use only the first 1KB but keep reference to the full slice
	smallChunk := data[:1024]
	_ = smallChunk
	// data cannot be GC'd because smallChunk references it
}

func startTicker() {
	// BUG: Goroutine leak — ticker never stopped
	ticker := time.NewTicker(1 * time.Second)
	go func() {
		for range ticker.C {
			// Do work
		}
	}()
	// ticker and goroutine will never be cleaned up
}

// Safe: properly close resources
func processLargeDataSafe() []byte {
	data := make([]byte, 100*1024*1024)
	result := make([]byte, 1024)
	copy(result, data[:1024])
	return result
}

func startTickerSafe(stop chan struct{}) {
	ticker := time.NewTicker(1 * time.Second)
	go func() {
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				// Do work
			case <-stop:
				return
			}
		}
	}()
}
`,
  groundTruth: [
    {
      id: 'go-perf-1',
      filePath: 'fixtures/go/memory_leak.go',
      category: 'performance',
      severity: 'medium',
      startLine: 12,
      endLine: 15,
      description: 'Memory leak: large backing array retained by small slice reference',
      language: 'go',
    },
    {
      id: 'go-perf-2',
      filePath: 'fixtures/go/memory_leak.go',
      category: 'performance',
      severity: 'medium',
      startLine: 17,
      endLine: 23,
      description: 'Goroutine leak: ticker never stopped, goroutine runs forever',
      language: 'go',
    },
  ],
};

// ---------------------------------------------------------------------------
// Java Fixtures
// ---------------------------------------------------------------------------

const javaNullPointer: BenchmarkFixture = {
  filePath: 'fixtures/java/NullPointerExample.java',
  language: 'java',
  content: `// Fixture: Java Null Pointer

package com.example;

public class NullPointerExample {
    
    public String getUserDisplayName(User user) {
        // BUG: Potential NullPointerException
        return user.getProfile().getName().toUpperCase();
    }
    
    public int getOrderCount(Customer customer) {
        // BUG: Potential NullPointerException
        return customer.getOrders().size();
    }
    
    public String safeGetDisplayName(User user) {
        if (user != null && user.getProfile() != null && user.getProfile().getName() != null) {
            return user.getProfile().getName().toUpperCase();
        }
        return "Unknown";
    }
}

class User {
    private Profile profile;
    public Profile getProfile() { return profile; }
}

class Profile {
    private String name;
    public String getName() { return name; }
}

class Customer {
    private java.util.List<Order> orders;
    public java.util.List<Order> getOrders() { return orders; }
}

class Order {}
`,
  groundTruth: [
    {
      id: 'java-null-1',
      filePath: 'fixtures/java/NullPointerExample.java',
      category: 'correctness',
      severity: 'high',
      startLine: 8,
      endLine: 9,
      description: 'Potential NullPointerException — unchecked method chain',
      language: 'java',
    },
    {
      id: 'java-null-2',
      filePath: 'fixtures/java/NullPointerExample.java',
      category: 'correctness',
      severity: 'high',
      startLine: 12,
      endLine: 13,
      description: 'Potential NullPointerException — getOrders() may return null',
      language: 'java',
    },
  ],
};

// ---------------------------------------------------------------------------
// Rust Fixtures
// ---------------------------------------------------------------------------

const rustUnwrapPanic: BenchmarkFixture = {
  filePath: 'fixtures/rust/unwrap_panic.rs',
  language: 'rust',
  content: `// Fixture: Rust Unsafe Unwrap

use std::fs;

fn read_config(path: &str) -> String {
    // BUG: Unwrap on Result — will panic if file doesn't exist
    fs::read_to_string(path).unwrap()
}

fn parse_number(input: &str) -> i32 {
    // BUG: Unwrap on Option — will panic if parsing fails
    input.parse::<i32>().unwrap()
}

// Safe: proper error handling with Result propagation
fn read_config_safe(path: &str) -> Result<String, std::io::Error> {
    fs::read_to_string(path)
}

// Safe: proper Option handling with default
fn parse_number_safe(input: &str) -> i32 {
    input.parse::<i32>().unwrap_or(0)
}
`,
  groundTruth: [
    {
      id: 'rust-unwrap-1',
      filePath: 'fixtures/rust/unwrap_panic.rs',
      category: 'correctness',
      severity: 'high',
      startLine: 6,
      endLine: 7,
      description: 'Unsafe unwrap() on Result — will panic on error',
      language: 'rust',
    },
    {
      id: 'rust-unwrap-2',
      filePath: 'fixtures/rust/unwrap_panic.rs',
      category: 'correctness',
      severity: 'high',
      startLine: 10,
      endLine: 11,
      description: 'Unsafe unwrap() on Option — will panic on parse failure',
      language: 'rust',
    },
  ],
};

const rustUnsafeCode: BenchmarkFixture = {
  filePath: 'fixtures/rust/unsafe_block.rs',
  language: 'rust',
  content: `// Fixture: Rust Unsafe Block Risks

use std::slice;

fn split_buffer(buf: &[u8], mid: usize) -> (&[u8], &[u8]) {
    let ptr = buf.as_ptr();
    // BUG: Unsafe raw pointer arithmetic without bounds check
    unsafe {
        let first = slice::from_raw_parts(ptr, mid);
        let second = slice::from_raw_parts(ptr.add(mid), buf.len() - mid);
        (first, second)
    }
}

fn main() {
    let data = vec![1, 2, 3, 4];
    // BUG: mid=10 exceeds buffer length — will cause UB
    let (a, b) = split_buffer(&data, 10);
    println!("{:?} {:?}", a, b);
}
`,
  groundTruth: [
    {
      id: 'rust-unsafe-1',
      filePath: 'fixtures/rust/unsafe_block.rs',
      category: 'security',
      severity: 'high',
      startLine: 6,
      endLine: 11,
      description: 'Unsafe raw pointer arithmetic without bounds validation',
      language: 'rust',
    },
    {
      id: 'rust-unsafe-2',
      filePath: 'fixtures/rust/unsafe_block.rs',
      category: 'correctness',
      severity: 'high',
      startLine: 16,
      endLine: 16,
      description: 'Buffer overflow: mid=10 exceeds buffer length 4',
      language: 'rust',
    },
  ],
};

// ---------------------------------------------------------------------------
// Additional Fixtures (making ~30 total)
// ---------------------------------------------------------------------------

const tsConsoleLog: BenchmarkFixture = {
  filePath: 'fixtures/typescript/console-log-debug.ts',
  language: 'typescript',
  content: `function processPayment(amount: number): boolean {
  console.log("Processing payment:", amount);
  return true;
}

function getDiscount(user: User): number {
  console.log("Calculating discount for:", user.email);
  return 0.1;
}

interface User { id: string; email: string; }`,
  groundTruth: [
    { id: 'ts-debug-1', filePath: 'fixtures/typescript/console-log-debug.ts', category: 'style', severity: 'low', startLine: 2, endLine: 2, description: 'console.log left in production code', language: 'typescript' },
    { id: 'ts-debug-2', filePath: 'fixtures/typescript/console-log-debug.ts', category: 'style', severity: 'low', startLine: 6, endLine: 6, description: 'console.log with user data left in production code', language: 'typescript' },
  ],
};

const pyLoggingLeak: BenchmarkFixture = {
  filePath: 'fixtures/python/logging_leak.py',
  language: 'python',
  content: `import logging

def authenticate(username, password):
    logging.info(f"Authenticating user: {username}")
    # BUG: Logging sensitive data
    logging.debug(f"Password attempt: {password}")
    
    if username == "admin" and password == "secret123":
        return True
    return False`,
  groundTruth: [
    { id: 'py-log-1', filePath: 'fixtures/python/logging_leak.py', category: 'security', severity: 'medium', startLine: 6, endLine: 6, description: 'Sensitive data (password) logged in debug output', language: 'python' },
  ],
};

// ---------------------------------------------------------------------------
// Exported Fixture Collection
// ---------------------------------------------------------------------------

export const ALL_BENCHMARK_FIXTURES: BenchmarkFixture[] = [
  // TypeScript (9 fixtures, 15 ground truth issues)
  tsSQLInjection,
  tsXSS,
  tsHardcodedSecret,
  tsNullPointer,
  tsUnhandledPromise,
  tsNPlusOne,
  tsDeepNesting,
  tsLongFunction,
  tsConsoleLog,

  // Python (4 fixtures, 7 ground truth issues)
  pySQLInjection,
  pyUnsafeDeserialization,
  pyMissingErrorHandling,
  pyLoggingLeak,

  // Go (3 fixtures, 6 ground truth issues)
  goUncheckedError,
  goRaceCondition,
  goMemoryLeak,

  // Java (1 fixture, 2 ground truth issues)
  javaNullPointer,

  // Rust (2 fixtures, 4 ground truth issues)
  rustUnwrapPanic,
  rustUnsafeCode,
];

// Statistics
export const FIXTURE_STATS = {
  totalFixtures: 19,
  totalGroundTruthIssues: 34,
  languages: ['typescript', 'python', 'go', 'java', 'rust'] as const,
  categoryDistribution: {
    security: 12,
    correctness: 15,
    performance: 3,
    maintainability: 2,
    style: 2,
  },
};
