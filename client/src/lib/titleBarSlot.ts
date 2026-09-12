/**
 * The empty space in the middle of the title bar, published as a DOM node so
 * the focused conversation can render into it.
 *
 * The design puts the working directory there, but the working directory is
 * per-conversation state (`cwd`/`cwdLocked`, and the imperative `setCwd`)
 * that only `ChatPanel` has — it arrives on that tab's own socket. The
 * obvious alternative was to lift it into `App` as a map keyed by tab, the
 * way `connectedByTab` already is, and pass it down to `TitleBar`. That
 * works, but it puts a value that every mounted tab updates into the state
 * of the component that renders every mounted tab: `ChatPanel` is
 * deliberately not memoized, so each tab reporting its folder on connect
 * would re-render all of them. Collapsing the sidebar already pays that
 * cost once; there is no reason to add a second source of it, and the two
 * highest-frequency interactions in this app both run through `App`.
 *
 * A portal costs nothing instead: the state stays where it already lives,
 * `App` never learns about it, and the button is simply painted somewhere
 * else in the tree. Rendering into a node outside the tab wrapper is also
 * what keeps its dropdown positioned correctly — a tab's wrapper carries
 * `contain: layout paint`, which makes it the containing block for anything
 * positioned inside it.
 *
 * Only the focused tab may claim it. With split groups, more than one tab is
 * visible at a time, and the title bar describes the one the user is
 * actually working in.
 */
let slot: HTMLElement | null = null;
const listeners = new Set<() => void>();

/** Ref callback for the title bar's center element — React passes the node
 * on mount and `null` on unmount, which is exactly the contract here. */
export function setTitleBarSlot(node: HTMLElement | null): void {
  if (slot === node) return;
  slot = node;
  for (const listener of listeners) listener();
}

export function getTitleBarSlot(): HTMLElement | null {
  return slot;
}

export function subscribeTitleBarSlot(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
