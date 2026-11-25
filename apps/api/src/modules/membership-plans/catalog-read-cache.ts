/** Small, process-local cache for non-personal catalog DTOs. Mutations fence old reads. */
export class CatalogReadCache {
  private readonly entries = new Map<
    string,
    { value: unknown; expiresAt: number }
  >();
  private readonly pending = new Map<string, Promise<unknown>>();
  private generation = 0;

  constructor(
    private readonly ttlMs = 15_000,
    private readonly capacity = 64,
    private readonly now: () => number = Date.now,
  ) {}

  invalidate(): void {
    this.generation++;
    this.entries.clear();
    this.pending.clear();
  }

  async get<T>(key: string, load: () => Promise<T>): Promise<T> {
    const time = this.now();
    for (const [id, entry] of this.entries) {
      if (entry.expiresAt <= time) this.entries.delete(id);
    }
    const hit = this.entries.get(key);
    if (hit) return structuredClone(hit.value) as T;
    const existing = this.pending.get(key);
    if (existing) return structuredClone(await existing) as T;

    if (this.pending.size >= this.capacity)
      return structuredClone(await load());
    const generation = this.generation;
    const request = Promise.resolve()
      .then(load)
      .then((value) => {
        if (generation === this.generation) {
          if (this.entries.size >= this.capacity) {
            const oldest = this.entries.keys().next().value;
            if (oldest !== undefined) this.entries.delete(oldest);
          }
          this.entries.set(key, {
            value: structuredClone(value),
            expiresAt: this.now() + this.ttlMs,
          });
        }
        return value;
      })
      .finally(() => {
        if (this.pending.get(key) === request) this.pending.delete(key);
      });
    this.pending.set(key, request);
    return structuredClone(await request);
  }
}
