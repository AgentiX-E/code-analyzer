/**
 * UserService — business logic layer that uses User and Post models.
 * Demonstrates cross-file function calls and business logic patterns.
 */
import { User, AdminUser } from '../models/user';
import { Post } from '../models/post';
import { formatEmail } from '../utils/formatting';
import { validatePassword } from './auth';

export class UserService {
  private users: Map<number, User> = new Map();

  /** Create a new user and store it */
  public createUser(id: number, name: string, email: string): User {
    const formattedEmail = formatEmail(email);
    const user = new User(id, name, formattedEmail);
    this.users.set(id, user);
    return user;
  }

  /** Create a new admin user */
  public createAdmin(
    id: number,
    name: string,
    email: string,
    permissions: string[],
  ): AdminUser {
    const admin = new AdminUser(id, name, email, permissions);
    this.users.set(id, admin);
    return admin;
  }

  /** Find a user by their ID */
  public findById(id: number): User | undefined {
    return this.users.get(id);
  }

  /** Authenticate a user with email and password hash */
  public authenticate(email: string, passwordHash: string): User | null {
    for (const user of this.users.values()) {
      if (user.email === email) {
        if (validatePassword(passwordHash)) {
          user.setPassword(passwordHash);
          return user;
        }
      }
    }
    return null;
  }

  /** Create a post for a user */
  public createPost(userId: number, title: string, content: string): Post | null {
    const user = this.findById(userId);
    if (!user) return null;

    const post = new Post(Date.now(), title, content, user);
    return post;
  }
}
