/**
 * habits-reporter: report "I did the thing" events to Habits (POST /ingest).
 *
 * A drop-in file with no dependencies. Copy it into an app; the master copy lives in
 * Habits/clients/habits-reporter.ts, so change it there first and copy it again.
 *
 *   const reporter = createReporter({ config: () => settings.habits() });   // null = off
 *   void reporter.report({ externalId, type, occurredAt, localDate, value, unit, meta });
 *
 * - Off until the app's settings return a URL and token: nothing is queued while off.
 * - Events wait in a queue (localStorage by default; pass `store` to use the app's own
 *   storage) and are sent in batches of up to 100: soon after a report, when the device comes
 *   back online, when the page is hidden or shown, and on a retry timer with exponential backoff.
 * - A later report with the same externalId replaces the queued one (e.g. a day's total growing).
 * - Never throws into the host app, and never blocks it.
 */

export type HabitsUnit = 'count' | 'seconds' | 'meters' | 'pages' | 'percent';

export interface HabitsEvent {
  /** Stable id from the app (session id, "<date>"…). Resending it is harmless. */
  externalId: string;
  type: string;
  /** ISO timestamp. */
  occurredAt: string;
  /** The user's local day, 'YYYY-MM-DD'. Use `localDateKey()`. */
  localDate: string;
  value?: number;
  unit?: HabitsUnit;
  meta?: Record<string, unknown>;
}

export interface ReporterConfig {
  url: string;
  token: string;
}

/** Where queued events wait. */
export interface QueueStore {
  load(): Promise<HabitsEvent[]>;
  save(events: HabitsEvent[]): Promise<void>;
}

export interface ReporterStatus {
  /** 'token' = Habits refused the token: get a new one in Habits → Sources. */
  state: 'off' | 'idle' | 'sending' | 'retrying' | 'token';
  queued: number;
}

export interface ReporterOptions {
  /** Read before every report and send, so turning reporting off takes effect at once. */
  config: () => ReporterConfig | null | Promise<ReporterConfig | null>;
  store?: QueueStore;
  onStatus?: (status: ReporterStatus) => void;
  fetch?: typeof fetch;
  /** Wait this long after a report before sending, to batch bursts. */
  sendDelayMs?: number;
  retryMinMs?: number;
  retryMaxMs?: number;
  /** Oldest events are dropped past this. */
  maxQueue?: number;
}

export interface Reporter {
  report(event: HabitsEvent): Promise<void>;
  /** Send what's queued now. */
  flush(): Promise<void>;
  stop(): void;
}

const MAX_BATCH = 100;

/** 'YYYY-MM-DD' in the device's local time zone. */
export function localDateKey(date: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function localStorageQueue(key = 'habits.queue.v1'): QueueStore {
  return {
    async load() {
      try {
        const list: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
        return Array.isArray(list) ? (list as HabitsEvent[]) : [];
      } catch {
        return [];
      }
    },
    async save(events) {
      try {
        localStorage.setItem(key, JSON.stringify(events));
      } catch {
        // Full or blocked: the queue still lives in memory for this session.
      }
    },
  };
}

export function createReporter(options: ReporterOptions): Reporter {
  const {
    config,
    store = localStorageQueue(),
    onStatus,
    sendDelayMs = 2_000,
    retryMinMs = 5_000,
    retryMaxMs = 30 * 60_000,
    maxQueue = 1_000,
  } = options;
  const doFetch = options.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));

  let queue: HabitsEvent[] | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let failures = 0;
  let sending: Promise<void> | undefined;
  let stopped = false;

  const loaded = async () => (queue ??= await store.load().catch(() => []));
  const persist = () => store.save(queue ?? []).catch(() => undefined);
  const status = (state: ReporterStatus['state']) => {
    try {
      onStatus?.({ state, queued: queue?.length ?? 0 });
    } catch {
      // The host's listener is its own business.
    }
  };
  const readConfig = async () => {
    try {
      const c = await config();
      return c?.url && c.token ? c : null;
    } catch {
      return null;
    }
  };

  function schedule(ms: number) {
    if (stopped) return;
    clearTimeout(timer);
    timer = setTimeout(() => void flush(), ms);
  }

  function retryLater(state: ReporterStatus['state']) {
    failures++;
    const backoff = Math.min(retryMaxMs, retryMinMs * 2 ** (failures - 1));
    schedule(backoff * (0.5 + Math.random() / 2));
    status(state);
  }

  async function send(): Promise<void> {
    const cfg = await readConfig();
    await loaded();
    if (!cfg) return status('off');
    while (queue?.length && !stopped) {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        return retryLater('retrying');
      }
      const batch = queue.slice(0, MAX_BATCH);
      const body = JSON.stringify({ events: batch });
      status('sending');
      let res: Response;
      try {
        res = await doFetch(cfg.url, {
          method: 'POST',
          headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
          body,
          // Lets a send started as the page closes finish; browsers cap keepalive bodies at 64 KB.
          keepalive: body.length < 60_000,
        });
      } catch {
        return retryLater('retrying');
      }
      if (res.status === 401 || res.status === 403) return retryLater('token');
      if (res.status === 408 || res.status === 429 || res.status >= 500) {
        return retryLater('retrying');
      }
      // Sent (2xx), or refused for good (other 4xx: retrying can't fix it). Either way it's done.
      // Remove the exact objects sent: a replacement queued meanwhile stays.
      queue = queue.filter((e) => !batch.includes(e));
      await persist();
      failures = 0;
    }
    status('idle');
  }

  async function flush(): Promise<void> {
    if (sending) return sending;
    clearTimeout(timer);
    sending = send()
      .catch(() => retryLater('retrying'))
      .finally(() => (sending = undefined));
    return sending;
  }

  async function report(event: HabitsEvent): Promise<void> {
    try {
      if (!(await readConfig())) return status('off');
      const events = await loaded();
      queue = [...events.filter((e) => e.externalId !== event.externalId), { ...event }];
      queue = queue.slice(-maxQueue);
      await persist();
      if (!sending) schedule(sendDelayMs);
    } catch {
      // Reporting must never break the app.
    }
  }

  const onOnline = () => void flush();
  const onVisibility = () => void flush();
  if (typeof window !== 'undefined') window.addEventListener('online', onOnline);
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);
  // Send anything left from last time.
  schedule(sendDelayMs);

  return {
    report,
    flush,
    stop() {
      stopped = true;
      clearTimeout(timer);
      if (typeof window !== 'undefined') window.removeEventListener('online', onOnline);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibility);
      }
    },
  };
}
