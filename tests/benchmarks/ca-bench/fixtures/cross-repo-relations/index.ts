// CA-Bench Fixtures — Cross-Repo Relations
// Curated cross-repository dependency test cases simulating
// realistic multi-repo architectures.

import type { CrossRepoRelation } from '../../types.js';

// ---------------------------------------------------------------------------
// Cross-Repo Relations
// ---------------------------------------------------------------------------

export const CROSS_REPO_FIXTURES: CrossRepoRelation[] = [
  {
    sourceRepo: 'frontend-app',
    sourceFile: 'src/api/client.ts',
    sourceSymbol: 'ApiClient',
    targetRepo: 'backend-api',
    targetFile: 'src/routes/users.ts',
    targetSymbol: 'UserRouter',
    relationType: 'HTTP-invokes',
  },
  {
    sourceRepo: 'backend-api',
    sourceFile: 'src/services/auth.ts',
    sourceSymbol: 'AuthService',
    targetRepo: 'shared-lib',
    targetFile: 'src/crypto/jwt.ts',
    targetSymbol: 'JwtVerifier',
    relationType: 'imports',
  },
  {
    sourceRepo: 'backend-api',
    sourceFile: 'src/middleware/audit.ts',
    sourceSymbol: 'AuditMiddleware',
    targetRepo: 'analytics-service',
    targetFile: 'src/events/sink.ts',
    targetSymbol: 'EventSink',
    relationType: 'publishes-to',
  },
  {
    sourceRepo: 'mobile-app',
    sourceFile: 'src/screens/home.ts',
    sourceSymbol: 'HomeScreen',
    targetRepo: 'frontend-app',
    targetFile: 'src/components/Header.tsx',
    targetSymbol: 'Header',
    relationType: 'shares-component',
  },
  {
    sourceRepo: 'shared-lib',
    sourceFile: 'src/types/models.ts',
    sourceSymbol: 'UserModel',
    targetRepo: 'backend-api',
    targetFile: 'src/models/user.ts',
    targetSymbol: 'UserEntity',
    relationType: 'contract-defines',
  },
  {
    sourceRepo: 'infra-config',
    sourceFile: 'terraform/modules/database/main.tf',
    sourceSymbol: 'database',
    targetRepo: 'backend-api',
    targetFile: 'src/config/database.ts',
    targetSymbol: 'dbConfig',
    relationType: 'provisions-for',
  },
  {
    sourceRepo: 'backend-api',
    sourceFile: 'src/queues/orders.ts',
    sourceSymbol: 'OrderQueue',
    targetRepo: 'order-worker',
    targetFile: 'src/handlers/processOrder.ts',
    targetSymbol: 'OrderProcessor',
    relationType: 'produces-to-queue',
  },
  {
    sourceRepo: 'order-worker',
    sourceFile: 'src/handlers/processOrder.ts',
    sourceSymbol: 'OrderProcessor',
    targetRepo: 'notification-svc',
    targetFile: 'src/senders/email.ts',
    targetSymbol: 'EmailSender',
    relationType: 'calls-rest',
  },
];

// ---------------------------------------------------------------------------
// Mock Repository Metadata for the fixtures above
// ---------------------------------------------------------------------------

export interface RepoMetadata {
  name: string;
  language: string;
  description: string;
  files: string[];
}

export const REPO_METADATA: RepoMetadata[] = [
  { name: 'frontend-app', language: 'typescript', description: 'React-based frontend application', files: ['src/api/client.ts', 'src/components/Header.tsx'] },
  { name: 'backend-api', language: 'typescript', description: 'Node.js REST API service', files: ['src/routes/users.ts', 'src/services/auth.ts', 'src/middleware/audit.ts', 'src/config/database.ts', 'src/queues/orders.ts'] },
  { name: 'shared-lib', language: 'typescript', description: 'Shared utility library', files: ['src/crypto/jwt.ts', 'src/types/models.ts'] },
  { name: 'analytics-service', language: 'typescript', description: 'Event analytics pipeline', files: ['src/events/sink.ts'] },
  { name: 'mobile-app', language: 'typescript', description: 'React Native mobile app', files: ['src/screens/home.ts'] },
  { name: 'infra-config', language: 'hcl', description: 'Terraform infrastructure configuration', files: ['terraform/modules/database/main.tf'] },
  { name: 'order-worker', language: 'typescript', description: 'Order processing worker', files: ['src/handlers/processOrder.ts'] },
  { name: 'notification-svc', language: 'typescript', description: 'Notification dispatch service', files: ['src/senders/email.ts'] },
];
