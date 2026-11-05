"""Archive the smoke-tested executable, preserving Unix execute permissions."""
from __future__ import annotations

import argparse
import hashlib
from pathlib import Path
import shutil
import tarfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
TARGETS = ("windows-x64", "linux-x64", "macos-x64", "macos-arm64")


def package(target: str) -> Path:
    if target not in TARGETS:
        raise ValueError("Unsupported release target")
    name = f"Prima-{target}"
    executable = "Prima.exe" if target.startswith("windows") else "Prima"
    stage = ROOT / "build" / "archives" / name
    stage.mkdir(parents=True, exist_ok=True)
    shutil.copy2(ROOT / "dist" / executable, stage / executable)
    shutil.copy2(ROOT / "LICENSE", stage / "LICENSE")
    shutil.copy2(ROOT / "docs" / "desktop-quickstart.txt", stage / "README.txt")
    shutil.copytree(ROOT / "build" / "desktop-licenses", stage / "licenses", dirs_exist_ok=True)
    (ROOT / "release").mkdir(exist_ok=True)
    if target.startswith("windows"):
        archive = ROOT / "release" / (name + ".zip")
        with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as bundle:
            for path in sorted(stage.rglob("*")):
                if path.is_file():
                    bundle.write(path, Path(name) / path.relative_to(stage))
    else:
        (stage / executable).chmod(0o755)
        archive = ROOT / "release" / (name + ".tar.gz")
        def permissions(member):
            # Explicit archive modes also work when tests run on Windows/NTFS.
            member.mode = 0o755 if member.isdir() or member.name == f"{name}/{executable}" else 0o644
            return member
        with tarfile.open(archive, "w:gz") as bundle:
            bundle.add(stage, arcname=name, filter=permissions)
    with archive.open("rb") as stream:
        digest = hashlib.file_digest(stream, "sha256").hexdigest()
    archive.with_name(archive.name + ".sha256").write_text(f"{digest}  {archive.name}\n", encoding="utf-8")
    print(f"Packaged {archive.name}: {archive.stat().st_size / 1024 / 1024:.1f} MiB", flush=True)
    return archive


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target", required=True, choices=TARGETS)
    package(parser.parse_args().target)
