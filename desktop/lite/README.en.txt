Language: English. Chinese version: README.txt

OMOPredict {{VERSION}} - lightweight package (Windows x64)
==========================================================

This package does **not include** a Python runtime; your machine needs to already have Python 3.12+ (or uv).
You only install the dependencies once, and after that you use it normally by double-clicking.

1. Preparing the engine (only once)
-----------------------------------

Option A: you have uv (recommended, fastest)
    powershell -ExecutionPolicy Bypass -File setup-engine.ps1

Option B: Python only
    1) Check the version: python --version      (3.12 or higher required)
    2) Run:               powershell -ExecutionPolicy Bypass -File setup-engine.ps1

What the script does: it installs the engine dependencies under resources\engine, then sends one ping to confirm the engine is available.
If you see "engine ready: ping ok", it succeeded. If downloads are slow, the script will suggest available mirror parameters.

2. Starting
-----------

Double-click OMOPredict.exe. The first launch takes a few seconds (it has to start the engine); after that it is normal.

3. When something goes wrong
----------------------------

1) "Engine unavailable" pops up at startup:
   - run setup-engine.ps1 again and look at the specific reason it gives;
   - confirm that the Python version is >= 3.12 and that `python -m omo.rpc` can start (press Ctrl+C to exit).

2) If you want to troubleshoot it yourself:
   - in the program menu, "File → Open log directory", and look at that day's log;
   - "File → Export diagnostic information…" generates a redacted diagnostic JSON (containing the version, paths and the tail of the backend log),
     which makes it convenient to report it together with the problem; secret-type information is masked automatically.

3) About antivirus software:
   The engine in this package is source code + your Python environment and does not contain a PyInstaller-packaged executable,
   so it is usually not falsely flagged. Only the full package (with a bundled engine) may be falsely flagged.

4. Size and contents
--------------------

This package is within about 50MB and contains: the Electron shell, the Go middleware (omopredict-server.exe),
the rendered pages (resources\dist) and the engine source (resources\engine).

The results are exactly the same as the "full package" — the only difference between the two is the engine source (this package uses the Python on your machine).
