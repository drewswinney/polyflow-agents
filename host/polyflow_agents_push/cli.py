"""`polyflow_agents_push` — put this package where Hermes looks for plugins.

pip is the transport; it is not the discovery mechanism. Hermes does support
entry-point plugins (`hermes_agent.plugins`), and using them would make
`pip install` sufficient on its own — but only for two of this plugin's three
faces. `_discover_dashboard_plugins()` in `hermes_cli/web_server.py` scans
*directories*:

    ~/.hermes/plugins/<name>/dashboard/manifest.json

and nothing else. There is no entry-point path to a mounted backend route, and
the backend route is where devices register. So this command links the
installed package into `~/.hermes/plugins/`, and the entry point is deliberately
**not** declared: a plugin discovered twice registers its hooks twice, and every
notification arrives twice with it.

A symlink rather than a copy, by default, so `pip install -U` is the whole
upgrade. `--copy` is there for hosts where the plugin directory and
site-packages are not on the same filesystem, or where a symlink into a venv is
a lifetime someone would rather not depend on.

**Profiles are not optional here, and that is the hard-won part.** Hermes caches
one plugin manager *per resolved Hermes home* (`hermes_cli/plugins.py`:
"a profile switch — via HERMES_HOME or the context-local
`set_hermes_home_override()` — gets its own manager with its own plugin
submodules"), and `hermes serve` runs every turn under a profile override
(`tui_gateway/compute_host.py`). A plugin installed only in the default home is
therefore registered into a manager that profile turns never consult: hooks fire
into an empty list and return. Nothing errors. Routes still mount, devices still
register, `register()` still runs, `status` still said "installed, enabled" —
and not one notification is ever sent. That is why install and status below walk
every profile rather than the active home alone.
"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Optional

# The name Hermes knows this plugin by. It is the `name` in both manifests, the
# directory this links to, and — because the web server mounts routers under
# `plugin['name']` — half of every route path. That is why it is a constant:
# what the app's `PUSH_ROUTE` is built from (`/api/plugins/polyflow_agents_push/...`)
# and what `hermes plugins enable` expects.
PLUGIN_NAME = "polyflow_agents_push"

PACKAGE_ROOT = Path(__file__).resolve().parent

# Where Hermes keeps additional homes. Each is a full home — its own config.yaml,
# state.db, plugins/ — and its own plugin manager.
PROFILES_DIRNAME = "profiles"


def hermes_home() -> Path:
    """The active Hermes home, asked of Hermes rather than guessed."""
    try:
        from hermes_constants import get_hermes_home

        return Path(get_hermes_home())
    except Exception:
        return Path(os.environ.get("HERMES_HOME", Path.home() / ".hermes"))


def plugin_dir(home: Optional[Path] = None) -> Path:
    return (home or hermes_home()) / "plugins" / PLUGIN_NAME


def profile_homes(root: Optional[Path] = None) -> list[Path]:
    """Every profile home under the active one, sorted.

    A directory counts as a home when it carries a `config.yaml` or a
    `state.db` — the two things a real profile always has. Guessing from the
    directory name alone would sweep in whatever else lives there.
    """
    profiles = (root or hermes_home()) / PROFILES_DIRNAME

    if not profiles.is_dir():
        return []

    found = [
        entry
        for entry in sorted(profiles.iterdir())
        if entry.is_dir() and ((entry / "config.yaml").exists() or (entry / "state.db").exists())
    ]

    return found


def _enabled(home: Optional[Path] = None) -> Optional[bool]:
    """Whether this home's allow-list carries us. ``None`` when it cannot be read.

    Three-valued on purpose. The first draft returned a bool and reported an
    *unreadable* allow-list as "not enabled" — which is exactly wrong under the
    install this README recommends: `uv tool install` puts this command in an
    isolated environment where `hermes_cli` is not importable, so the check
    always failed and `status` always said "no" about a plugin Hermes had
    already loaded. A check that cannot run must not answer.

    Hermes's own loader is asked first only for the *active* home — it reads
    Hermes's live state, which is scoped to that home and cannot answer for a
    profile. Every other home is read from its `config.yaml`, and a missing
    YAML parser is the third case: this package has no dependencies, and
    inventing an answer is worse than admitting there is none.
    """
    if home is None or home == hermes_home():
        try:
            from hermes_cli.plugins_cmd import _get_enabled_set

            return PLUGIN_NAME in _get_enabled_set()
        except Exception:
            pass

    config = (home or hermes_home()) / "config.yaml"

    try:
        import yaml
    except ImportError:
        return None

    if not config.exists():
        return None

    try:
        with config.open(encoding="utf-8") as handle:
            data = yaml.safe_load(handle) or {}
    except Exception:
        return None

    # Past here the file was read and parsed, so absence is an answer rather
    # than a gap in one. A config with no `plugins:` section, or none with an
    # `enabled:` list, does not carry us — and saying "unknown" there would
    # hedge on exactly the case this command exists to catch: the profile whose
    # turns fire nothing because its allow-list never named this plugin.
    plugins = data.get("plugins")

    if not isinstance(plugins, dict):
        return False

    enabled = plugins.get("enabled")

    if not isinstance(enabled, list):
        return False

    return PLUGIN_NAME in enabled


# `None` is "could not check", which is not the same as "no" and must not read
# like it: the difference is whether someone goes looking for a missing install
# step or for a broken check.
_ENABLED_LABEL = {True: "yes", False: "no", None: "unknown (could not read the allow-list)"}


def _install_state(target: Path) -> str:
    if target.is_symlink():
        return f"linked -> {os.readlink(target)}"

    if target.is_dir():
        return "copied"

    return "not installed"


def _status_lines() -> list[str]:
    target = plugin_dir()
    lines = [f"package:   {PACKAGE_ROOT}", f"installed: {target}"]

    if not target.exists() and not target.is_symlink():
        lines.append("state:     not installed")

        return lines

    lines.append(f"state:     {_install_state(target)}")

    for probe in ("plugin.yaml", "dashboard/manifest.json", "dashboard/plugin_api.py"):
        lines.append(f"  {'ok  ' if (target / probe).exists() else 'MISSING'} {probe}")

    return lines


def _profile_status_lines() -> list[str]:
    """Per-profile install state, and what it costs when it is missing.

    The whole reason this exists: "installed and enabled" in the default home
    tells you nothing about whether the agent you actually talk to fires hooks.
    A profile that runs turns and has no plugin is silent, not broken, so it has
    to be *said*.
    """
    profiles = profile_homes()

    if not profiles:
        return ["profiles:  none found"]

    lines = ["", "profiles:"]
    incomplete = []

    for home in profiles:
        target = plugin_dir(home)
        state = _install_state(target)
        enabled = _enabled(home)
        ok = state != "not installed" and enabled is not False

        lines.append(f"  {'ok  ' if ok else 'GAP '} {home.name}")
        lines.append(f"         install: {state}")
        lines.append(f"         enabled: {_ENABLED_LABEL[enabled]}")

        if not ok:
            incomplete.append(home.name)

    if incomplete:
        lines.append("")
        lines.append(f"Turns on {', '.join(incomplete)} fire NO hooks.")
        lines.append(
            "Hermes keeps one plugin manager per home, so a profile that lacks this\n"
            "plugin dispatches into an empty hook list and returns — no error, no\n"
            "log, no notification, and every other face still looks healthy.\n"
            "\n"
            "  polyflow_agents_push install --force --enable"
        )

    return lines


def _enable_in(home: Path) -> bool:
    """Run Hermes's own enable against one home. False when it could not."""
    env = dict(os.environ)
    env["HERMES_HOME"] = str(home)

    try:
        result = subprocess.run(
            ["hermes", "plugins", "enable", PLUGIN_NAME],
            capture_output=True,
            text=True,
            env=env,
        )
    except FileNotFoundError:
        return False

    return result.returncode == 0


def _place(target: Path, *, copy: bool, force: bool, link_to: Path) -> Optional[str]:
    """Put the plugin at ``target``. Returns an error string, or None on success."""
    if target.exists() or target.is_symlink():
        if not force:
            return f"{target} already exists. Re-run with --force to replace it."

        if target.is_symlink() or target.is_file():
            target.unlink()
        else:
            shutil.rmtree(target)

    target.parent.mkdir(parents=True, exist_ok=True)

    if copy:
        # `dashboard/` has to come along — without it the hooks load and
        # registration 404s, which is the confusing half-working state.
        shutil.copytree(
            link_to,
            target,
            ignore=shutil.ignore_patterns("__pycache__", "*.pyc", "cli.py"),
        )
    else:
        target.symlink_to(link_to, target_is_directory=True)

    return None


def install(*, copy: bool, force: bool, enable: bool, profiles: bool) -> int:
    target = plugin_dir()
    error = _place(target, copy=copy, force=force, link_to=PACKAGE_ROOT)

    if error:
        print(error, file=sys.stderr)

        return 1

    print(f"Installed {PLUGIN_NAME} -> {target}")

    if enable:
        if _enable_in(hermes_home()):
            print(f"Enabled {PLUGIN_NAME}.")
        else:
            print(
                f"Could not enable automatically (hermes CLI not found or refused).\n"
                f"Run: hermes plugins enable {PLUGIN_NAME}",
                file=sys.stderr,
            )
    elif _enabled() is False:
        # Worth stating rather than leaving to be discovered: an installed but
        # un-enabled plugin's Python is never imported, so every face is silently
        # absent (GHSA-mcfc-hp25-cjv7).
        print(f"\nNot enabled yet. Run:\n  hermes plugins enable {PLUGIN_NAME}")

    if profiles:
        _install_into_profiles(copy=copy, force=force, enable=enable, default_target=target)

    print(
        "\nThen restart the processes that load plugins:\n"
        "  hermes serve      hooks AND the registration routes, which mount at import\n"
        "  hermes gateway    the platform face (cron delivery only)\n"
        "\n`/api/dashboard/plugins/rescan` reloads plugin JS/CSS, but backend\n"
        "routes mount at module import — a new one needs the restart."
    )

    return 0


def _install_into_profiles(*, copy: bool, force: bool, enable: bool, default_target: Path) -> None:
    """Install into every profile home, because turns run under those.

    Linked to the default home's install rather than to `PACKAGE_ROOT`, so one
    `pip install -U` — or one `deploy-plugin.sh` — still updates every profile
    at once. Under `--copy` each profile gets its own copy, which is the point
    of asking for copies.
    """
    homes = profile_homes()

    if not homes:
        return

    print()

    for home in homes:
        target = plugin_dir(home)
        error = _place(target, copy=copy, force=force, link_to=default_target)

        if error:
            print(f"  skip {home.name}: {error}", file=sys.stderr)

            continue

        print(f"  installed -> {target}")

        if not enable:
            continue

        if _enable_in(home):
            print(f"  enabled in profile {home.name}")
        else:
            # Naming the file matters: `hermes plugins enable` acts on the
            # active home, so the obvious command silently edits the wrong one.
            print(
                f"  could not enable in profile {home.name}. Add to "
                f"{home / 'config.yaml'}:\n"
                f"    plugins:\n      enabled:\n        - {PLUGIN_NAME}",
                file=sys.stderr,
            )


def uninstall(*, profiles: bool) -> int:
    targets = [plugin_dir()]

    if profiles:
        # Profiles first: they link *to* the default install, so removing that
        # one first would leave every profile pointing at nothing.
        targets = [plugin_dir(home) for home in profile_homes()] + targets

    removed = 0

    for target in targets:
        if not target.exists() and not target.is_symlink():
            continue

        if target.is_symlink() or target.is_file():
            target.unlink()
        else:
            shutil.rmtree(target)

        print(f"Removed {target}")
        removed += 1

    if not removed:
        print(f"{PLUGIN_NAME} is not installed.")

        return 0

    print("Registered devices survive in the registry; run with a fresh install to reuse them.")

    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="polyflow_agents_push", description=__doc__.split("\n")[0])
    sub = parser.add_subparsers(dest="command", required=True)

    p_install = sub.add_parser("install", help="link this package into ~/.hermes/plugins/")
    p_install.add_argument("--copy", action="store_true", help="copy instead of symlinking")
    p_install.add_argument("--force", action="store_true", help="replace an existing install")
    p_install.add_argument("--enable", action="store_true", help="also run `hermes plugins enable`")
    p_install.add_argument(
        "--no-profiles",
        action="store_true",
        help="skip profile homes (turns running under a profile will fire no hooks)",
    )

    p_uninstall = sub.add_parser("uninstall", help="remove it from ~/.hermes/plugins/")
    p_uninstall.add_argument(
        "--no-profiles", action="store_true", help="leave profile installs in place"
    )

    sub.add_parser("status", help="where it is installed, per profile, and whether it is enabled")

    args = parser.parse_args(argv)

    if args.command == "install":
        return install(
            copy=args.copy,
            force=args.force,
            enable=args.enable,
            profiles=not args.no_profiles,
        )

    if args.command == "uninstall":
        return uninstall(profiles=not args.no_profiles)

    for line in _status_lines():
        print(line)

    print(f"enabled:   {_ENABLED_LABEL[_enabled()]}")

    for line in _profile_status_lines():
        print(line)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
