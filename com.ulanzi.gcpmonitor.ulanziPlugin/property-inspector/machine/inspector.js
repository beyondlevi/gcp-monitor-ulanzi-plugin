const ACTION_UUID = 'com.ulanzi.ulanzistudio.gcpmonitor.machine';

let form;
let els;
let saved = {};
let gotAccounts = false;
let gotProjects = false;

$UD.connect(ACTION_UUID);

$UD.onConnected(() => {
  form = document.querySelector('#property-inspector');
  els = {
    account: q('#account'),
    projectId: q('#projectId'),
    instanceId: q('#instanceId'),
    instanceName: q('#instanceName'),
    zone: q('#zone'),
    clickAction: q('#clickAction'),
    refreshInterval: q('#refreshInterval'),
    downThresholdMinutes: q('#downThresholdMinutes'),
    gcloudPath: q('#gcloudPath'),
    refreshBtn: q('#refreshBtn'),
    status: q('#status'),
    overlay: q('#overlay'),
  };

  document.querySelector('.uspi-wrapper').classList.remove('hidden');
  wireEvents();
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

  els.instanceId.addEventListener('change', () => {
    syncInstanceHidden();
    saved.instanceId = els.instanceId.value;
    save();
  });

  els.refreshBtn.addEventListener('click', requestAccounts);
}

function currentAccount() {
  return els.account.value || saved.account || undefined;
}

function getGcloudPath() {
  const v = els.gcloudPath.value.trim();
  return v || undefined;
}

function save() {
  $UD.sendParamFromPlugin(Utils.getFormValue(form));
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
  setStatus('Loading instances...', 'info');
  $UD.sendToPlugin({ type: 'listInstances', projectId, account: account || currentAccount(), gcloudPath: getGcloudPath() });
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

function handleInstances({ projectId, instances = [] }) {
  hideOverlay();
  const current = els.projectId.value || saved.projectId;
  if (projectId !== current) return;

  const options = instances.map((i) => ({
    value: i.id,
    label: i.status && i.status !== 'RUNNING' ? `${i.name} (${i.status.toLowerCase()})` : i.name,
    data: { name: i.name, zone: i.zone || '', status: i.status || '' },
  }));
  fillSelect(els.instanceId, options, {
    value: saved.instanceId,
    placeholder: instances.length ? 'Select instance' : 'No instances found',
  });
  syncInstanceHidden();

  if (instances.length) setStatus(`${instances.length} instance(s) in ${projectId}`, 'info');
  else setStatus(`No VMs found in ${projectId}`, 'warn');
}

function handleError({ message = '' }) {
  hideOverlay();
  let hint = message;
  if (/not found|install|no such file/i.test(message)) hint = 'gcloud not found - set its path in Advanced';
  else if (/auth|login|credential|reauth/i.test(message)) hint = 'Run: gcloud auth login';
  else if (/permission|forbidden/i.test(message)) hint = 'Permission denied on this project';
  else if (/has not been used|disabled|api/i.test(message)) hint = 'Enable the Monitoring/Compute API';
  setStatus(hint, 'error');
}

function applySaved(params) {
  if (!params || typeof params !== 'object') return;
  saved = { ...saved, ...params };
  Utils.setFormValue(saved, form);
  if (gotAccounts && saved.account) els.account.value = saved.account;
  if (gotProjects && saved.projectId) {
    els.projectId.value = saved.projectId;
    requestInstances(saved.projectId, currentAccount());
  }
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
