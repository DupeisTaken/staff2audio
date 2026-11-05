"""Start the local app and open a browser only when the server is ready."""
import argparse
import threading
import time
import urllib.request
import webbrowser

import uvicorn


def open_when_ready(port):
    url = f"http://127.0.0.1:{port}"
    for _ in range(60):
        try:
            with urllib.request.urlopen(url + "/api/health", timeout=.4) as response:
                if response.status == 200:
                    webbrowser.open(url)
                    return
        except OSError:
            time.sleep(.25)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Prima local score-to-piano player")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()
    if not 1 <= args.port <= 65535:
        parser.error("port must be between 1 and 65535")
    if not args.no_browser:
        threading.Thread(target=open_when_ready, args=(args.port,), daemon=True).start()
    uvicorn.run("app:app", host="127.0.0.1", port=args.port)
