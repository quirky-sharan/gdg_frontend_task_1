type AttributeValue = string | number | boolean | undefined;
type Child = Node | string | null | undefined | false;

/** Creates an element. `false`/`undefined` attributes are skipped, `true` sets an empty one. */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attributes: Readonly<Record<string, AttributeValue>> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attributes)) {
    if (value === undefined || value === false) continue;
    if (name === 'class') element.className = String(value);
    else element.setAttribute(name, value === true ? '' : String(value));
  }
  for (const child of children) {
    if (child !== null && child !== undefined && child !== false) element.append(child);
  }
  return element;
}

/** Sets text content only when it differs, avoiding needless DOM mutations. */
export function setText(element: Element, text: string): void {
  if (element.textContent !== text) element.textContent = text;
}

/** Sets (or, with `null`, removes) an attribute only when it differs. */
export function setAttr(element: Element, name: string, value: string | null): void {
  if (value === null) {
    if (element.hasAttribute(name)) element.removeAttribute(name);
  } else if (element.getAttribute(name) !== value) {
    element.setAttribute(name, value);
  }
}

/**
 * Restarts a one-shot CSS animation by alternating between `<name>-a` and `<name>-b`, two
 * classes whose keyframes are identical. Changing the animation name restarts it without
 * the forced synchronous reflow that removing and re-adding a single class would need.
 */
export function replayAnimation(element: HTMLElement, name: string): void {
  const next = element.classList.contains(`${name}-a`) ? `${name}-b` : `${name}-a`;
  element.classList.remove(`${name}-a`, `${name}-b`);
  element.classList.add(next);
}
