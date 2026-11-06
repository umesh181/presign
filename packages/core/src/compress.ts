/**
 * gzip helpers for descriptor JSON stored in Arkiv `bytes` columns.
 * WHY: Arkiv allows 128 KiB of bytes per create; the largest registry descriptor is ~175 KB
 * raw, and gzip also cuts total write volume (gas) several times.
 * Uses the web-standard CompressionStream, available in browsers and Node 18+.
 */
async function pipe(data: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([data as BlobPart]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

export const gzip = (data: Uint8Array) => pipe(data, new CompressionStream("gzip"));
export const gunzip = (data: Uint8Array) => pipe(data, new DecompressionStream("gzip"));
