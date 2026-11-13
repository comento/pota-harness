import { createLifecycleLock, DEFAULT_LIFECYCLE_LOCK_TIMEOUT_MS } from "./pota-lifecycle-lock.mjs";
import { createTransactionJournal } from "./pota-lifecycle-transaction-journal.mjs";
import { createTransactionTargets } from "./pota-lifecycle-transaction-targets.mjs";

export { DEFAULT_LIFECYCLE_LOCK_TIMEOUT_MS };

export function createTransactionManager(context) {
  const lock = createLifecycleLock(context);
  const journal = createTransactionJournal(context);
  const targets = createTransactionTargets({ ...context, writeTransactionJournal: journal.writeTransactionJournal });
  return { ...journal, ...lock, ...targets };
}
