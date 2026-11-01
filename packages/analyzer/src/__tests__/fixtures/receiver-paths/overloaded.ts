import { ContractTable } from './overloaded-contract';

class ContractBase {
  protected touch(): number {
    return 1;
  }
}

// The merge: the class declares what runs, the interface declares the table the class publishes.
interface ContractBase extends ContractTable {}

export class OverloadedClient extends ContractBase {
  ask(): void {
    this.ping();
    this.info('server');
    this.touch();
  }
}
