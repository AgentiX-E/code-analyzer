/**
 * User model — defines the core User entity for the integration test project.
 * Contains class definition with methods, properties, and JSDoc.
 */
export class User {
  public id: number;
  public name: string;
  public email: string;
  private passwordHash: string;

  constructor(id: number, name: string, email: string) {
    this.id = id;
    this.name = name;
    this.email = email;
    this.passwordHash = '';
  }

  /** Validate the user's email address format */
  public validateEmail(): boolean {
    return this.email.includes('@') && this.email.includes('.');
  }

  /** Set a password hash for the user */
  public setPassword(hash: string): void {
    this.passwordHash = hash;
  }

  /** Check if the user is an admin */
  public isAdmin(): boolean {
    return this.id === 1;
  }
}

/**
 * Admin user — extends User with additional privileges.
 */
export class AdminUser extends User {
  public permissions: string[];

  constructor(id: number, name: string, email: string, permissions: string[]) {
    super(id, name, email);
    this.permissions = permissions;
  }

  /** Grant a new permission to the admin */
  public grantPermission(permission: string): void {
    if (!this.permissions.includes(permission)) {
      this.permissions.push(permission);
    }
  }
}
