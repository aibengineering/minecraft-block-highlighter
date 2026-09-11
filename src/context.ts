import { AsyncLocalStorage } from "node:async_hooks";
import type { AmbientHighlighterContext } from "./types.js";

const ambientStore = new AsyncLocalStorage<AmbientHighlighterContext>();

export function getAmbientHighlighterContext(): AmbientHighlighterContext | undefined {
  return ambientStore.getStore();
}

export function runWithHighlighter<R>(
  context: AmbientHighlighterContext,
  fn: () => R,
): R {
  return ambientStore.run(context, fn);
}
