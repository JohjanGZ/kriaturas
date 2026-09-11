/**
 * Reading Postgres errors that Drizzle has wrapped.
 *
 * Drizzle raises its own error and hangs the driver error off `cause`, so the
 * constraint name is NOT in `error.message`. Code that checks only the top-level
 * message silently misses every constraint violation and reports a generic
 * failure instead of the real reason — which is exactly the bug this exists to
 * prevent happening twice.
 */

/** Flattens an error and everything it wraps into one searchable string. */
export function errorChain(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;

  for (let depth = 0; current !== null && current !== undefined && depth < 5; depth += 1) {
    if (current instanceof Error) {
      parts.push(current.message);
      const constraint = (current as { constraint?: unknown }).constraint;
      if (typeof constraint === 'string') parts.push(constraint);
      const code = (current as { code?: unknown }).code;
      if (typeof code === 'string') parts.push(code);
      current = current.cause;
    } else {
      parts.push(String(current));
      break;
    }
  }

  return parts.join(' | ');
}

/** Did this error come from the named constraint? */
export function violates(error: unknown, constraint: string): boolean {
  return errorChain(error).includes(constraint);
}
