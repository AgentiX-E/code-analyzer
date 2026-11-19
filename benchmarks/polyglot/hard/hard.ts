// The constructs a TypeScript review meets: overloads, declared modules, namespaces and const enums.

export interface Shape {
  area(): number;
}

export type Id = string;

export type { Shape as Form };

export enum Color {
  Red,
  Green,
}

export const enum Fast {
  On = 1,
  Off = 0,
}

export abstract class Base {
  abstract describe(): string;
}

export class Circle extends Base {
  constructor(private readonly radius: number) {
    super();
  }

  describe(): string {
    return `circle ${this.radius}`;
  }
}

export default class Client {
  send(): void {}
}

export namespace Util {
  export const version = 1;
}

export function parse(input: string): number;
export function parse(input: number): number;
export function parse(input: string | number): number {
  return typeof input === 'number' ? input : Number.parseInt(input, 10);
}

declare module 'legacy' {
  export const version: string;
}

export const handler: (value: number) => void = () => {};

export let cache: Map<string, number> = new Map();
