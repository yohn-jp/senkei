/** Compare full JSON response trees without sorting keys or allocating strings
 * for whole replay channels. Hash canonicalization is a separate contract. */
export function sameJsonResponse(left: unknown, right: unknown): boolean {
  const leftObject = left !== null && typeof left === "object";
  const rightObject = right !== null && typeof right === "object";
  if (leftObject !== rightObject) return false;
  if (!leftObject || !rightObject) {
    if ((typeof left === "string" || typeof left === "number" || typeof left === "boolean") && left === right) return true;
    const a = JSON.stringify(left);
    const b = JSON.stringify(right);
    if (a === undefined || b === undefined) throw new Error("Response contains a non-JSON value.");
    return a === b;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    for (let index = 0; index < left.length; index++) {
      if (!Object.prototype.hasOwnProperty.call(left, index) || !Object.prototype.hasOwnProperty.call(right, index)) {
        throw new Error("Response contains a sparse JSON array.");
      }
      if (!sameJsonResponse(left[index] === undefined ? null : left[index], right[index] === undefined ? null : right[index])) return false;
    }
    return true;
  }
  const a = left as Record<string, unknown>;
  const b = right as Record<string, unknown>;
  const keys = Object.keys(a).filter(key => a[key] !== undefined);
  if (keys.length !== Object.keys(b).filter(key => b[key] !== undefined).length) return false;
  return keys.every(key => Object.prototype.hasOwnProperty.call(b, key) && sameJsonResponse(a[key], b[key]));
}
