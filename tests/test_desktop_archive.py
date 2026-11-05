"""Distributed archives keep a standalone executable, notices and checksums."""
import hashlib
import tarfile
import zipfile

import pytest

from tools import package_desktop


@pytest.mark.parametrize("target", ["windows-x64", "linux-x64", "macos-arm64"])
def test_archive_payload_licenses_checksum_and_unix_mode(tmp_path, monkeypatch, target):
    monkeypatch.setattr(package_desktop, "ROOT", tmp_path)
    executable = "Prima.exe" if target == "windows-x64" else "Prima"
    binary = b"synthetic executable bytes for archive verification"
    for path, content in {
        f"dist/{executable}": binary,
        "LICENSE": b"Application license",
        "docs/desktop-quickstart.txt": b"Start Prima in your browser",
        "build/desktop-licenses/dependency/LICENSE": b"Dependency license",
    }.items():
        destination = tmp_path / path
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(content)
    archive = package_desktop.package(target)
    name = f"Prima-{target}"
    if target == "windows-x64":
        with zipfile.ZipFile(archive) as bundle:
            files = {path: bundle.read(path) for path in bundle.namelist()}
    else:
        with tarfile.open(archive) as bundle:
            member = bundle.getmember(f"{name}/{executable}")
            assert member.mode & 0o111 == 0o111
            files = {member.name: bundle.extractfile(member).read()
                     for member in bundle.getmembers() if member.isfile()}
    assert files[f"{name}/{executable}"] == binary
    assert files[f"{name}/LICENSE"] == b"Application license"
    assert files[f"{name}/licenses/dependency/LICENSE"] == b"Dependency license"
    assert f"{name}/README.txt" in files
    expected = hashlib.sha256(archive.read_bytes()).hexdigest()
    assert archive.with_name(archive.name + ".sha256").read_text() == f"{expected}  {archive.name}\n"


def test_unknown_target_rejected_before_touching_files(tmp_path, monkeypatch):
    monkeypatch.setattr(package_desktop, "ROOT", tmp_path)
    with pytest.raises(ValueError, match="Unsupported"):
        package_desktop.package("unsupported")
    assert not list(tmp_path.iterdir())
