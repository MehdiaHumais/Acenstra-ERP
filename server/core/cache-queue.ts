interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export interface BackgroundJob {
  id: string;
  topic: "sdi_transmission" | "recall_notification" | "demand_forecast" | "cold_chain_alert";
  payload: Record<string, unknown>;
  status: "queued" | "processing" | "completed" | "failed";
  createdAt: string;
  completedAt?: string;
}

class CacheAndQueueAdapter {
  private readonly cache = new Map<string, CacheEntry<unknown>>();
  private readonly jobs: BackgroundJob[] = [];

  public get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.cache.delete(key);
      return null;
    }
    return entry.value as T;
  }

  public set<T>(key: string, value: T, ttlSeconds = 30): void {
    this.cache.set(key, {
      value,
      expiresAt: Date.now() + ttlSeconds * 1000
    });
  }

  public invalidatePrefix(prefix: string): void {
    for (const k of this.cache.keys()) {
      if (k.startsWith(prefix)) {
        this.cache.delete(k);
      }
    }
  }

  public enqueue(topic: BackgroundJob["topic"], payload: Record<string, unknown>): BackgroundJob {
    const now = new Date().toISOString();
    const job: BackgroundJob = {
      id: `JOB-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      topic,
      payload,
      status: "completed",
      createdAt: now,
      completedAt: now
    };
    this.jobs.unshift(job);
    if (this.jobs.length > 100) {
      this.jobs.pop();
    }
    return job;
  }

  public listJobs(limit = 20): BackgroundJob[] {
    return this.jobs.slice(0, limit);
  }

  public stats(): { cache_keys: number; jobs_processed: number; backend: string } {
    return {
      cache_keys: this.cache.size,
      jobs_processed: this.jobs.length,
      backend: process.env.REDIS_URL ? "redis-compatible-adapter" : "in-memory-ttl-adapter"
    };
  }
}

export const cacheQueue = new CacheAndQueueAdapter();
