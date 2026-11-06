/**
 * Keeper decision logic, pure (no network) so every case is unit-tested.
 *
 * Inputs, keyed by id = "chainId:address" (lowercase):
 *  - existing: ACTIVE entities our publisher has on Arkiv (may contain duplicates after a crash)
 *  - fresh:    what the sources say right now (one row per id)
 *
 * Per id:
 *  - an existing entity has the fresh hash  -> extend it; any other active duplicates -> supersede
 *  - fresh but no matching entity           -> create; existing ones -> supersede; change "added"/"modified"
 *  - existing but not in fresh              -> mark removed now (stop trusting it); change "removed"
 */
export interface ExistingEntity {
  key: `0x${string}`;
  id: string;
  hash: string;
}

export interface FreshRow<R> {
  id: string;
  hash: string;
  row: R;
}

export type ChangeType = "added" | "modified" | "removed";

export interface PlanItem<R> {
  id: string;
  /** Entity to create (new or changed content). */
  create?: R;
  /** Active entities to retire, with the status to set. */
  retire: { key: `0x${string}`; status: "superseded" | "removed" }[];
  /** History record to write in the SAME transaction as the create/retire. */
  change?: { changeType: ChangeType; oldHash?: string; newHash?: string };
}

export interface SyncPlan<R> {
  /** Unchanged entities: only extend their expiry. */
  extend: `0x${string}`[];
  /** Atomic work items (one Arkiv batch never splits an item). */
  items: PlanItem<R>[];
}

export function planSync<R>(existing: ExistingEntity[], fresh: FreshRow<R>[]): SyncPlan<R> {
  const byId = new Map<string, ExistingEntity[]>();
  for (const e of existing) byId.set(e.id, [...(byId.get(e.id) ?? []), e]);

  const extend: `0x${string}`[] = [];
  const items: PlanItem<R>[] = [];
  const seen = new Set<string>();

  for (const f of fresh) {
    seen.add(f.id);
    const current = byId.get(f.id) ?? [];
    const match = current.find((e) => e.hash === f.hash);
    const others = current.filter((e) => e !== match);

    if (match) {
      extend.push(match.key);
      // Leftover duplicates (e.g. a crash between create and supersede): retire, no history noise.
      if (others.length) items.push({ id: f.id, retire: others.map((e) => ({ key: e.key, status: "superseded" })) });
      continue;
    }
    items.push({
      id: f.id,
      create: f.row,
      retire: others.map((e) => ({ key: e.key, status: "superseded" })),
      change: others.length
        ? { changeType: "modified", oldHash: others[0]!.hash, newHash: f.hash }
        : { changeType: "added", newHash: f.hash },
    });
  }

  for (const [id, current] of byId) {
    if (seen.has(id)) continue;
    items.push({
      id,
      retire: current.map((e) => ({ key: e.key, status: "removed" })),
      change: { changeType: "removed", oldHash: current[0]!.hash },
    });
  }

  return { extend, items };
}
