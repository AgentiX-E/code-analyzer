import { User, AdminUser } from '../models/user';
import { Post } from '../models/post';

export class UserService {
  private users: Map<string, User> = new Map();

  createUser(name: string): User {
    const user = User.create(name);
    this.users.set(user.id, user);
    return user;
  }

  getUser(id: string): User | undefined {
    return this.users.get(id);
  }

  promoteToAdmin(userId: string, permissions: string[]): AdminUser | undefined {
    const user = this.users.get(userId);
    if (!user) return undefined;
    const admin = new AdminUser(user.id, user.getName(), permissions);
    this.users.set(admin.id, admin);
    return admin;
  }
}

export function getUserPosts(userId: string, posts: Post[]): Post[] {
  return posts.filter((p) => p.authorId === userId);
}
