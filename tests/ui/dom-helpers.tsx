// Tiny render helpers: @testing-library/dom (peer of @testing-library/react) isn't installed, so render with react-dom.
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let roots: { root: Root; el: HTMLElement }[] = [];

export function render(ui: ReactElement) {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  act(() => root.render(ui));
  roots.push({ root, el });
  return { container: el };
}

export function cleanup() {
  for (const { root, el } of roots) {
    act(() => root.unmount());
    el.remove();
  }
  roots = [];
}

/** Innermost element whose own text equals `t` (searches the whole document, so portals count). */
export function byText(t: string): HTMLElement | null {
  const all = [...document.querySelectorAll<HTMLElement>("body *")].filter((n) => n.textContent?.trim() === t);
  return all.find((n) => ![...n.children].some((c) => c.textContent?.trim() === t)) ?? null;
}

export function button(name: string): HTMLButtonElement | null {
  return [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === name) ?? null;
}

export async function click(el: Element | null) {
  if (!el) throw new Error("click: element not found");
  await act(async () => {
    (el as HTMLElement).click();
  });
}

export async function type(el: Element | null, value: string) {
  if (!el) throw new Error("type: element not found");
  const input = el as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")?.set;
  await act(async () => {
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

export async function flush(ms = 0) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}
