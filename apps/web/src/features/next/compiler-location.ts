/** Jinrei source@ paths use Rust UTF-8 byte offsets; DOM selections use UTF-16. */
export function compilerTextOffset(source: string, path: string | null): number | null {
  const match = path?.match(/^source@(\d+)$/);
  if (!match) return null;
  const offset = Number(match[1]);
  const bytes = new TextEncoder().encode(source);
  if (!Number.isSafeInteger(offset) || offset > bytes.length) return null;
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes.slice(0, offset)).length; }
  catch { return null; }
}
