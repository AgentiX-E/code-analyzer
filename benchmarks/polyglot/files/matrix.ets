import { helper } from './helper';

export const LIMIT: number = 10;

/** Greets a name through the helper. */
export function topLevel(name: string): string {
  let local = helper(name);
  return local;
}

export abstract class Base {
  abstract run(): void;
}

export class Widget {
  private label: string = 'x';

  constructor(label: string) {
    this.label = label;
  }

  draw(): void {
    helper(this.label);
  }
}

export interface Drawable {
  draw(): void;
}

export enum Color {
  RED,
  GREEN,
}

export type Alias = Widget;

export function identity<T>(value: T): T {
  return value;
}

export const later = async (): Promise<number> => 1;

export const anon = class Inner {
  run(): void {}
};

@Component
export struct Card {
  @State title: string = 'x';

  build() {
    Column() {
      Text(this.title)
    }
  }
}
