<div align="center">

<img src="docs/img/logo.png" width="112" alt="GCP Monitor logo" />

# GCP Monitor — Ulanzi Studio Plugin

**Live metrics of your Google Cloud resources — Compute Engine VMs and Cloud SQL databases — right on a key of your Ulanzi macro keypad, with a clear DOWN alert when a resource stops reporting.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
![Ulanzi Studio](https://img.shields.io/badge/Ulanzi%20Studio-%E2%89%A5%202.1.4-1EE0C6)
![Node](https://img.shields.io/badge/Node-%E2%89%A5%2020-3C873A)
![Platform](https://img.shields.io/badge/OS-Windows%20%7C%20macOS-555)

</div>

---

## Overview

**GCP Monitor** turns one key of your Ulanzi Deck (D200 / D200H / D200X and compatible keypads) into a live health tile for a single Google Cloud resource — either a **Compute Engine VM** or a **Cloud SQL database**. Each key polls Cloud Monitoring, draws the metrics you choose, and flips to a warning icon the moment the resource goes quiet.

Pick **up to 2 metrics per key**, or **3** when you hide the on-tile name (handy when you label the key with Ulanzi Studio's native Title underneath). Available metrics are **CPU, RAM and Disk** for both resource types, plus **Connections** for Cloud SQL.

Authentication reuses the `gcloud` CLI you already have installed and logged in — **no OAuth client, no service-account key, no secret is ever stored by the plugin**. You can even switch between multiple logged-in `gcloud` accounts from the key's settings.

## Preview

| Normal | High load | RAM N/A | Down | Error | Setup |
|:---:|:---:|:---:|:---:|:---:|:---:|
| <img src="docs/img/state-ok.png" width="96" /> | <img src="docs/img/state-hot.png" width="96" /> | <img src="docs/img/state-no-ram.png" width="96" /> | <img src="docs/img/state-down.png" width="96" /> | <img src="docs/img/state-error.png" width="96" /> | <img src="docs/img/state-setup.png" width="96" /> |
| CPU + RAM within limits | Gauges turn amber/red | Ops Agent not installed | No data within threshold | Auth / permission / API issue | Not configured yet |

## Features

- **Compute Engine and Cloud SQL** — monitor a VM or a database instance from the same action; the settings panel switches its pickers and metrics accordingly.
- **Choose your metrics** — show **up to 2** of CPU / RAM / Disk (+ Connections for Cloud SQL), or **up to 3** when the on-tile name is hidden.
- **Optional on-tile name** — turn it off to reclaim a row and rely on Ulanzi Studio's native Title label instead.
- **Live gauges** rendered directly on the key, refreshed on a configurable interval; percentage metrics get a color bar, counts (Connections) show the raw value.
- **DOWN alert** — if no CPU sample arrives within your threshold (default **5 min**), the key switches to a warning icon with the data age (`no data 7m`).
- **Color thresholds** — gauges shift from green to amber to red as utilization climbs, so a glance is enough.
- **Multi-account** — pick any account already authenticated in `gcloud auth list`; tokens are cached per account.
- **Cascading pickers** — Account → Project → Resource → Instance dropdowns populate automatically in the settings panel.
- **Configurable click action** — a key press either **refreshes every GCP Monitor key at once**, or **opens the resource's page** in your default browser.
- **Zero stored secrets** — access tokens come from your local `gcloud` on demand and live only in memory.
- **Cross-platform `gcloud` discovery** for Windows and macOS, with a manual path override for non-standard installs.

## How it works

```
Ulanzi Studio  ──WebSocket──▶  plugin/app.js (Node.js)
                                   │
                                   ├─ gcloud CLI ──▶ access token + account/project/instance lists
                                   └─ Cloud Monitoring API v3 ──▶ metric time series (CPU, RAM, Disk, Connections)
                                          │
                                   render.js (SVG ▶ base64) ──▶ setBaseDataIcon() ──▶ key
```

- **CPU is the health signal.** For a VM it comes from `compute.googleapis.com/instance/cpu/utilization`; for Cloud SQL from `cloudsql.googleapis.com/database/cpu/utilization`. Both are emitted server-side for every running resource, so the **absence of a fresh CPU sample is what marks the key as DOWN** — regardless of which metrics you display.
- **Metrics by resource type:**

  | Metric | Compute Engine | Cloud SQL |
  |---|---|---|
  | CPU (%) | `compute.googleapis.com/instance/cpu/utilization` | `cloudsql.googleapis.com/database/cpu/utilization` |
  | RAM (%) | `agent.googleapis.com/memory/percent_used` *(Ops Agent)* | `cloudsql.googleapis.com/database/memory/utilization` |
  | Disk (%) | `agent.googleapis.com/disk/percent_used` *(Ops Agent)* | `cloudsql.googleapis.com/database/disk/utilization` |
  | Connections | — | `cloudsql.googleapis.com/database/network/connections` |

- **Ops Agent (Compute Engine only):** RAM and Disk are produced by the [Ops Agent](https://cloud.google.com/monitoring/agent/ops-agent/install-index). If it is not installed, those metrics show `N/A` — the key is *not* marked down for that reason alone. Cloud SQL reports every metric natively, no agent required.
- **Disk on Compute Engine** reports the busiest real partition (`REDUCE_MAX` across devices) but **excludes snap `/dev/loop*` devices**, which the Ops Agent always reports at ~100% (they are read-only squashfs mounts) and would otherwise falsely pin the gauge at 100%.
- The service queries a 12-minute lookback window and keeps the most recent point per metric. "Freshness" is compared against your **Down after (min)** setting.
- Icons are generated as SVG in Node.js, base64-encoded, and pushed to the key via `setBaseDataIcon` — no image files on disk, no native image libraries.

## Requirements

- **Ulanzi Studio** ≥ 2.1.4 (Windows or macOS).
- **Google Cloud SDK (`gcloud`)** installed and authenticated on the same machine (`gcloud auth login`).
- The resource lives in **Compute Engine** or **Cloud SQL**, and you know (or can pick) its project.
- **IAM permissions** for the account you select:
  - `roles/monitoring.viewer` — read metric time series (both resource types).
  - `roles/compute.viewer` — list Compute Engine instances (to populate the dropdown).
  - `roles/cloudsql.viewer` — list Cloud SQL instances (to populate the dropdown).
- **APIs enabled** in the project:
  - Cloud Monitoring API (`monitoring.googleapis.com`)
  - Compute Engine API (`compute.googleapis.com`) — for VMs
  - Cloud SQL Admin API (`sqladmin.googleapis.com`) — for databases
- **Compute Engine RAM/Disk only:** the [Ops Agent](https://cloud.google.com/monitoring/agent/ops-agent/install-index) installed on the target VM. Cloud SQL needs no agent.

## Installation

### Option A — install the packaged plugin (recommended)

1. Download `com.ulanzi.gcpmonitor.ulanziPlugin.zip` from the [Releases](../../releases) page.
2. Unzip it and copy the `com.ulanzi.gcpmonitor.ulanziPlugin` folder into your Ulanzi Studio **plugins** directory (the same folder where your other plugins live). On Windows this is typically:
   ```
   %APPDATA%\Ulanzi\UlanziStudio\plugins\
   ```
3. Restart Ulanzi Studio. "GCP Monitor" appears in the actions list; drag **VM / Cloud SQL** onto a key.

### Option B — build from source

```bash
git clone https://github.com/beyondlevi/gcp-monitor-ulanzi-plugin.git
cd gcp-monitor-ulanzi-plugin

# Produces com.ulanzi.gcpmonitor.ulanziPlugin.zip with runtime deps bundled
./scripts/package.sh
```

Then follow steps 2–3 above with the generated zip.

> The plugin ships a small vendored copy of the official UlanziDeck JS SDK (see [Third-party](#third-party)). Its only runtime dependency is [`ws`](https://www.npmjs.com/package/ws), installed by the packaging script.

## Configuration

Select the key, then use the property inspector on the right:

| Setting | Description | Default |
|---|---|---|
| **Account** | Which `gcloud` account to use (from `gcloud auth list`). The active account is preselected. | active account |
| **Project** | GCP project that owns the resource. | — |
| **Resource** | `Compute Engine (VM)` or `Cloud SQL (database)`. Switches the instance list and available metrics. | Compute Engine |
| **Instance / Database** | The specific instance to monitor. | — |
| **Metrics** | Which metrics to draw: CPU / RAM / Disk (+ Connections for Cloud SQL). Up to 2, or 3 with the name hidden. | CPU + RAM |
| **Name on top** | Show the resource name as a header on the tile. Turn off to fit a 3rd metric and use the native Title label instead. | on |
| **Refresh (s)** | Polling interval in seconds (minimum 10). | `30` |
| **Down after (min)** | If no CPU sample is newer than this, show the DOWN icon. | `5` |
| **On click** | Key-press behavior — see [Click actions](#click-actions). | Refresh all data |
| **Advanced ▸ gcloud path** | Absolute path to the `gcloud` binary. Leave empty to auto-detect. | auto-detect |

Use **Reload lists** to re-read accounts, projects, and instances (e.g. after `gcloud auth login`).

### Click actions

- **Refresh all data** — refreshes *every* GCP Monitor key on your deck at once. Handy for an at-a-glance fleet check.
- **Open details in browser** — opens the resource's Cloud Console page in your default browser:
  ```
  # Compute Engine
  https://console.cloud.google.com/compute/instancesDetail/zones/<zone>/instances/<name>?project=<project>&tab=monitoring

  # Cloud SQL
  https://console.cloud.google.com/sql/instances/<name>/overview?project=<project>
  ```

### Multiple accounts

The plugin reads every logged-in account from `gcloud auth list`. Pick one per key, and tokens are cached separately per account (≈50 min, auto-refreshed). Different keys can watch VMs from different accounts and projects simultaneously.

## Authentication & security

- Tokens are obtained on demand via `gcloud auth print-access-token [--account=...]` and held **in memory only**.
- The plugin never stores, logs, or transmits your credentials — it delegates entirely to your local `gcloud`.
- On `401/403` the cached token for that account is invalidated and refreshed on the next poll.

## Troubleshooting

| Symptom on the key | Likely cause | Fix |
|---|---|---|
| `gcloud not found` | SDK not on PATH (common on macOS GUI apps) | Set **Advanced ▸ gcloud path**, or the `GCP_MONITOR_GCLOUD` env var, to the absolute binary path |
| `run gcloud auth login` | No/expired credentials for the account | Run `gcloud auth login`, then **Reload lists** |
| `permission denied` | Missing IAM role | Grant `roles/monitoring.viewer` (+ `roles/compute.viewer` for VMs, `roles/cloudsql.viewer` for databases) |
| `monitoring API off` | Cloud Monitoring API disabled | Enable `monitoring.googleapis.com` in the project |
| Empty **Database** list | Cloud SQL Admin API disabled or missing role | Enable `sqladmin.googleapis.com` and grant `roles/cloudsql.viewer` |
| `project not found` | Wrong project / no access | Reselect the project for the chosen account |
| RAM / Disk show `N/A` | Ops Agent not installed (Compute Engine) | Install the Ops Agent on the VM (CPU keeps working regardless); Cloud SQL needs no agent |
| Disk stuck near `100%` while the VM disk is fine | Ops Agent also reports snap `/dev/loop*` mounts at 100% | Fixed in **v1.2.1** — loop devices are excluded from the disk gauge |
| Key shows DOWN but resource is up | Threshold too tight or metrics lag | Increase **Down after (min)** |

## Development

```
com.ulanzi.gcpmonitor.ulanziPlugin/
├── manifest.json                 # Plugin & action metadata (UUIDs, paths)
├── package.json                  # Node service manifest (dep: ws)
├── en.json                       # UI localization (English)
├── plugin/
│   ├── app.js                    # Main service: SDK events, routing, refreshAll hook
│   ├── actions/MachineAction.js  # Per-key logic: polling, metric selection, state machine, click action
│   ├── gcp/gcloud.js             # gcloud discovery, auth, account/project/instance/database lists
│   ├── gcp/monitoring.js         # Cloud Monitoring API v3 queries + metric registry (GCE + Cloud SQL)
│   ├── gcp/render.js             # SVG icon rendering for every state
│   └── plugin-common-node/       # Vendored UlanziDeck SDK (Node)
├── property-inspector/machine/   # Settings UI (HTML + JS)
├── libs/                         # Vendored UlanziDeck SDK (browser side)
└── assets/icons/                 # Plugin / category / action icons
```

- **Language:** modern JavaScript (ES modules), functional and modular by design.
- **Main service:** Node.js (chosen so it can shell out to `gcloud` and render SVGs — neither is possible from an HTML-only service).
- **Repackage** after changes: `./scripts/package.sh`.
- **Live logs:** run Ulanzi Studio and inspect the Node service via the `--inspect` port declared in `manifest.json`.

## Third-party

This project bundles a copy of the official **UlanziDeck JS Plugin SDK** under `libs/` and `plugin/plugin-common-node/`. That SDK is distributed by Ulanzi under the **Apache-2.0** license and retains its original headers. All first-party code in this repository is released under the MIT license below.

## License

[MIT](LICENSE) © 2026 beyondlevi

> Not affiliated with or endorsed by Google or Ulanzi. "Google Cloud" and "Ulanzi" are trademarks of their respective owners.
