import { getAmbientHighlighterContext } from "./context.js";
import { BlockHighlighter } from "./highlighter.js";
import type {
  BlockColour,
  BlockHighlight,
  BlockCollectionOptions,
  HighlightOptions,
  HighlightableBlock,
  PublishBlockCollection,
} from "./types.js";

declare global {
  interface Array<T> {
    toHighlightableBlocks(optionsOrLabel?: BlockCollectionOptions | string): BlockCollection<T extends HighlightableBlock ? T : any>;
    toBlockCollection(optionsOrLabel?: BlockCollectionOptions | string): BlockCollection<T extends HighlightableBlock ? T : any>;
  }
  interface ReadonlyArray<T> {
    toHighlightableBlocks(optionsOrLabel?: BlockCollectionOptions | string): BlockCollection<T extends HighlightableBlock ? T : any>;
    toBlockCollection(optionsOrLabel?: BlockCollectionOptions | string): BlockCollection<T extends HighlightableBlock ? T : any>;
  }
}

/** A list of Minecraft blocks that can accumulate and publish coloured highlight wireframes. */
export class BlockCollection<T extends HighlightableBlock = HighlightableBlock> extends Array<T> {
  label: string = "Block highlights";
  enabled: boolean = true;
  #highlighter?: BlockHighlighter;
  #publish?: PublishBlockCollection;
  #highlights = new Map<string, BlockHighlight>();
  #signal?: AbortSignal;

  constructor(...items: T[]) {
    super(...items);
  }

  static override from<T extends HighlightableBlock>(
    items: Iterable<T> | ArrayLike<T>,
    options?: BlockCollectionOptions | string,
  ): BlockCollection<T>;
  static override from<T, U extends HighlightableBlock>(
    arrayLike: ArrayLike<T> | Iterable<T>,
    mapfn: (v: T, k: number) => U,
    thisArg?: any,
  ): BlockCollection<U>;
  static override from<T extends HighlightableBlock>(
    items: Iterable<T> | ArrayLike<T>,
    arg2?: ((v: any, k: number) => any) | BlockCollectionOptions | string,
    thisArg?: any,
  ): BlockCollection<any> {
    if (typeof arg2 === "function") {
      const elements = Array.from(items, arg2, thisArg);
      return new BlockCollection(...elements);
    }
    const elements = Array.from(items);
    const collection = new BlockCollection(...elements);
    // A collection is live only while something is listening. An explicit
    // `enabled` in the options still wins, so callers can force either way.
    const ambient = getAmbientHighlighterContext();
    if (ambient?.enabled !== undefined) collection.enabled = ambient.enabled;
    if (typeof arg2 === "string") {
      collection.label = arg2;
    } else if (arg2 && typeof arg2 === "object") {
      collection.configure(arg2);
    }
    return collection;
  }

  configure(options?: BlockCollectionOptions): this {
    if (!options) return this;
    if (options.label !== undefined) this.label = options.label;
    if (options.enabled !== undefined) this.enabled = options.enabled;
    if (options.signal !== undefined) this.#signal = options.signal;
    if (options.highlighter !== undefined) this.#highlighter = options.highlighter;
    if (options.publish !== undefined) this.#publish = options.publish;
    return this;
  }

  setHighlighter(highlighter: BlockHighlighter): this {
    this.#highlighter = highlighter;
    return this;
  }

  setPublish(publish: PublishBlockCollection): this {
    this.#publish = publish;
    return this;
  }

  setSignal(signal: AbortSignal | undefined): this {
    this.#signal = signal;
    return this;
  }

  override filter<S extends T>(predicate: (value: T, index: number, array: T[]) => value is S, thisArg?: any): BlockCollection<S>;
  override filter(predicate: (value: T, index: number, array: T[]) => unknown, thisArg?: any): BlockCollection<T>;
  override filter(predicate: (value: T, index: number, array: T[]) => unknown, thisArg?: any): BlockCollection<any> {
    const result = new BlockCollection<any>(...super.filter(predicate as any, thisArg));
    result.label = this.label;
    result.enabled = this.enabled;
    result.#highlighter = this.#highlighter;
    result.#publish = this.#publish;
    result.#signal = this.#signal;
    return result;
  }

  override slice(start?: number, end?: number): BlockCollection<T> {
    const result = new BlockCollection<T>(...super.slice(start, end));
    result.label = this.label;
    result.enabled = this.enabled;
    result.#highlighter = this.#highlighter;
    result.#publish = this.#publish;
    result.#signal = this.#signal;
    return result;
  }

  /** Accumulate highlight colours on blocks without publishing immediately. */
  highlightBlocks(blocks: ReadonlyArray<HighlightableBlock>, colour: BlockColour): this;
  /** Highlight all blocks in this collection with the specified colour and publish. */
  highlightBlocks(colour: BlockColour, labelOrOptions?: string | HighlightOptions): Promise<this>;
  highlightBlocks(
    arg1: ReadonlyArray<HighlightableBlock> | BlockColour,
    arg2?: BlockColour | string | HighlightOptions,
  ): this | Promise<this> {
    if (typeof arg1 === "string") {
      return this.highlight(arg1, arg2 as string | HighlightOptions | undefined);
    }
    const blocks = arg1;
    const colour = arg2 as BlockColour;
    if (!this.enabled) return this;
    assertColour(colour);
    for (const block of blocks) {
      const position = extractPosition(block);
      const highlight = {
        x: Math.floor(position.x),
        y: Math.floor(position.y),
        z: Math.floor(position.z),
        colour,
      } as const;
      this.#highlights.set(`${highlight.x},${highlight.y},${highlight.z}`, highlight);
    }
    return this;
  }

  remove(itemsOrPredicate: ReadonlyArray<HighlightableBlock> | ((item: T) => boolean)): this {
    const toRemove = new Set<string>();
    if (typeof itemsOrPredicate === "function") {
      for (let i = this.length - 1; i >= 0; i--) {
        if (itemsOrPredicate(this[i])) {
          const pos = extractPosition(this[i]);
          toRemove.add(`${Math.floor(pos.x)},${Math.floor(pos.y)},${Math.floor(pos.z)}`);
          this.splice(i, 1);
        }
      }
    } else {
      for (const item of itemsOrPredicate) {
        const pos = extractPosition(item);
        toRemove.add(`${Math.floor(pos.x)},${Math.floor(pos.y)},${Math.floor(pos.z)}`);
      }
      for (let i = this.length - 1; i >= 0; i--) {
        const pos = extractPosition(this[i]);
        if (toRemove.has(`${Math.floor(pos.x)},${Math.floor(pos.y)},${Math.floor(pos.z)}`)) {
          this.splice(i, 1);
        }
      }
    }
    for (const key of toRemove) {
      this.#highlights.delete(key);
    }
    return this;
  }

  /** Remove highlight wireframes for specified blocks without altering the collection array. */
  removeHighlights(items: ReadonlyArray<HighlightableBlock>): this {
    if (!this.enabled) return this;
    for (const item of items) {
      const pos = extractPosition(item);
      this.#highlights.delete(`${Math.floor(pos.x)},${Math.floor(pos.y)},${Math.floor(pos.z)}`);
    }
    return this;
  }

  /** Colour every block in this collection and show it. */
  async highlight(colour: BlockColour, labelOrOptions?: string | HighlightOptions): Promise<this>;
  async highlight(
    colour: BlockColour,
    label: string,
    options?: Omit<HighlightOptions, "label">,
  ): Promise<this>;
  /** Colour the given subset and show the collection. */
  async highlight(
    items: ReadonlyArray<HighlightableBlock>,
    colour: BlockColour,
    labelOrOptions?: string | HighlightOptions,
  ): Promise<this>;
  async highlight(
    items: ReadonlyArray<HighlightableBlock>,
    colour: BlockColour,
    label: string,
    options?: Omit<HighlightOptions, "label">,
  ): Promise<this>;
  async highlight(
    arg1: BlockColour | ReadonlyArray<HighlightableBlock>,
    arg2?: string | HighlightOptions | BlockColour,
    arg3?: string | HighlightOptions | Omit<HighlightOptions, "label">,
    arg4?: Omit<HighlightOptions, "label">,
  ): Promise<this> {
    if (!this.enabled) return this;

    let itemsToHighlight: ReadonlyArray<HighlightableBlock>;
    let colour: BlockColour;
    let explicitLabel: string | undefined;
    let explicitOptions: HighlightOptions | undefined;

    if (typeof arg1 === "string") {
      this.#highlights.clear();
      itemsToHighlight = this;
      colour = arg1;
      if (typeof arg2 === "string") {
        explicitLabel = arg2;
        if (arg3 && typeof arg3 === "object") {
          explicitOptions = { ...arg3, label: explicitLabel };
        }
      } else if (arg2 && typeof arg2 === "object") {
        explicitOptions = arg2;
        if (explicitOptions.label) explicitLabel = explicitOptions.label;
      }
    } else {
      itemsToHighlight = arg1;
      colour = arg2 as BlockColour;
      if (typeof arg3 === "string") {
        explicitLabel = arg3;
        if (arg4 && typeof arg4 === "object") {
          explicitOptions = { ...arg4, label: explicitLabel };
        }
      } else if (arg3 && typeof arg3 === "object") {
        explicitOptions = arg3;
        if (explicitOptions.label) explicitLabel = explicitOptions.label;
      }
    }

    assertColour(colour);
    if (explicitLabel) this.label = explicitLabel;

    for (const block of itemsToHighlight) {
      const position = extractPosition(block);
      const highlight = {
        x: Math.floor(position.x),
        y: Math.floor(position.y),
        z: Math.floor(position.z),
        colour,
      } as const;
      this.#highlights.set(`${highlight.x},${highlight.y},${highlight.z}`, highlight);
    }

    await this.show(explicitOptions);
    return this;
  }

  /** Publish the accumulated highlights atomically. */
  /**
   * Put the accumulated highlights on screen. `highlightBlocks` colours without
   * showing, so a pass can build up its picture — accepted here, rejected
   * there — and hand the whole thing over once.
   */
  async show(labelOrOptionsOrSignal?: string | HighlightOptions | AbortSignal): Promise<void> {
    const ambient = getAmbientHighlighterContext();
    const options: HighlightOptions =
      typeof labelOrOptionsOrSignal === "string"
        ? { label: labelOrOptionsOrSignal }
        : labelOrOptionsOrSignal instanceof AbortSignal
          ? { signal: labelOrOptionsOrSignal }
          : (labelOrOptionsOrSignal ?? {});

    const abortSignal = options.signal ?? this.#signal ?? ambient?.signal;
    abortSignal?.throwIfAborted();
    if (!this.enabled) return;

    const mergedOptions: HighlightOptions = {
      label: options.label ?? this.label,
      signal: abortSignal,
      step: options.step ?? ambient?.step,
      revealIntervalMs: options.revealIntervalMs,
      lifetime: options.lifetime,
      // Held for whoever is watching, so only the caller has an opinion on it.
      holdMs: options.holdMs,
      waitUntil: options.waitUntil,
    };

    const publish = this.#publish ?? ambient?.publish;
    if (publish) {
      await publish(this, mergedOptions);
      abortSignal?.throwIfAborted();
      return;
    }

    const highlighter = this.#highlighter ?? ambient?.highlighter ?? BlockHighlighter.default;
    await highlighter.publish(this.toArray(), mergedOptions);
    abortSignal?.throwIfAborted();
  }

  /** Return the list of accumulated highlights. */
  toArray(): BlockHighlight[] {
    if (!this.enabled) return [];
    return [...this.#highlights.values()];
  }

  /** Return the list of accumulated highlights. */
  toHighlights(): BlockHighlight[] {
    return this.toArray();
  }

  /** Clear recorded highlights. */
  clearHighlights(): this {
    this.#highlights.clear();
    return this;
  }
}

if (!Array.prototype.toHighlightableBlocks) {
  Object.defineProperty(Array.prototype, "toHighlightableBlocks", {
    value: function <T extends HighlightableBlock>(
      this: T[],
      optionsOrLabel?: BlockCollectionOptions | string,
    ): BlockCollection<T> {
      return BlockCollection.from(this, optionsOrLabel);
    },
    configurable: true,
    writable: true,
  });
}

if (!Array.prototype.toBlockCollection) {
  Object.defineProperty(Array.prototype, "toBlockCollection", {
    value: function <T extends HighlightableBlock>(
      this: T[],
      optionsOrLabel?: BlockCollectionOptions | string,
    ): BlockCollection<T> {
      return BlockCollection.from(this, optionsOrLabel);
    },
    configurable: true,
    writable: true,
  });
}

/** Standalone factory helper to convert any array or iterable into a BlockCollection. */
export function blockCollection<T extends HighlightableBlock>(
  items: Iterable<T> | ArrayLike<T>,
  optionsOrLabel?: BlockCollectionOptions | string,
): BlockCollection<T> {
  return BlockCollection.from(items, optionsOrLabel);
}

function extractPosition(block: HighlightableBlock): { x: number; y: number; z: number } {
  return "position" in block ? block.position : block;
}

export function assertColour(colour: string): asserts colour is BlockColour {
  if (!/^#[0-9a-f]{6}$/i.test(colour)) {
    throw new Error(`Block highlight colour must be #RRGGBB; received ${JSON.stringify(colour)}.`);
  }
}
