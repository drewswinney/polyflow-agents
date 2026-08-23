"""`handheld-push` — put this package where Hermes looks for plugins.

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
"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path

# The directory name Hermes will know this by. It has a hyphen and the Python
# package has an underscore, and they are not interchangeable: this string is
# what the app's `PUSH_ROUTE` is built from (`/api/plugins/handheld-push/...`)
# and what `hermes plugins enable` expects.
PLUGIN_NAME = "handheld-push"

PACKAGE_ROOT = Path(__file__).resolve().parent


def hermes_home() -> Path:
    """The active Hermes home, asked of Hermes rather than guessed."""
    try:
        from hermes_constants import get_hermes_home

        return Path(get_hermes_home())
    except Exception:
        return Path(os.environ.get("HERMES_HOME", Path.home() / ".hermes"))


def plugin_dir() -> Path:
    return hermes_home() / "plugins" / PLUGIN_NAME


def _status_lines() -> list[str]:
    target = plugin_dir()
    lines = [f"package:   {PACKAGE_ROOT}", f"installed: {target}"]

    if not target.exists() and not target.is_symlink():
        lines.append("state:     not installed")

        return lines

    if target.is_symlink():
        lines.append(f"state:     linked -> {os.readlink(target)}")
    else:
        lines.append("state:     copied")

    for probe in ("plugin.yaml", "dashboard/manifest.json", "dashboard/plugin_api.py"):
        lines.append(f"  {'ok  ' if (target / probe).exists() else 'MISSING'} {probe}")

    return lines


def _enabled() -> bool:
    """Whether Hermes's allow-list already carries us.

    Read through Hermes rather than by parsing config.yaml: the file may not be
    where this process assumes, and the allow-list is the loader's own state.
    """
    try:
        from hermes_cli.plugins_cmd import _get_enabled_set

        return PLUGIN_NAME in _get_enabled_set()
    except Exception:
        return False


def install(*, copy: bool, force: bool, enable: bool) -> int:
    target = plugin_dir()

    if target.exists() or target.is_symlink():
        if not force:
            print(f"{target} already exists. Re-run with --force to replace it.", file=sys.stderr)

            return 1

        if target.is_symlink() or target.is_file():
            target.unlink()
        else:
            shutil.rmtree(target)

    target.parent.mkdir(parents=True, exist_ok=True)

    if copy:
        # `dashboard/` has to come along — without it the hooks load and
        # registration 404s, which is the confusing half-working state.
        shutil.copytree(
            PACKAGE_ROOT,
            target,
            ignore=shutil.ignore_patterns("__pycache__", "*.pyc", "cli.py"),
        )
    else:
        target.symlink_to(PACKAGE_ROOT, target_is_directory=True)

    print(f"Installed {PLUGIN_NAME} -> {target}")

    if enable:
        result = subprocess.run(
            ["hermes", "plugins", "enable", PLUGIN_NAME],
            capture_output=True,
            text=True,
        )

        if result.returncode == 0:
            print(f"Enabled {PLUGIN_NAME}.")
        else:
            print(
                f"Could not enable automatically ({result.stderr.strip() or 'hermes CLI not found'}).\n"
                f"Run: hermes plugins enable {PLUGIN_NAME}",
                file=sys.stderr,
            )
    elif not _enabled():
        # Worth stating rather than leaving to be discovered: an installed but
        # un-enabled plugin's Python is never imported, so every face is silently
        # absent (GHSA-mcfc-hp25-cjv7).
        print(f"\nNot enabled yet. Run:\n  hermes plugins enable {PLUGIN_NAME}")

    print(
        "\nThen restart the processes that load plugins:\n"
        "  hermes serve      hooks AND the registration routes, which mount at import\n"
        "  hermes gateway    the platform face (cron delivery only)\n"
        "\n`/api/dashboard/plugins/rescan` reloads plugin JS/CSS, but backend\n"
        "routes mount at module import — a new one needs the restart."
    )

    return 0


def uninstall() -> int:
    target = plugin_dir()

    if not target.exists() and not target.is_symlink():
        print(f"{target} is not installed.")

        return 0

    if target.is_symlink() or target.is_file():
        target.unlink()
    else:
        shutil.rmtree(target)

    print(f"Removed {target}. Registered devices survive in the registry; run with a fresh install to reuse them.")

    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="handheld-push", description=__doc__.split("\n")[0])
    sub = parser.add_subparsers(dest="command", required=True)

    p_install = sub.add_parser("install", help="link this package into ~/.hermes/plugins/")
    p_install.add_argument("--copy", action="store_true", help="copy instead of symlinking")
    p_install.add_argument("--force", action="store_true", help="replace an existing install")
    p_install.add_argument("--enable", action="store_true", help="also run `hermes plugins enable`")

    sub.add_parser("uninstall", help="remove it from ~/.hermes/plugins/")
    sub.add_parser("status", help="where it is installed, and whether it is enabled")

    args = parser.parse_args(argv)

    if args.command == "install":
        return install(copy=args.copy, force=args.force, enable=args.enable)

    if args.command == "uninstall":
        return uninstall()

    for line in _status_lines():
        print(line)

    print(f"enabled:   {'yes' if _enabled() else 'no'}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
