const BASE = 'https://monitoring.googleapis.com/v3';

const METRICS = {
  gce: {
    cpu: { type: 'compute.googleapis.com/instance/cpu/utilization', aligner: 'ALIGN_MEAN', scale: 100, kind: 'percent' },
    mem: { type: 'agent.googleapis.com/memory/percent_used', aligner: 'ALIGN_MEAN', scale: 1, kind: 'percent', extra: 'metric.labels.state="used"' },
    disk: { type: 'agent.googleapis.com/disk/percent_used', aligner: 'ALIGN_MEAN', scale: 1, kind: 'percent', extra: 'metric.labels.state="used" AND metric.labels.device != monitoring.regex.full_match(".*loop.*")', reducer: 'REDUCE_MAX' },
  },
  cloudsql: {
    cpu: { type: 'cloudsql.googleapis.com/database/cpu/utilization', aligner: 'ALIGN_MEAN', scale: 100, kind: 'percent' },
    mem: { type: 'cloudsql.googleapis.com/database/memory/utilization', aligner: 'ALIGN_MEAN', scale: 100, kind: 'percent' },
    disk: { type: 'cloudsql.googleapis.com/database/disk/utilization', aligner: 'ALIGN_MEAN', scale: 100, kind: 'percent' },
    conn: { type: 'cloudsql.googleapis.com/database/network/connections', aligner: 'ALIGN_MEAN', scale: 1, kind: 'count' },
  },
};

export const METRIC_ORDER = ['cpu', 'mem', 'disk', 'conn'];
export const METRIC_LABELS = { cpu: 'CPU', mem: 'RAM', disk: 'DISK', conn: 'CONN' };
export const HEALTH_METRIC = 'cpu';

const registryFor = (type) => METRICS[type] || METRICS.gce;

export const availableMetrics = (type) => METRIC_ORDER.filter((key) => registryFor(type)[key]);
export const metricKind = (type, key) => registryFor(type)[key]?.kind || 'percent';

const rfc3339 = (ms) => new Date(ms).toISOString();

const resourceFilter = (resource) => {
  if (resource.type === 'cloudsql') {
    return `resource.type="cloudsql_database" AND resource.labels.database_id="${resource.projectId}:${resource.instanceId}"`;
  }
  return `resource.type="gce_instance" AND resource.labels.instance_id="${resource.instanceId}"`;
};

const buildUrl = (projectId, { filter, startMs, endMs, aligner, reducer }) => {
  const params = new URLSearchParams({
    filter,
    'interval.startTime': rfc3339(startMs),
    'interval.endTime': rfc3339(endMs),
    'aggregation.alignmentPeriod': '60s',
    'aggregation.perSeriesAligner': aligner,
    view: 'FULL',
  });
  if (reducer) params.set('aggregation.crossSeriesReducer', reducer);
  return `${BASE}/projects/${encodeURIComponent(projectId)}/timeSeries?${params.toString()}`;
};

const fetchTimeSeries = async (token, url) => {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
  const text = await res.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = {};
  }
  if (!res.ok) {
    const err = new Error(body?.error?.message || `HTTP ${res.status}`);
    err.status = res.status;
    err.reason = body?.error?.status;
    throw err;
  }
  return body.timeSeries || [];
};

const pointValue = (point) => {
  const v = point?.value || {};
  if (typeof v.doubleValue === 'number') return v.doubleValue;
  if (v.int64Value != null) return Number(v.int64Value);
  if (typeof v.boolValue === 'boolean') return v.boolValue ? 1 : 0;
  return null;
};

const latestPoint = (series) => {
  let best = null;
  for (const s of series) {
    for (const p of s.points || []) {
      const tsMs = Date.parse(p?.interval?.endTime);
      const value = pointValue(p);
      if (Number.isFinite(tsMs) && value != null && (!best || tsMs > best.tsMs)) best = { tsMs, value };
    }
  }
  return best;
};

const fetchMetric = async (token, resource, spec, interval) => {
  const parts = [`metric.type="${spec.type}"`, resourceFilter(resource)];
  if (spec.extra) parts.push(spec.extra);
  const url = buildUrl(resource.projectId, { filter: parts.join(' AND '), ...interval, aligner: spec.aligner, reducer: spec.reducer });
  const best = latestPoint(await fetchTimeSeries(token, url));
  if (!best) return null;
  return { value: best.value * (spec.scale || 1), tsMs: best.tsMs, kind: spec.kind };
};

export const getMetrics = async (token, resource, keys = [], { windowMs = 12 * 60 * 1000, nowMs = Date.now() } = {}) => {
  const registry = registryFor(resource.type);
  const wanted = [...new Set([HEALTH_METRIC, ...keys])].filter((key) => registry[key]);
  const interval = { startMs: nowMs - windowMs, endMs: nowMs };

  const entries = await Promise.all(
    wanted.map(async (key) => {
      try {
        return [key, await fetchMetric(token, resource, registry[key], interval)];
      } catch (error) {
        return [key, { error }];
      }
    }),
  );

  return Object.fromEntries(entries);
};
