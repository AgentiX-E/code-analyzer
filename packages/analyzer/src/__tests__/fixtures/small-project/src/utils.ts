// Test fixture: Utility functions
export function formatCurrency(amount: number, currency: string = 'USD'): string {
  return `${currency} ${amount.toFixed(2)}`;
}

export function capitalizeString(input: string): string {
  if (!input) return input;
  return input.charAt(0).toUpperCase() + input.slice(1);
}

export function sumArray(numbers: number[]): number {
  return numbers.reduce((acc, val) => acc + val, 0);
}

export function isEmailValid(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}
