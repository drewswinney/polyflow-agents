# Host patches

Changes carried on the Hermes checkout at `hermes:~/.hermes/hermes-agent`
that are not upstream yet. Each is a `git format-patch` file, applied on the
host as a commit on a local branch so that `hermes update` (a `git pull`)
cannot drop it silently; an update that touches the same code will conflict
instead and needs the patch re-applied by hand.

| Patch | Host branch | Why |
|---|---|---|
| `0001-preflight-reasoning-estimate.patch` | `polyflow/cron-trigger-profile-home` | The preflight token estimate charged stored `reasoning` and `reasoning_content` on every assistant message, although the request build strips both for every provider except DeepSeek/Kimi/MiMo thinking mode. On the greg session (qwen3.8-27b via LiteLLM) that put the estimate at 3-4x the real prompt, so preflight compaction fired at a third of the window on every rebuilt runtime and stalled the turn for 5 to 15 minutes. Upstream `main` has since stopped double-counting `reasoning` but still charges `reasoning_content` for providers that never see it. |
| `0002-cron-trigger-profile-home.patch` | `polyflow/cron-trigger-profile-home` | `run_job` warms `SessionDB()` on a worker thread, and `SessionDB` resolves its path through `get_hermes_home()` at construction. The profile home is a ContextVar, which a bare `ThreadPoolExecutor.submit` does not inherit, so a job fired for a profile from a process whose own `HERMES_HOME` is the deployment root wrote the run's session into the root's `state.db`. That is the dashboard's trigger route, which is what the app's trigger button calls: the greg meal-plan job's triggered runs landed in `~/.hermes/state.db` while the job, its delivery and the app's agent were all greg, so the run was missing from the job's runs list and the delivery notification opened a chat the greg agent could not resolve. The turn itself was already `copy_context`-submitted and ran under the right home; only the store diverged. |

## Re-applying after a Hermes update

The patches stack, in number order, on one branch — the host can only have
one checked out, so they share it and the branch is named for the newest.

```sh
ssh hermes
cd ~/.hermes/hermes-agent
git checkout -b polyflow/cron-trigger-profile-home   # off the updated main
git am < /path/to/0001-preflight-reasoning-estimate.patch
git am < /path/to/0002-cron-trigger-profile-home.patch
venv/bin/python -m pytest -q tests/agent/test_model_metadata.py tests/run_agent/test_preflight_compression_cap_e2e.py
venv/bin/python -m pytest -q tests/cron/test_cron_profile_isolation.py tests/cron/test_sessiondb_init_hang.py
systemctl --user restart hermes-serve.service hermes-gateway-greg.service
```

Restart only when the greg session is idle: the last line in
`~/.hermes/logs/agent.log` matching `tui turn finished` should be newer than
the last `tui prompt accepted`.
