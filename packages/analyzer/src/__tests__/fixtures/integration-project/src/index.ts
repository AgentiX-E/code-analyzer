/**
 * Main entry point for the integration test project.
 * Demonstrates top-level orchestration that ties models, services, and utils together.
 */
import { UserService } from './services/user-service';
import { validatePassword } from './services/auth';

const service = new UserService();

// Create users
const alice = service.createUser(1, 'Alice', 'Alice@Example.com');
const bob = service.createAdmin(2, 'Bob', 'bob@example.com', ['manage_users', 'view_reports']);

// Verify users
if (alice.validateEmail()) {
  service.authenticate('alice@example.com', 'securepass');
}

// Create posts
const post = service.createPost(1, 'Hello World', 'My first post!');
if (post) {
  post.addTag('intro');
  post.publish();
}

export { service, validatePassword };
