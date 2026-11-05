/**
 * Keeper: keeps trust fresh. Run daily (cron / manually for the demo).
 *
 * For every source (registry commit, each vendor file):
 * - unchanged      -> extendEntity (7 days) for its entities
 * - address gone   -> do NOT extend (it expires) + Change{changeType:"removed"} (readonly)
 * - hash changed   -> new entity + Change{"modified"}; old one expires
 * - new candidate  -> Change{"newCandidate"} only; a human reviews before trusting
 * - code mismatch  -> Change{"codeHashMismatch"}; check() blocks it
 *
 * Note: Arkiv emits NO event on expiry and Rabdi has no historical queries,
 * so Change entities are the only history.
 */
async function main() {
  console.log("TODO: keeper sync");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

export {};
