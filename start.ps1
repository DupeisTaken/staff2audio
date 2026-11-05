param([int]$Port = 8765, [switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$Python = Join-Path $PSScriptRoot '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $Python)) {
    python -m venv .venv
    if ($LASTEXITCODE -ne 0) { throw 'Install Python 3.11 or later, then try again.' }
}
& $Python -c 'import fastapi, uvicorn, cv2, fitz, PIL, multipart' 2>$null
if ($LASTEXITCODE -ne 0) {
    & $Python -m pip install -r requirements.txt
    if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
}
$LaunchArgs = @('run.py', '--port', "$Port")
if ($NoBrowser) { $LaunchArgs += '--no-browser' }
& $Python @LaunchArgs
