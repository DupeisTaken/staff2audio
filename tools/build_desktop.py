"""Build on the target OS using the active, isolated Python environment."""
from __future__ import annotations

from importlib import metadata
import json
from pathlib import Path
import subprocess
import sys

from packaging.requirements import Requirement
from packaging.utils import canonicalize_name

ROOT = Path(__file__).resolve().parents[1]
LICENSES = ROOT / "build" / "desktop-licenses"


def collect_licenses():
    """Preserve installed runtime dependency licenses without fetching at launch."""
    LICENSES.mkdir(parents=True, exist_ok=True)
    pending = [Requirement(line).name for line in
               (ROOT / "requirements.txt").read_text().splitlines()
               if line.strip() and not line.startswith("#")]
    packages = {}
    while pending:
        name = canonicalize_name(pending.pop())
        if name in packages:
            continue
        distribution = metadata.distribution(name)
        info = distribution.metadata
        entry = {"name": info["Name"], "version": distribution.version,
                 "license": info.get("License-Expression") or info.get("License", "See license files"),
                 "files": []}
        packages[name] = entry
        for requirement in distribution.requires or []:
            dependency = Requirement(requirement)
            if dependency.marker is None or dependency.marker.evaluate({"extra": ""}):
                pending.append(dependency.name)
        for file in distribution.files or []:
            if not file.name.lower().startswith(("license", "copying", "notice")):
                continue
            source = Path(distribution.locate_file(file))
            if not source.is_file():
                continue
            # Keep the distribution's relative layout, including nested licenses.
            safe_parts = [part for part in file.parts if part not in {"..", "."}]
            relative = Path(name, *safe_parts)
            target = LICENSES / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(source.read_bytes())
            entry["files"].append(relative.as_posix())
    for source in [Path(sys.base_prefix) / "LICENSE.txt", Path(sys.base_prefix) / "LICENSE"]:
        if source.is_file():
            (LICENSES / "Python-LICENSE.txt").write_bytes(source.read_bytes())
            break
    (LICENSES / "packages.json").write_text(json.dumps(packages, indent=2, sort_keys=True), encoding="utf-8")


def main():
    collect_licenses()
    # No global install, shared-cache cleanup, or optional executable compressor.
    subprocess.run([sys.executable, "-m", "PyInstaller", "--noconfirm",
                    "--distpath", str(ROOT / "dist"), "--workpath", str(ROOT / "build" / "pyinstaller"),
                    str(ROOT / "staff2audio.spec")], cwd=ROOT, check=True)


if __name__ == "__main__":
    main()
