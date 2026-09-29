// The sink lives here, one call away from both handlers.

export function runCommand(command: string): string {
  return require('node:child_process').execSync(command).toString();
}
