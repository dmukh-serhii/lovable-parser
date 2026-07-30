/**
 * One pipeline task at a time — the crawler and scorer share the DB and the
 * machine's browser/API budgets, so concurrent runs only hurt.
 * Module-level state is fine: pipeline routes run in the Node server process.
 */
let current: string | null = null;

export function acquireRunLock(task: string): boolean {
  if (current) return false;
  current = task;
  return true;
}

export function releaseRunLock(): void {
  current = null;
}

export function runningTask(): string | null {
  return current;
}
