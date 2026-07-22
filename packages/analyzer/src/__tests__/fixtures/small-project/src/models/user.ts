// Test fixture: User model
export interface UserAddress {
  street: string;
  city: string;
  zipCode: string;
}

export class User {
  id: number;
  name: string;
  email: string;
  address?: UserAddress;

  constructor(id: number, name: string, email: string) {
    this.id = id;
    this.name = name;
    this.email = email;
  }

  getDisplayName(): string {
    return `${this.name} <${this.email}>`;
  }

  updateEmail(newEmail: string): void {
    this.email = newEmail;
  }
}

export class AdminUser extends User {
  permissions: string[];

  constructor(id: number, name: string, email: string, permissions: string[]) {
    super(id, name, email);
    this.permissions = permissions;
  }

  hasPermission(permission: string): boolean {
    return this.permissions.includes(permission);
  }
}
