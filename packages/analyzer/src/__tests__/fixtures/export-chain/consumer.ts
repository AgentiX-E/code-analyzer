// Two spellings of the same question, both asked of a barrel two files deep.
//
// `api.leafRun()` is the namespace form and `leafRun()` the named one; neither file that sits between this one and the
// declaration holds the declaration. `api.leafMissing()` names nothing any of them publishes, and it must stay
// unanswered: the barrel is not a licence to answer with whatever the file at the end of the chain happens to declare.

import * as api from './barrel-two';
import { leafRun } from './barrel-two';

export function viaNamespace(): number {
  return api.leafRun();
}

export function viaImport(): number {
  return leafRun();
}

export function viaAbsentName(): number {
  return api.leafIdleMissing();
}
