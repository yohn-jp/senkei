/** Presentation-only states. These do not establish ownership or authorization. */
export type CollectionRead<T> =
  | { readonly kind: "unconnected" | "decision-required" | "not-fetched" | "denied" }
  | { readonly kind: "failed"; readonly reason: string }
  | { readonly kind: "loaded"; readonly items: readonly T[]; readonly visible: readonly T[] };

export type CollectionView<T> = Exclude<CollectionRead<T>, { kind: "loaded" }>
  | { readonly kind: "empty" | "filtered-empty" }
  | { readonly kind: "ready"; readonly items: readonly T[] };

export function readCollection<T>(read: CollectionRead<T>): CollectionView<T> {
  if (read.kind !== "loaded") return read;
  if (read.items.length === 0) {
    if (read.visible.length !== 0) throw new Error("Visible items cannot exist in an empty collection");
    return { kind: "empty" };
  }
  if (read.visible.length === 0) return { kind: "filtered-empty" };
  return { kind: "ready", items: read.visible };
}

/** Request references and payloads are opaque. The caller owns all I/O and authority. */
export type OperationState<P, R, V> =
  | { readonly kind: "unconnected" | "decision-required" }
  | { readonly kind: "review" | "cancelled"; readonly payload: P }
  | { readonly kind: "submitted" | "unknown" | "inquiring"; readonly requestRef: R }
  | { readonly kind: "confirmed"; readonly requestRef: R; readonly result: V }
  | { readonly kind: "failed"; readonly requestRef: R };

export type OperationEvent<R, V> =
  | { readonly kind: "cancel" | "inquire" }
  | { readonly kind: "unknown" | "failed"; readonly requestRef: R }
  | { readonly kind: "submit"; readonly requestRef: R }
  | { readonly kind: "confirmed"; readonly requestRef: R; readonly result: V };

/** No command is generated. Inquiry is only a state carrying the existing reference. */
export function transition<P, R, V>(state: OperationState<P, R, V>, event: OperationEvent<R, V>, sameRequest: (a: R, b: R) => boolean): OperationState<P, R, V> {
  if (state.kind === "review" && event.kind === "cancel") return { kind: "cancelled", payload: state.payload };
  if (state.kind === "review" && event.kind === "submit") return { kind: "submitted", requestRef: event.requestRef };
  if ((state.kind === "submitted" || state.kind === "inquiring") && (event.kind === "unknown" || event.kind === "failed" || event.kind === "confirmed") && !sameRequest(state.requestRef, event.requestRef)) throw new Error("Progression response request reference mismatch");
  if ((state.kind === "submitted" || state.kind === "inquiring") && event.kind === "unknown") return { kind: "unknown", requestRef: state.requestRef };
  if (state.kind === "unknown" && event.kind === "inquire") return { kind: "inquiring", requestRef: state.requestRef };
  if ((state.kind === "submitted" || state.kind === "inquiring") && event.kind === "confirmed") return { kind: "confirmed", requestRef: state.requestRef, result: event.result };
  if ((state.kind === "submitted" || state.kind === "inquiring") && event.kind === "failed") return { kind: "failed", requestRef: state.requestRef };
  throw new Error(`Invalid progression transition: ${state.kind} → ${event.kind}`);
}
