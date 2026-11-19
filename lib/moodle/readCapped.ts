/**
 * Read a response body up to a byte cap, and stop reading (cancelling the
 * rest of the download) the moment it passes the cap, instead of buffering a
 * whole large file only to throw it away. Pure: no imports, so `node --test`
 * covers it with a plain `new Response(...)`.
 *
 * Returns null when the declared content-length is over the cap (nothing is
 * read), when the body passes the cap, or when reading fails (an abort included).
 */
export async function readCapped(r: Response, maxBytes: number): Promise<Buffer | null> {
  const declared = Number(r.headers.get("content-length") || 0);
  if (declared && declared > maxBytes) {
    await r.body?.cancel().catch(() => {});
    return null;
  }
  if (!r.body) return Buffer.alloc(0);
  const reader = r.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  }
  return Buffer.concat(chunks, total);
}
