"""One native executable, including offline assets. Build on each target OS."""
from pathlib import Path

root = Path(SPECPATH)
datas = [(str(root / "static"), "static"),
         (str(root / "staff2audio" / "assets"), "staff2audio/assets"),
         (str(root / "build" / "desktop-licenses"), "static/licenses"),
         (str(root / "LICENSE"), ".")]

analysis = Analysis(
    [str(root / "run.py")], pathex=[str(root)], datas=datas,
    # Uvicorn selects these modules by string even with explicit driver names.
    hiddenimports=["uvicorn.loops.asyncio", "uvicorn.protocols.http.h11_impl",
                   "uvicorn.lifespan.on"],
    excludes=["pytest", "httpx", "tkinter", "matplotlib", "IPython"],
    noarchive=False,
)
pyz = PYZ(analysis.pure)
exe = EXE(pyz, analysis.scripts, analysis.binaries, analysis.datas, [],
          name="Prima", debug=False, strip=False, upx=False, console=True)
