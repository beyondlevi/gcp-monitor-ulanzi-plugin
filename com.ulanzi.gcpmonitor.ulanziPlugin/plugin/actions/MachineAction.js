import { getAccessToken, invalidateToken } from '../gcp/gcloud.js';
import { getMetrics, availableMetrics, metricKind, METRIC_LABELS, HEALTH_METRIC } from '../gcp/monitoring.js';
import { renderMetrics, renderDown, renderError, renderSetup, renderLoading } from '../gcp/render.js';

const DEFAULT_REFRESH_SEC = 30;
const DEFAULT_DOWN_MIN = 5;
const MIN_REFRESH_SEC = 10;
const DEFAULT_METRICS = ['cpu', 'mem'];

const fmtAge = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h${m % 60}m`;
};

const normalizeMetrics = (value) => {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === 'string') return value.split(',').map((s) => s.trim()).filter(Boolean);
  return [];
};

const shortError = (e) => {
  const msg = String(e?.message || e || '').toLowerCase();
  if (msg.includes('not found') && msg.includes('gcloud')) return 'gcloud not found';
  if (msg.includes('print-access-token') || msg.includes('auth login') || msg.includes('empty access token')) return 'run gcloud auth login';
  if (e?.status === 401 || msg.includes('unauthenticated')) return 'auth expired';
  if (e?.status === 403 || msg.includes('permission')) return 'permission denied';
  if (msg.includes('has not been used') || msg.includes('service_disabled') || msg.includes('disabled')) return 'monitoring API off';
  if (e?.status === 404 || msg.includes('was not found')) return 'project not found';
  return String(e?.message || 'unknown error').slice(0, 40);
};

export default class MachineAction {
  constructor(context, ud, hooks = {}) {
    this.context = context;
    this.$UD = ud;
    this.hooks = hooks;
    this.settings = {};
    this.timer = null;
    this.busy = false;
    this.setIcon(renderLoading());
  }

  update(settings) {
    this.settings = { ...this.settings, ...settings };
    this.restart();
  }

  trigger() {
    if (this.settings.clickAction === 'open') return this.openConsole();
    if (typeof this.hooks.refreshAll === 'function') return this.hooks.refreshAll();
    this.refresh();
  }

  resourceType() {
    return this.settings.resourceType === 'cloudsql' ? 'cloudsql' : 'gce';
  }

  resource() {
    return { type: this.resourceType(), projectId: this.settings.projectId, instanceId: this.settings.instanceId };
  }

  showName() {
    return this.settings.showName !== false;
  }

  metrics() {
    const available = availableMetrics(this.resourceType());
    const chosen = normalizeMetrics(this.settings.metrics).filter((m) => available.includes(m));
    const list = chosen.length ? chosen : DEFAULT_METRICS.filter((m) => available.includes(m));
    return list.slice(0, this.showName() ? 2 : 3);
  }

  openConsole() {
    const { zone, instanceName, projectId, instanceId } = this.settings;
    const name = instanceName || instanceId;
    if (!projectId || !name) {
      this.$UD.toast('Set project and instance first');
      return;
    }
    if (this.resourceType() === 'cloudsql') {
      const url = `https://console.cloud.google.com/sql/instances/${encodeURIComponent(name)}/overview`;
      this.$UD.openUrl(url, false, { project: projectId });
      return;
    }
    if (!zone) {
      this.$UD.toast('Set project, zone and instance first');
      return;
    }
    const url = `https://console.cloud.google.com/compute/instancesDetail/zones/${encodeURIComponent(zone)}/instances/${encodeURIComponent(name)}`;
    this.$UD.openUrl(url, false, { project: projectId, tab: 'monitoring' });
  }

  isConfigured() {
    return Boolean(this.settings.projectId && this.settings.instanceId);
  }

  label() {
    return this.settings.instanceName || this.settings.instanceId || 'instance';
  }

  restart() {
    this.stop();
    if (!this.isConfigured()) {
      this.setIcon(renderSetup());
      return;
    }
    this.refresh();
    const sec = Math.max(MIN_REFRESH_SEC, Number(this.settings.refreshInterval) || DEFAULT_REFRESH_SEC);
    this.timer = setInterval(() => this.refresh(), sec * 1000);
  }

  async refresh() {
    if (this.busy || !this.isConfigured()) return;
    this.busy = true;
    try {
      const token = await getAccessToken({ account: this.settings.account, override: this.settings.gcloudPath });
      const type = this.resourceType();
      const keys = this.metrics();
      const results = await getMetrics(token, this.resource(), keys);

      const health = results[HEALTH_METRIC];
      if (health?.error) throw health.error;

      const thresholdMs = (Number(this.settings.downThresholdMinutes) || DEFAULT_DOWN_MIN) * 60 * 1000;
      const now = Date.now();
      const healthFresh = health && now - health.tsMs <= thresholdMs;

      if (!healthFresh) {
        const ageText = health ? `no data ${fmtAge(now - health.tsMs)}` : `no data >${Math.round(thresholdMs / 60000)}m`;
        this.setIcon(renderDown({ name: this.label(), ageText, showName: this.showName() }));
        return;
      }

      const rows = keys.map((key) => {
        const r = results[key];
        const fresh = r && !r.error && Number.isFinite(r.value) && now - r.tsMs <= thresholdMs;
        return {
          label: METRIC_LABELS[key] || key.toUpperCase(),
          kind: metricKind(type, key),
          value: fresh ? r.value : NaN,
          stale: !fresh,
        };
      });

      this.setIcon(renderMetrics({ name: this.label(), showName: this.showName(), rows }));
    } catch (e) {
      if (e?.status === 401 || e?.status === 403) invalidateToken(this.settings.account);
      this.$UD.showAlert(this.context);
      this.$UD.logMessage(`[gcpmonitor] refresh failed: ${e?.message || e}`, 'error');
      this.setIcon(renderError({ title: this.label(), message: shortError(e), showName: this.showName() }));
    } finally {
      this.busy = false;
    }
  }

  setIcon(uri) {
    this.$UD.setBaseDataIcon(this.context, uri);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  destroy() {
    this.stop();
  }
}
