import { getAccessToken, invalidateToken } from '../gcp/gcloud.js';
import { getInstanceMetrics } from '../gcp/monitoring.js';
import { renderMetrics, renderDown, renderError, renderSetup, renderLoading } from '../gcp/render.js';

const DEFAULT_REFRESH_SEC = 30;
const DEFAULT_DOWN_MIN = 5;
const MIN_REFRESH_SEC = 10;

const fmtAge = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h${m % 60}m`;
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

  openConsole() {
    const { zone, instanceName, projectId } = this.settings;
    if (!zone || !instanceName || !projectId) {
      this.$UD.toast('Set project, zone and instance first');
      return;
    }
    const url = `https://console.cloud.google.com/compute/instancesDetail/zones/${encodeURIComponent(zone)}/instances/${encodeURIComponent(instanceName)}`;
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
      const { cpu, mem } = await getInstanceMetrics(token, this.settings.projectId, this.settings.instanceId);

      const thresholdMs = (Number(this.settings.downThresholdMinutes) || DEFAULT_DOWN_MIN) * 60 * 1000;
      const now = Date.now();
      const cpuFresh = cpu && now - cpu.tsMs <= thresholdMs;

      if (!cpuFresh) {
        const ageText = cpu ? `no data ${fmtAge(now - cpu.tsMs)}` : `no data >${Math.round(thresholdMs / 60000)}m`;
        this.setIcon(renderDown({ name: this.label(), ageText }));
        return;
      }

      const memPercent = mem && now - mem.tsMs <= thresholdMs ? mem.percent : NaN;
      this.setIcon(renderMetrics({ name: this.label(), cpuPercent: cpu.percent, memPercent }));
    } catch (e) {
      if (e?.status === 401 || e?.status === 403) invalidateToken(this.settings.account);
      this.$UD.showAlert(this.context);
      this.$UD.logMessage(`[gcpmonitor] refresh failed: ${e?.message || e}`, 'error');
      this.setIcon(renderError({ title: this.label(), message: shortError(e) }));
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
