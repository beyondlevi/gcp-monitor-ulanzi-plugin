import { UlanziApi } from './plugin-common-node/index.js';
import MachineAction from './actions/MachineAction.js';
import { listProjects, listInstances, listAccounts } from './gcp/gcloud.js';

const MAIN_UUID = 'com.ulanzi.ulanzistudio.gcpmonitor';

const $UD = new UlanziApi();
const ACTIONS = {};
const hooks = {
  refreshAll: () => Object.values(ACTIONS).forEach((a) => a.refresh()),
};

$UD.connect(MAIN_UUID);
$UD.onConnected(() => {});
$UD.onError((e) => $UD.logMessage(`[gcpmonitor] socket error: ${e}`, 'warn'));
$UD.onClose(() => {});

$UD.onAdd((jsn) => {
  if (!ACTIONS[jsn.context]) ACTIONS[jsn.context] = new MachineAction(jsn.context, $UD, hooks);
  applySettings(jsn);
});

$UD.onRun((jsn) => {
  const action = ACTIONS[jsn.context];
  if (!action) return $UD.emit('add', jsn);
  action.trigger();
});

$UD.onClear((jsn) => {
  (jsn.param || []).forEach((item) => {
    ACTIONS[item.context]?.destroy();
    delete ACTIONS[item.context];
  });
});

$UD.onParamFromApp(applySettings);
$UD.onParamFromPlugin(applySettings);

function applySettings(jsn) {
  const action = ACTIONS[jsn.context];
  const settings = jsn.param || {};
  if (!action || JSON.stringify(settings) === '{}') return;
  action.update(settings);
}

$UD.onSendToPlugin(async (jsn) => {
  const msg = jsn?.payload || {};
  const ctx = jsn?.context;
  const override = msg.gcloudPath;
  const account = msg.account;

  try {
    if (msg.type === 'listAccounts') {
      const accounts = await listAccounts({ override });
      $UD.sendToPropertyInspector({ type: 'accounts', accounts }, ctx);
    } else if (msg.type === 'listProjects') {
      const projects = await listProjects({ account, override });
      $UD.sendToPropertyInspector({ type: 'projects', projects, account }, ctx);
    } else if (msg.type === 'listInstances') {
      const instances = await listInstances(msg.projectId, { account, override });
      $UD.sendToPropertyInspector({ type: 'instances', projectId: msg.projectId, instances }, ctx);
    }
  } catch (e) {
    $UD.sendToPropertyInspector({ type: 'error', op: msg.type, message: e?.message || String(e) }, ctx);
  }
});
