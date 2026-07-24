export interface Identifiable {
  id: string;
  getName(): string;
}

export class User implements Identifiable {
  id: string;
  name: string;

  constructor(id: string, name: string) {
    this.id = id;
    this.name = name;
  }

  getName(): string {
    return this.name;
  }

  static create(name: string): User {
    return new User(Math.random().toString(36).slice(2), name);
  }
}

export class AdminUser extends User {
  permissions: string[];

  constructor(id: string, name: string, permissions: string[]) {
    super(id, name);
    this.permissions = permissions;
  }

  hasPermission(permission: string): boolean {
    return this.permissions.includes(permission);
  }
}
