# Swarm (Arkiv + Swarm bonus)

**Not built.** We did not ship a Swarm integration during the hackathon, so we are not claiming this bonus.

What we would do with it: Arkiv holds the queryable index (chain + address → fingerprint, status, provenance) and Swarm would hold the full descriptor files, referenced from the `swarmRef` attribute that `presign.descriptor.v1` already reserves. Today the descriptor JSON is stored gzip-compressed directly on Arkiv (max 11.9 KB per entity, 2.9 MiB total), which fits within Arkiv's 128 KiB per-entity budget.
