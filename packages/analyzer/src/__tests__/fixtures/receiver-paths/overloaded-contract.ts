// The generated command table: one member per Redis command, and a command with more than one arity is written as an
// overload set rather than as one signature.
export interface ContractTable {
  info(section?: string): string;
  info(section: string, callback: (error: Error | null, value: string) => void): void;
  ping(): string;
}
