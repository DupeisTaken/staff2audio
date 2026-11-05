"""Real socket ownership and browser readiness regressions for desktop startup."""
import errno
import socket
import threading
from types import SimpleNamespace

import pytest

import run as launcher


def test_free_port_is_loopback_and_stays_reserved():
    with launcher.reserve_listener(0) as listener:
        host, port = listener.getsockname()
        assert host == "127.0.0.1" and port > 0
        with socket.socket() as other, pytest.raises(OSError):
            other.bind((host, port))


def test_occupied_default_automatically_chooses_another_port(monkeypatch):
    with launcher.reserve_listener(0) as occupied:
        monkeypatch.setattr(launcher, "DEFAULT_PORT", occupied.getsockname()[1])
        with launcher.reserve_listener(None) as fallback:
            assert fallback.getsockname()[1] != occupied.getsockname()[1]


def test_explicit_busy_port_fails_instead_of_changing_user_choice():
    with launcher.reserve_listener(0) as occupied:
        with pytest.raises(OSError):
            launcher.reserve_listener(occupied.getsockname()[1])


def test_unexpected_socket_error_does_not_fall_back(monkeypatch):
    closed = []
    def fail(_):
        raise OSError(errno.ENETDOWN, "network is down")
    monkeypatch.setattr(launcher.socket, "socket", lambda *args:
                        SimpleNamespace(bind=fail, close=lambda: closed.append(True)))
    with pytest.raises(OSError, match="network is down"):
        launcher.reserve_listener(None)
    assert closed == [True]


@pytest.mark.parametrize("port", ["-1", "65536"])
def test_invalid_cli_port(port):
    with pytest.raises(SystemExit) as error:
        launcher.main(["--port", port])
    assert error.value.code == 2


def test_cli_busy_port_explains_how_to_recover(capsys):
    with launcher.reserve_listener(0) as occupied:
        with pytest.raises(SystemExit) as error:
            launcher.main(["--port", str(occupied.getsockname()[1]), "--no-browser"])
    assert error.value.code == 1
    assert "--port 0" in capsys.readouterr().err


def test_browser_waits_for_our_server_and_opens_exactly_once(monkeypatch):
    opened = []
    server = SimpleNamespace(started=False)
    class Startup:
        def is_set(self):
            return False
        def wait(self, _):
            assert not opened
            server.started = True
    monkeypatch.setattr(launcher, "open_browser", opened.append)
    launcher.announce_when_ready(server, "http://127.0.0.1:12345", Startup(), browser=True)
    assert opened == ["http://127.0.0.1:12345"]


@pytest.mark.parametrize("started", [False, True])
def test_stopped_launcher_never_opens_browser(monkeypatch, started):
    stopped = threading.Event()
    stopped.set()
    monkeypatch.setattr(launcher, "open_browser", lambda _: pytest.fail("unexpected browser"))
    launcher.announce_when_ready(SimpleNamespace(started=started), "unused", stopped, browser=True)


def test_no_browser_still_announces_url(monkeypatch, capsys):
    monkeypatch.setattr(launcher, "open_browser", lambda _: pytest.fail("unexpected browser"))
    launcher.announce_when_ready(SimpleNamespace(started=True), "http://127.0.0.1:1",
                                 threading.Event(), browser=False)
    assert "Prima is ready: http://127.0.0.1:1" in capsys.readouterr().out


@pytest.mark.parametrize("original", [None, "/system/libraries"])
def test_frozen_linux_browser_gets_system_library_path(monkeypatch, original):
    monkeypatch.setattr(launcher.sys, "frozen", True, raising=False)
    monkeypatch.setattr(launcher.sys, "platform", "linux")
    monkeypatch.setenv("LD_LIBRARY_PATH", "/tmp/prima-libraries")
    if original is None:
        monkeypatch.delenv("LD_LIBRARY_PATH_ORIG", raising=False)
    else:
        monkeypatch.setenv("LD_LIBRARY_PATH_ORIG", original)
    seen = []
    def browser(_):
        seen.append(launcher.os.environ.get("LD_LIBRARY_PATH"))
        raise OSError("browser unavailable")
    monkeypatch.setattr(launcher.webbrowser, "open", browser)
    with pytest.raises(OSError):
        launcher.open_browser("unused")
    assert seen == [original]
    assert launcher.os.environ["LD_LIBRARY_PATH"] == "/tmp/prima-libraries"
