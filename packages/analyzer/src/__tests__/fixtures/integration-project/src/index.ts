import { UserService, getUserPosts } from './services/user-service';
import { User, AdminUser } from './models/user';
import { Post } from './models/post';
import { formatEmail, slugify } from './utils/formatting';

function main() {
  const service = new UserService();
  const user = service.createUser('John Doe');
  const email = formatEmail(user.getName(), 'example.com');
  const slug = slugify('Hello World');

  const posts: Post[] = [
    new Post('1', 'First Post', 'Content here', user.id),
  ];

  const userPosts = getUserPosts(user.id, posts);

  console.log({ user: user.getName(), email, slug, postCount: userPosts.length });
}

main();
