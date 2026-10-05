# OpenWork for Cube

Install `https://github.com/collabs-inc/cube-openwork` through Cube's Add app dialog. The default `cube-app` branch pins upstream OpenWork **v0.18.56**, commit `78f8b5cb1debc5fcd36cd0eecb7cabc84da902f2`, and OpenCode **1.18.30**. The Linux app requires Node.js **22.13 or newer**, `tar`, and HTTPS access to npm and GitHub. No Docker, Electron, global package install, development server, or compilation runs during installation.

The foreground adapter serves the production OpenWork web UI and API through `127.0.0.1:$PORT`. Its supervised Node server and OpenCode engine listen only on private loopback ports. Cube provides the outer sign-in; the adapter handles OpenWork's internal authentication and same-origin routing, including streaming and WebSocket upgrades. It preserves `HOME` and the machine's provider environment, never prints credentials, and terminates its own process group on shutdown.

OpenWork uses **OpenCode**, not the Claude Code CLI. OpenWork's model picker/provider settings accept supported API keys and provider sign-ins. A pre-existing Claude Code CLI sign-in is not a guaranteed OpenWork authentication path. The UI's optional OpenWork Cloud sign-in and paid-model offers belong to upstream; the local workspace opens without that sign-in. Browser automation requires a separately available compatible browser. No paid-model inference or OAuth flow was exercised by this adapter's smoke test.

## State and runtime

- Persistent workspaces, settings, runtime database, internal gateway tokens, private OpenCode configuration, and sanitized server log: `${XDG_DATA_HOME:-$HOME/.local/share}/cube-openwork`. The initial workspace lives in `workspace/` under that directory. Added workspaces in `server.json` survive restarts and updates.
- Pinned private runtime downloads: `${XDG_CACHE_HOME:-$HOME/.cache}/cube-openwork`. OpenWork's bundled npm UI is deleted during install; only the rebuilt MIT frontend is served.
- OpenCode provider authentication and session data retain their normal user/XDG locations. The adapter does not import or copy credentials from other agent tools.
- `CUBE_OPENWORK_DATA_DIR` and `CUBE_OPENWORK_CACHE_DIR` override those two locations. `CUBE_OPENWORK_WORKSPACE` selects the initial workspace only; existing server configuration is preserved.

Downloads are verified against committed SHA-512/SHA-256 digests in `runtime-lock.json`. The frontend archive is checked against `web-ui.sha256`. Updating Cube's checkout replaces neither persistent data nor the private runtime cache. Removing the app leaves those directories intact.

## Licensing and frontend artifact

Upstream's root `LICENSE`, `ee/LICENSE`, and third-party notices remain intact. Only MIT core code runs. The optional organization task-analytics hook imported an EE schema package; this fork replaces that hook with a no-op and removes its dependency. The production frontend is rebuilt from the pinned source with a Vite guard that fails if any `/ee/` or `@openwork-ee/` module enters its graph. Neither Den nor any EE server is installed or launched. The upstream MIT server npm bundle has no EE workspace dependencies.

The approximately 6.7 MB `cube/web-ui.tgz` is a committed production artifact so installation on a small Cube machine does not need the monorepo build dependencies. To rebuild it with Node >=22.13 and pnpm 11.4.0:

```sh
pnpm --filter @openwork/app... install --frozen-lockfile --ignore-scripts
node cube/build-ui.mjs
```

This installs six MIT frontend workspace packages, builds the production UI, checks its module graph, includes the source license/provenance, and refreshes the archive digest. No credentials or development URLs are embedded in the build.

## Verification

```sh
node --test cube/proxy.test.mjs
CUBE_OPENWORK_CACHE_DIR=/tmp/cube-openwork-runtime node cube/install.mjs
CUBE_OPENWORK_CACHE_DIR=/tmp/cube-openwork-runtime node cube/smoke.mjs
CUBE_OPENWORK_CACHE_DIR=/tmp/cube-openwork-runtime CUBE_OPENWORK_SMOKE_STOP_SIGNAL=SIGHUP node cube/smoke.mjs
```

The smoke test isolates XDG state while retaining `HOME`, checks the production UI/API, persistent workspace and internal tokens across restart, and verifies that all owned processes exit. Set `CUBE_OPENWORK_PLAYWRIGHT` to a Playwright module path to also render the UI in installed Chrome. `CUBE_OPENWORK_SCREENSHOT` selects the screenshot output. Smoke tests never submit an inference request.

Local macOS arm64 validation: first startup 1.6–2.1 seconds, restart 1.3 seconds, three processes totaling 615–852 MiB RSS shortly after startup, 164 MB runtime cache plus 23 MB extracted UI. Linux binaries are pinned to the matching official release; cloud installation and Linux runtime validation are separate from this local verification.
