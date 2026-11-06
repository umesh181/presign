/**
 * Retry a READ (safe to repeat) with exponential back-off. Public RPCs and GitHub have timeouts
 * and blips; one failed request shouldn't abort a 2,000-entity import.
 * Never wrap a WRITE in this: a write that "timed out" may still have landed.
 */
export async function retry<T>(fn: () => Promise<T>, label: string, attempts = 3): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= attempts) throw e;
      const wait = 2000 * 2 ** (i - 1);
      console.warn(`  ${label} failed (${(e as Error).message.split("\n")[0]}); retry ${i}/${attempts - 1} in ${wait / 1000}s`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}
