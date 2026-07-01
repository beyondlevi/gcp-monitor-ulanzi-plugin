const BASE = 'https://monitoring.googleapis.com/v3';
const CPU_METRIC = 'compute.googleapis.com/instance/cpu/utilization';
const MEM_METRIC = 'agent.googleapis.com/memory/percent_used';

const rfc3339 = (ms) => new Date(ms).toISOString();

const cpuFilter = (instanceId) =>
  `metric.type="${CPU_METRIC}" AND resource.labels.instance_id="${instanceId}"`;

const memFilter = (instanceId) =>
  `metric.type="${MEM_METRIC}" AND resource.labels.instance_id="${instanceId}" AND metric.labels.state="used"`;

const buildUrl = (projectId, filter, { startMs, endMs, alignmentPeriod = '60s', aligner = 'ALIGN_MEAN' }) => {
  const params = new URLSearchParams({
    filter,
    'interval.startTime': rfc3339(startMs),
    'interval.endTime': rfc3339(endMs),
    'aggregation.alignmentPeriod': alignmentPeriod,
    'aggregation.perSeriesAligner': aligner,
    view: 'FULL',
  });
  return `${BASE}/projects/${encodeURIComponent(projectId)}/timeSeries?${params.toString()}`;
};

const fetchTimeSeries = async (token, url) => {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
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

const latestPoint = (series) => {
  let best = null;
  for (const s of series) {
    for (const p of s.points || []) {
      const tsMs = Date.parse(p?.interval?.endTime);
      const value = p?.value?.doubleValue;
      if (Number.isFinite(tsMs) && typeof value === 'number') {
        if (!best || tsMs > best.tsMs) best = { tsMs, value };
      }
    }
  }
  return best;
};

export const getInstanceMetrics = async (
  token,
  projectId,
  instanceId,
  { windowMs = 12 * 60 * 1000, nowMs = Date.now() } = {},
) => {
  const interval = { startMs: nowMs - windowMs, endMs: nowMs };
  const [cpuSeries, memResult] = await Promise.all([
    fetchTimeSeries(token, buildUrl(projectId, cpuFilter(instanceId), interval)),
    fetchTimeSeries(token, buildUrl(projectId, memFilter(instanceId), interval)).catch((e) => ({ __error: e })),
  ]);

  const cpu = latestPoint(cpuSeries);
  const memError = memResult && memResult.__error ? memResult.__error : null;
  const mem = memError ? null : latestPoint(memResult);

  return {
    cpu: cpu ? { percent: cpu.value * 100, tsMs: cpu.tsMs } : null,
    mem: mem ? { percent: mem.value, tsMs: mem.tsMs } : null,
    memError,
  };
};
