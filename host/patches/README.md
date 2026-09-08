# Host patches

Changes carried on the Hermes checkout at `hermes:~/.hermes/hermes-agent`
that are not upstream yet. Each is a `git format-patch` file, applied on the
host as a commit on a local branch so that `hermes update` (a `git pull`)
cannot drop it silently; an update that touches the same code will conflict
instead and needs the patch re-applied by hand.

| Patch | Host branch | Why |
|---|---|---|
| `0001-preflight-reasoning-estimate.patch` | `polyflow/preflight-reasoning-estimate` | The preflight token estimate charged stored `reasoning` and `reasoning_content` on every assistant message, although the request build strips both for every provider except DeepSeek/Kimi/MiMo thinking mode. On the greg session (qwen3.8-27b via LiteLLM) that put the estimate at 3-4x the real prompt, so preflight compaction fired at a third of the window on every rebuilt runtime and stalled the turn for 5 to 15 minutes. Upstream `main` has since stopped double-counting `reasoning` but still charges `reasoning_content` for providers that never see it. |

## Re-applying after a Hermes update

```sh
ssh hermes
cd ~/.hermes/hermes-agent
git checkout -b polyflow/preflight-reasoning-estimate   # off the updated main
git am < /path/to/0001-preflight-reasoning-estimate.patch
venv/bin/python -m pytest -q tests/agent/test_model_metadata.py tests/run_agent/test_preflight_compression_cap_e2e.py
systemctl --user restart hermes-serve.service hermes-gateway-greg.service
```

Restart only when the greg session is idle: the last line in
`~/.hermes/logs/agent.log` matching `tui turn finished` should be newer than
the last `tui prompt accepted`.
