"""Launch the source checkout or frozen executable with no runtime setup."""
from __future__ import annotations

import argparse
import errno
import os
import socket
import sys
import threading
import webbrowser

import uvicorn


HOST = "127.0.0.1"
DEFAULT_PORT = 8765


def reserve_listener(port: int | None) -> socket.socket:
    """Keep the port reserved through server startup; never probe then rebind."""
    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        try:
            listener.bind((HOST, DEFAULT_PORT if port is None else port))
        except OSError as exc:
            if port is not None or exc.errno not in {errno.EADDRINUSE, errno.EACCES}:
                raise
            listener.bind((HOST, 0))
        listener.listen(128)
        listener.setblocking(False)
        return listener
    except BaseException:
        listener.close()
        raise


def open_browser(url: str) -> bool:
    # Frozen Linux libraries belong to staff2audio, not to the external browser.
    key = "LD_LIBRARY_PATH"
    saved = os.environ.get(key)
    if getattr(sys, "frozen", False) and sys.platform.startswith("linux"):
        original = os.environ.get(key + "_ORIG")
        if original is None:
            os.environ.pop(key, None)
        else:
            os.environ[key] = original
    try:
        return webbrowser.open(url)
    finally:
        if saved is None:
            os.environ.pop(key, None)
        else:
            os.environ[key] = saved


def announce_when_ready(server, url: str, stopped: threading.Event, *, browser: bool):
    """Only announce/open our own successfully started server."""
    while not stopped.is_set():
        if server.started:
            print(f"staff2audio is ready: {url}", flush=True)
            print("Keep this window open. Press Ctrl+C to stop staff2audio.", flush=True)
            if browser:
                try:
                    if not open_browser(url):
                        print("Open the address above in your browser.", flush=True)
                except Exception:
                    print("Open the address above in your browser.", flush=True)
            return
        stopped.wait(.05)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="staff2audio local score-to-piano player")
    parser.add_argument("--port", type=int, default=None,
                        help="use a specific port (0 chooses a free port); default: 8765 or a free port")
    parser.add_argument("--no-browser", action="store_true", help="print the local URL without opening a browser")
    args = parser.parse_args(argv)
    if args.port is not None and not 0 <= args.port <= 65535:
        parser.error("port must be between 0 and 65535")
    try:
        listener = reserve_listener(args.port)
    except OSError as exc:
        parser.exit(1, f"Cannot start staff2audio on the requested port: {exc}. Try --port 0.\n")
    with listener:
        # A direct import keeps the frozen module graph explicit. Pin Uvicorn's
        # pure-Python drivers instead of discovering optional native extras.
        from app import app
        config = uvicorn.Config(app, host=HOST, port=listener.getsockname()[1],
                                loop="asyncio", http="h11", ws="none", lifespan="on")
        server = uvicorn.Server(config)
        stopped = threading.Event()
        announcer = threading.Thread(target=announce_when_ready,
            args=(server, f"http://{HOST}:{listener.getsockname()[1]}", stopped),
            kwargs={"browser": not args.no_browser}, daemon=True)
        announcer.start()
        try:
            server.run(sockets=[listener])
        finally:
            stopped.set()
            announcer.join(timeout=1)
        return 0 if server.started else 1


if __name__ == "__main__":
    raise SystemExit(main())
