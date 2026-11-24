// Live updates to open browsers with Server-Sent Events (GET /api/events).
//
// Each open page subscribes to channels:
//   user:<id>   everything for a signed-in user (messages, enquiries, notifications)
//   enq:<id>    one conversation, for a guest buyer holding its access key
//   public      listing changes everyone can see (price, sold…)
//
// One API server keeps the subscribers in memory. With several servers behind a load balancer,
// set REDIS_URL: events then go through Redis so every server delivers them to its own subscribers.
import { config } from '../config.js';

const subscribers = new Map(); // channel → Set<res>
let redisPub = null;
const REDIS_CHANNEL = 'autodealer:events';

function deliverLocal(channels, event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  const sent = new Set();
  channels.forEach((c) =>
    subscribers.get(c)?.forEach((res) => {
      if (sent.has(res)) return; // one copy per page even if it listens on several of the channels
      sent.add(res);
      res.write(payload);
    }),
  );
  return sent.size;
}

/**
 * Send an event to everyone listening on any of `channels`.
 * @param {string|string[]} channels e.g. ['user:u_dealer1', 'enq:e123']
 */
export function publish(channels, event, data) {
  const list = [...new Set([].concat(channels).filter(Boolean))];
  if (!list.length) return;
  if (redisPub) {
    redisPub.publish(REDIS_CHANNEL, JSON.stringify({ channels: list, event, data })).catch((e) => console.error('[realtime] redis publish failed:', e.message));
    return;
  }
  deliverLocal(list, event, data);
}

export const toUser = (id) => (id ? `user:${id}` : null);

/** Keep an SSE response open on these channels until the browser disconnects. */
export function subscribe(req, res, channels) {
  res.status(200).set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // Nginx: don't buffer the stream
  });
  res.flushHeaders?.();
  res.write(`retry: 4000\nevent: ready\ndata: ${JSON.stringify({ channels: channels.map((c) => c.split(':')[0]) })}\n\n`);
  channels.forEach((c) => {
    if (!subscribers.has(c)) subscribers.set(c, new Set());
    subscribers.get(c).add(res);
  });
  // A comment line every 25 s keeps proxies and load balancers from closing an idle connection.
  const ping = setInterval(() => res.write(': ping\n\n'), 25_000);
  req.on('close', () => {
    clearInterval(ping);
    channels.forEach((c) => {
      const set = subscribers.get(c);
      set?.delete(res);
      if (set && !set.size) subscribers.delete(c);
    });
  });
}

/** Number of open connections (shown on /api/health). */
export const connectionCount = () => new Set([...subscribers.values()].flatMap((s) => [...s])).size;

/** Connect to Redis when REDIS_URL is set (needs the optional `redis` package). */
export async function startRealtime() {
  if (!config.realtime.redisUrl) return 'memory';
  let createClient;
  try {
    ({ createClient } = await import('redis'));
  } catch {
    throw new Error('REDIS_URL is set but the "redis" package is not installed. Run: npm install redis');
  }
  const pub = createClient({ url: config.realtime.redisUrl });
  const sub = pub.duplicate();
  pub.on('error', (e) => console.error('[realtime] redis:', e.message));
  sub.on('error', (e) => console.error('[realtime] redis:', e.message));
  await Promise.all([pub.connect(), sub.connect()]);
  await sub.subscribe(REDIS_CHANNEL, (raw) => {
    try {
      const { channels, event, data } = JSON.parse(raw);
      deliverLocal(channels, event, data);
    } catch {
      /* ignore malformed */
    }
  });
  redisPub = pub;
  return 'redis';
}

/** End every open stream (on shutdown): browsers reconnect by themselves once the server is back. */
export function closeAllStreams() {
  const all = new Set([...subscribers.values()].flatMap((set) => [...set]));
  all.forEach((res) => res.end());
  subscribers.clear();
  return all.size;
}

export const realtimeStatus = () => ({ mode: redisPub ? 'redis' : 'memory', connections: connectionCount() });
