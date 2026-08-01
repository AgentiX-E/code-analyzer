// Test fixture: Main entry point
import { User, AdminUser } from './models/user';
import { formatCurrency, capitalizeString } from './utils';

function createSampleUsers(): User[] {
  const user1 = new User(1, 'alice', 'alice@example.com');
  const user2 = new AdminUser(2, 'bob', 'bob@example.com', ['read', 'write']);

  return [user1, user2];
}

function main(): void {
  const users = createSampleUsers();

  for (const user of users) {
    const displayName = user.getDisplayName();
    const capitalized = capitalizeString(displayName);
    console.log(`User: ${capitalized}`);
  }

  const price = formatCurrency(99.99, 'USD');
  console.log(`Price: ${price}`);
}

main();
