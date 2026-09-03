type PendingStyleValue = string | null;

export interface StyleDeclarationTarget {
  style: {
    setProperty(property: string, value: string): void;
    removeProperty(property: string): string;
  };
}

function comparableNumber(value: string): number | null {
  const number = Number.parseFloat(value);
  return Number.isNaN(number) ? null : number;
}

export class FrameStyleWriter<T extends StyleDeclarationTarget = HTMLElement> {
  private readonly cache = new WeakMap<T, Map<string, PendingStyleValue>>();
  private readonly queue = new Map<T, Map<string, PendingStyleValue>>();

  set(element: T, property: string, value: string, epsilon = 0): void {
    const cached = this.cachedStyles(element);
    const previous = cached.get(property);
    if (previous !== undefined && previous !== null) {
      const previousNumber = comparableNumber(previous);
      const nextNumber = comparableNumber(value);
      if (
        previousNumber !== null &&
        nextNumber !== null &&
        Math.abs(previousNumber - nextNumber) <= epsilon
      ) {
        return;
      }
      if (previousNumber === null && nextNumber === null && previous === value) return;
    }

    this.enqueue(element, property, value);
    cached.set(property, value);
  }

  remove(element: T, property: string): void {
    const cached = this.cachedStyles(element);
    if (cached.get(property) === null) return;
    this.enqueue(element, property, null);
    cached.set(property, null);
  }

  setImmediate(element: T, property: string, value: string): void {
    this.dropQueuedProperty(element, property);
    element.style.setProperty(property, value);
    this.cachedStyles(element).set(property, value);
  }

  removeImmediate(element: T, property: string): void {
    this.dropQueuedProperty(element, property);
    element.style.removeProperty(property);
    this.cachedStyles(element).set(property, null);
  }

  invalidate(element: T): void {
    this.cache.delete(element);
    this.queue.delete(element);
  }

  flush(): void {
    for (const [element, properties] of this.queue) {
      for (const [property, value] of properties) {
        if (value === null) element.style.removeProperty(property);
        else element.style.setProperty(property, value);
      }
    }
    this.queue.clear();
  }

  private cachedStyles(element: T): Map<string, PendingStyleValue> {
    let styles = this.cache.get(element);
    if (!styles) {
      styles = new Map();
      this.cache.set(element, styles);
    }
    return styles;
  }

  private enqueue(element: T, property: string, value: PendingStyleValue): void {
    let styles = this.queue.get(element);
    if (!styles) {
      styles = new Map();
      this.queue.set(element, styles);
    }
    styles.set(property, value);
  }

  private dropQueuedProperty(element: T, property: string): void {
    const styles = this.queue.get(element);
    if (!styles) return;
    styles.delete(property);
    if (styles.size === 0) this.queue.delete(element);
  }
}

export const frameStyleWriter = new FrameStyleWriter();
