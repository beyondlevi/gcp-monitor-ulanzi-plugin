const ACTION_UUID = 'com.ulanzi.ulanzistudio.gcpmonitor.machine';
const METRIC_KEYS = ['cpu', 'mem', 'disk', 'conn'];
const DEFAULT_METRICS = ['cpu', 'mem'];
const RUNNING_STATES = ['RUNNING', 'RUNNABLE'];

let form;
let els;
let metricInputs;
let saved = {};
let gotAccounts = false;
let gotProjects = false;

$UD.connect(ACTION_UUID);

$UD.onConnected(() => {
  form = q('#property-inspector');
  els = {
    account: q('#account'),
    projectId: q('#projectId'),
    resourceType: q('#resourceType'),
    instanceId: q('#instanceId'),
    instanceName: q('#instanceName'),
    instanceLabel: q('#instanceLabel'),
    zone: q('#zone'),
    clickAction: q('#clickAction'),
    refreshInterval: q('#refreshInterval'),
    downThresholdMinutes: q('#downThresholdMinutes'),
    gcloudPath: q('#gcloudPath'),
    refreshBtn: q('#refreshBtn'),
    showName: q('#showName'),
    connOpt: q('#opt_conn'),
    metricsHint: q('#metricsHint'),
    status: q('#status'),
    overlay: q('#overlay'),
  };
  metricInputs = Object.fromEntries(METRIC_KEYS.map((k) => [k, q(`#m_${k}`)]));

  document.querySelector('.uspi-wrapper').classList.remove('hidden');
  wireEvents();
  initDefaults();
  requestAccounts();
});

$UD.onAdd((jsn) => applySaved(jsn?.param));
$UD.onParamFromApp((jsn) => applySaved(jsn?.param));

$UD.onSendToPropertyInspector((jsn) => {
  const p = jsn?.payload || {};
  if (p.type === 'accounts') handleAccounts(p);
  else if (p.type === 'projects') handleProjects(p);
  else if (p.type === 'instances') handleInstances(p);
  else if (p.type === 'error') handleError(p);
});

function q(sel) {
  return document.querySelector(sel);
}

function wireEvents() {
  const debouncedSave = Utils.debounce(save, 300);
  els.refreshInterval.addEventListener('input', debouncedSave);
  els.downThresholdMinutes.addEventListener('input', debouncedSave);
  els.clickAction.addEventListener('change', save);
  els.gcloudPath.addEventListener('input', Utils.debounce(() => { save(); requestAccounts(); }, 600));

  els.account.addEventListener('change', () => {
    saved.account = els.account.value;
    resetProjectAndInstance();
    save();
    requestProjects(els.account.value);
  });

  els.projectId.addEventListener('change', () => {
    saved.projectId = els.projectId.value;
    resetInstance();
    save();
    requestInstances(els.projectId.value, currentAccount());
  });

  els.resourceType.addEventListener('change', onResourceTypeChange);

  els.instanceId.addEventListener('change', () => {
    syncInstanceHidden();
    saved.instanceId = els.instanceId.value;
    save();
  });

  METRIC_KEYS.forEach((k) => metricInputs[k].addEventListener('change', onMetricToggle));
  els.showName.addEventListener('change', onShowNameToggle);
  els.refreshBtn.addEventListener('click', requestAccounts);
}

function currentAccount() {
  return els.account.value || saved.account || undefined;
}

function currentType() {
  return els.resourceType.value === 'cloudsql' ? 'cloudsql' : 'gce';
}

function currentProject() {
  return els.projectId.value || saved.projectId || '';
}

function getGcloudPath() {
  const v = els.gcloudPath.value.trim();
  return v || undefined;
}

function maxMetrics() {
  return els.showName.checked ? 2 : 3;
}

function getSelectedMetrics() {
  const type = currentType();
  return METRIC_KEYS.filter((k) => (k !== 'conn' || type === 'cloudsql') && metricInputs[k].checked);
}

function initDefaults() {
  els.showName.checked = true;
  DEFAULT_METRICS.forEach((k) => (metricInputs[k].checked = true));
  updateResourceUI();
  updateMetricsUI();
}

function save() {
  const data = Utils.getFormValue(form);
  data.metrics = getSelectedMetrics();
  data.showName = els.showName.checked;
  $UD.sendParamFromPlugin(data);
}

function onResourceTypeChange() {
  saved.resourceType = els.resourceType.value;
  updateResourceUI();
  resetInstance();
  updateMetricsUI();
  save();
  requestInstances(currentProject(), currentAccount());
}

function onMetricToggle(e) {
  if (e.target.checked && getSelectedMetrics().length > maxMetrics()) {
    e.target.checked = false;
    setStatus(`You can show at most ${maxMetrics()} metrics`, 'warn');
  }
  updateMetricsUI();
  save();
}

function onShowNameToggle() {
  enforceMax();
  updateMetricsUI();
  save();
}

function enforceMax() {
  const extra = getSelectedMetrics().slice(maxMetrics());
  extra.forEach((k) => (metricInputs[k].checked = false));
  return extra.length > 0;
}

function updateResourceUI() {
  els.instanceLabel.textContent = currentType() === 'cloudsql' ? 'Database' : 'Instance';
}

function updateMetricsUI() {
  const connVisible = currentType() === 'cloudsql';
  els.connOpt.classList.toggle('hidden', !connVisible);
  if (!connVisible) metricInputs.conn.checked = false;

  const max = maxMetrics();
  const atMax = getSelectedMetrics().length >= max;

  METRIC_KEYS.forEach((k) => {
    const input = metricInputs[k];
    const available = k !== 'conn' || connVisible;
    const locked = available && atMax && !input.checked;
    input.disabled = !available || locked;
    input.closest('.metric-opt').classList.toggle('disabled', locked);
  });

  els.metricsHint.textContent =
    max === 2 ? 'Pick up to 2 metrics. Hide the name to show 3.' : 'Pick up to 3 metrics.';
}

function requestAccounts() {
  showOverlay();
  setStatus('Reading gcloud accounts...', 'info');
  $UD.sendToPlugin({ type: 'listAccounts', gcloudPath: getGcloudPath() });
}

function requestProjects(account) {
  showOverlay();
  setStatus('Loading projects...', 'info');
  $UD.sendToPlugin({ type: 'listProjects', account: account || currentAccount(), gcloudPath: getGcloudPath() });
}

function requestInstances(projectId, account) {
  if (!projectId) {
    fillSelect(els.instanceId, [], { placeholder: 'Select a project first' });
    return;
  }
  showOverlay();
  setStatus(currentType() === 'cloudsql' ? 'Loading databases...' : 'Loading instances...', 'info');
  $UD.sendToPlugin({
    type: 'listInstances',
    projectId,
    resourceType: currentType(),
    account: account || currentAccount(),
    gcloudPath: getGcloudPath(),
  });
}

function handleAccounts({ accounts = [] }) {
  gotAccounts = true;
  hideOverlay();

  const options = accounts.map((a) => ({ value: a.account, label: a.active ? `${a.account} (active)` : a.account }));
  const active = accounts.find((a) => a.active);
  const desired =
    saved.account && accounts.some((a) => a.account === saved.account)
      ? saved.account
      : (active && active.account) || (accounts[0] && accounts[0].account);

  fillSelect(els.account, options, { value: desired, placeholder: accounts.length ? null : 'No accounts' });

  if (!accounts.length) {
    setStatus('No gcloud accounts. Run: gcloud auth login', 'error');
    return;
  }
  setStatus(`${accounts.length} account(s) available`, 'success');
  requestProjects(desired);
}

function handleProjects({ projects = [] }) {
  gotProjects = true;
  hideOverlay();

  const options = projects.map((p) => ({
    value: p.projectId,
    label: p.name && p.name !== p.projectId ? `${p.name} - ${p.projectId}` : p.projectId,
  }));
  fillSelect(els.projectId, options, { value: saved.projectId, placeholder: 'Select project' });

  if (!projects.length) {
    setStatus('No projects for this account', 'warn');
    return;
  }
  setStatus(`${projects.length} project(s)`, 'info');

  if (saved.projectId && options.some((o) => o.value === saved.projectId)) {
    els.projectId.value = saved.projectId;
    requestInstances(saved.projectId, currentAccount());
  }
}

function handleInstances({ projectId, resourceType = 'gce', instances = [] }) {
  hideOverlay();
  if (projectId !== currentProject() || resourceType !== currentType()) return;

  const isSql = currentType() === 'cloudsql';
  const noun = isSql ? 'database' : 'instance';
  const options = instances.map((i) => {
    const running = !i.status || RUNNING_STATES.includes(i.status);
    return {
      value: i.id,
      label: running ? i.name : `${i.name} (${i.status.toLowerCase()})`,
      data: { name: i.name, zone: i.zone || '', status: i.status || '' },
    };
  });
  fillSelect(els.instanceId, options, {
    value: saved.instanceId,
    placeholder: instances.length ? `Select ${noun}` : `No ${noun}s found`,
  });
  syncInstanceHidden();

  if (instances.length) setStatus(`${instances.length} ${noun}(s) in ${projectId}`, 'info');
  else setStatus(`No ${noun}s found in ${projectId}`, 'warn');
}

function handleError({ message = '' }) {
  hideOverlay();
  let hint = message;
  if (/not found|install|no such file/i.test(message)) hint = 'gcloud not found - set its path in Advanced';
  else if (/auth|login|credential|reauth/i.test(message)) hint = 'Run: gcloud auth login';
  else if (/permission|forbidden/i.test(message)) hint = 'Permission denied on this project';
  else if (/has not been used|disabled|api/i.test(message)) hint = 'Enable the Monitoring / Compute / Cloud SQL Admin API';
  setStatus(hint, 'error');
}

function applySaved(params) {
  if (!params || typeof params !== 'object') return;
  saved = { ...saved, ...params };
  Utils.setFormValue(saved, form);

  els.showName.checked = saved.showName !== false;
  const chosen = normalizeMetrics(saved.metrics);
  const metrics = chosen.length ? chosen : DEFAULT_METRICS;
  METRIC_KEYS.forEach((k) => (metricInputs[k].checked = metrics.includes(k)));

  updateResourceUI();
  enforceMax();
  updateMetricsUI();

  if (gotAccounts && saved.account) els.account.value = saved.account;
  if (gotProjects && saved.projectId) {
    els.projectId.value = saved.projectId;
    requestInstances(saved.projectId, currentAccount());
  }
}

function normalizeMetrics(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === 'string') return value.split(',').map((s) => s.trim()).filter(Boolean);
  return [];
}

function resetProjectAndInstance() {
  saved.projectId = '';
  fillSelect(els.projectId, [], { placeholder: 'Loading...' });
  resetInstance();
}

function resetInstance() {
  saved.instanceId = '';
  els.instanceName.value = '';
  els.zone.value = '';
  fillSelect(els.instanceId, [], { placeholder: 'Select a project first' });
}

function syncInstanceHidden() {
  const opt = els.instanceId.selectedOptions && els.instanceId.selectedOptions[0];
  els.instanceName.value = (opt && opt.dataset.name) || '';
  els.zone.value = (opt && opt.dataset.zone) || '';
}

function fillSelect(sel, options, { value, placeholder } = {}) {
  sel.innerHTML = '';
  if (placeholder != null) {
    const o = document.createElement('option');
    o.value = '';
    o.textContent = placeholder;
    sel.appendChild(o);
  }
  for (const it of options) {
    const o = document.createElement('option');
    o.value = it.value;
    o.textContent = it.label;
    if (it.data) Object.keys(it.data).forEach((k) => (o.dataset[k] = it.data[k]));
    sel.appendChild(o);
  }
  if (value != null && [...sel.options].some((o) => o.value === value)) sel.value = value;
}

function setStatus(text, kind) {
  els.status.textContent = text;
  els.status.className = `tip ${kind || 'info'}`;
}

function showOverlay() {
  els.overlay.classList.remove('hidden');
}

function hideOverlay() {
  els.overlay.classList.add('hidden');
}
