// The constructs an ArkTS review meets: decorated structs, builder functions and state fields.

export interface CardProps {
  title: string;
  count?: number;
}

export class Counter {
  private total: number = 0;

  increment(): void {
    this.total += 1;
  }
}

export function format(value: number): string {
  return value.toString();
}

@Builder
function header(title: string) {
  Row() {
    Text(title).fontSize(18)
  }
}

@Component
export struct Card {
  @Prop title: string = '';
  @State private count: number = 0;

  build() {
    Column() {
      Text(this.title).fontSize(16)
      Button('add').onClick(() => {
        this.count += 1;
      })
    }
  }
}

@Entry
@Component
struct Index {
  @State message: string = 'hello';

  build() {
    Column() {
      Card({ title: this.message })
    }
  }
}
