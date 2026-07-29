// @code-analyzer/server — GraphQL Schema
// Schema-first GraphQL API using SDL for the code-analyzer platform.

export const typeDefs = /* GraphQL */ `
  # -------------------------------------------------------------------------
  # Scalars
  # -------------------------------------------------------------------------

  """JSON value — maps to a plain Record<string, unknown>"""
  scalar JSON

  """A date-time string in ISO 8601 format"""
  scalar DateTime

  # -------------------------------------------------------------------------
  # Core Types
  # -------------------------------------------------------------------------

  """A project tracked by code-analyzer"""
  type Project {
    id: ID!
    rootPath: String!
    name: String!
    language: String
    indexedAt: DateTime
    lastCommit: String
    nodeCount: Int!
    edgeCount: Int!
    status: ProjectStatus!
    config: JSON!
  }

  enum ProjectStatus {
    IDLE
    INDEXING
    READY
    ERROR
  }

  """A node in the knowledge graph"""
  type GraphNode {
    id: Int!
    projectId: String!
    label: String!
    name: String!
    qualifiedName: String!
    filePath: String
    startLine: Int
    endLine: Int
    language: String
    signature: String
    docstring: String
    complexity: Int
    isExported: Boolean!
    fingerprint: String
    properties: JSON!
    createdAt: DateTime!
    updatedAt: DateTime!
  }

  """An edge in the knowledge graph"""
  type GraphEdge {
    id: Int!
    projectId: String!
    sourceId: Int!
    targetId: Int!
    type: String!
    weight: Float!
    properties: JSON!
    createdAt: DateTime!
  }

  """Page info for cursor-based pagination"""
  type PageInfo {
    hasMore: Boolean!
    total: Int!
    offset: Int!
    limit: Int!
  }

  """Paginated node results"""
  type NodeConnection {
    items: [GraphNode!]!
    pageInfo: PageInfo!
  }

  """Paginated edge results"""
  type EdgeConnection {
    items: [GraphEdge!]!
    pageInfo: PageInfo!
  }

  # -------------------------------------------------------------------------
  # Review Types
  # -------------------------------------------------------------------------

  """Severity of a review finding"""
  enum Severity {
    CRITICAL
    HIGH
    MEDIUM
    LOW
    INFO
  }

  """Category of a review finding"""
  enum ReviewCategory {
    BUG
    SECURITY
    PERFORMANCE
    MAINTAINABILITY
    TEST
    STYLE
    DOCUMENTATION
    ARCHITECTURE
    OTHER
  }

  """A single review comment"""
  type ReviewComment {
    id: String!
    path: String!
    content: String!
    suggestionCode: String
    existingCode: String!
    startLine: Int!
    endLine: Int!
    thinking: String
    category: ReviewCategory!
    severity: Severity!
    filtered: Boolean!
    createdAt: DateTime!
  }

  """A complete review result"""
  type ReviewResult {
    comments: [ReviewComment!]!
    summary: String!
    stats: ReviewStats!
  }

  """Statistics for a review"""
  type ReviewStats {
    totalComments: Int!
    critical: Int!
    high: Int!
    medium: Int!
    low: Int!
    info: Int!
    filesReviewed: Int!
  }

  """Risk level for impact analysis"""
  enum RiskLevel {
    CRITICAL
    HIGH
    MEDIUM
    LOW
  }

  """Impact node in dependency tree"""
  type ImpactNode {
    symbolQname: String!
    label: String!
    filePath: String!
    impactType: String!
    depth: Int!
    children: [ImpactNode!]!
  }

  """Full impact analysis result"""
  type ImpactResult {
    changedFiles: [String!]!
    changedSymbols: [ChangedSymbol!]!
    impactTree: [ImpactNode!]!
    riskLevel: RiskLevel!
    estimatedEffort: String!
  }

  type ChangedSymbol {
    symbolQname: String!
    filePath: String!
    changeType: String!
    oldSignature: String
    newSignature: String
    startLine: Int!
    endLine: Int!
  }

  # -------------------------------------------------------------------------
  # Search Types
  # -------------------------------------------------------------------------

  """A search result from the knowledge graph"""
  type SearchResult {
    node: GraphNode!
    score: Float!
    matchedField: String!
    matchedValue: String!
  }

  """Paginated search results"""
  type SearchResultConnection {
    items: [SearchResult!]!
    pageInfo: PageInfo!
  }

  # -------------------------------------------------------------------------
  # Cross-Repo Types
  # -------------------------------------------------------------------------

  type GroupRepo {
    owner: String!
    repo: String!
    fullName: String!
    localPath: String!
    projectId: String
    role: String!
    autoIndex: Boolean!
  }

  type RepoGroup {
    id: ID!
    name: String!
    description: String!
    repos: [GroupRepo!]!
    indexedAt: DateTime
  }

  type CrossRepoCallEdge {
    sourceRepo: String!
    sourceSymbol: String!
    targetRepo: String!
    targetSymbol: String!
    resolutionType: String!
    confidence: Float!
  }

  # -------------------------------------------------------------------------
  # Stats & Health
  # -------------------------------------------------------------------------

  """Project-level statistics"""
  type ProjectStats {
    projectId: String!
    nodeCount: Int!
    edgeCount: Int!
    nodeLabelDistribution: JSON!
    edgeTypeDistribution: JSON!
    languageDistribution: JSON!
  }

  """Server health information"""
  type Health {
    status: String!
    uptime: Int!
    timestamp: DateTime!
    version: String!
    memory: MemoryInfo!
    nodeCount: Int!
    edgeCount: Int!
  }

  type MemoryInfo {
    heapUsedMB: Int!
    heapTotalMB: Int!
    rssMB: Int!
  }

  """Benchmark result"""
  type BenchmarkResult {
    suite: String!
    totalTests: Int!
    passed: Int!
    failed: Int!
    duration: Float!
    metrics: JSON!
  }

  # -------------------------------------------------------------------------
  # Queries
  # -------------------------------------------------------------------------

  type Query {
    """Get a project by ID"""
    project(id: ID!): Project

    """List all projects"""
    projects(status: ProjectStatus): [Project!]!

    """Get the knowledge graph for a project"""
    graph(
      projectId: ID!
      label: String
      limit: Int
      offset: Int
    ): NodeConnection!

    """Get edges for a project"""
    edges(
      projectId: ID!
      sourceId: Int
      targetId: Int
      type: String
      limit: Int
      offset: Int
    ): EdgeConnection!

    """Full-text search the knowledge graph"""
    searchGraph(
      projectId: ID!
      query: String!
      limit: Int
      offset: Int
    ): SearchResultConnection!

    """Review a git diff for a project"""
    reviewDiff(
      projectId: ID!
      diff: String!
      fileContext: String
    ): ReviewResult!

    """Review a pull request"""
    reviewPR(
      projectId: ID!
      prNumber: Int!
      owner: String!
      repo: String!
    ): ReviewResult!

    """Cross-repo search across all indexed projects"""
    crossRepoSearch(
      query: String!
      limit: Int
    ): SearchResultConnection!

    """Analyze the impact of a set of changed files"""
    impactAnalysis(
      projectId: ID!
      changedFiles: [String!]!
    ): ImpactResult!

    """Get statistics for a project"""
    projectStats(projectId: ID!): ProjectStats!

    """Server health check"""
    health: Health!

    """List repository groups"""
    repoGroups: [RepoGroup!]!

    """Get a repository group by ID"""
    repoGroup(id: ID!): RepoGroup
  }

  # -------------------------------------------------------------------------
  # Mutations
  # -------------------------------------------------------------------------

  type Mutation {
    """Index a project from a local path"""
    indexProject(path: String!, projectId: String, language: String): Project!

    """Delete a project and its data"""
    deleteProject(id: ID!): Boolean!

    """Run a benchmark suite for a project"""
    runBenchmark(projectId: ID!, suite: String!): BenchmarkResult!

    """Manage a repository group"""
    manageRepoGroup(
      action: String!
      groupId: String
      name: String
      description: String
      repos: JSON
    ): RepoGroup!
  }

  # -------------------------------------------------------------------------
  # Subscriptions
  # -------------------------------------------------------------------------

  type Subscription {
    """Fired when a project finishes indexing"""
    projectIndexed: Project!

    """Fired when a review completes"""
    reviewCompleted(projectId: ID): ReviewResult!

    """Fired when server health status changes"""
    healthChanged: Health!
  }
`;
