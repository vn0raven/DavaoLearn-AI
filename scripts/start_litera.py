"""Prepare and run the canonical Litera application on loopback."""

import hashlib
import os
import shutil
import socket
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / "frontend"
CACHE = Path(sys.prefix) / "litera-launch"


def fingerprint(files):
    digest = hashlib.sha256()
    for path in sorted(files):
        digest.update(str(path.relative_to(ROOT)).encode())
        digest.update(b"\0")
        digest.update(hashlib.sha256(path.read_bytes()).digest())
    return digest.hexdigest()


def matches(name, expected):
    receipt = CACHE / name
    return receipt.is_file() and receipt.read_text(encoding="utf-8").strip() == expected


def record(name, value):
    CACHE.mkdir(parents=True, exist_ok=True)
    (CACHE / name).write_text(value, encoding="utf-8")


def run(*args):
    subprocess.run(args, cwd=ROOT, check=True)


def require_free_port(port):
    with socket.socket() as probe:
        if sys.platform == "win32":
            probe.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        else:
            probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            probe.bind(("127.0.0.1", port))
        except OSError as exc:
            raise RuntimeError(
                f"Port {port} is occupied. If Litera is already running, open http://127.0.0.1:{port}. "
                "Otherwise stop the existing service or set a different PORT in .env."
            ) from exc


def main():
    if not (3, 11) <= sys.version_info[:2] <= (3, 12):
        raise RuntimeError("Use Python 3.11 or 3.12 for the Litera environment.")
    if not (ROOT / ".env").is_file():
        raise RuntimeError("Copy .env.example to .env and set the Gmail sender and private teacher key.")
    node = shutil.which("node")
    npm = shutil.which("npm.cmd" if sys.platform == "win32" else "npm")
    if not node or not npm:
        raise RuntimeError("Install Node.js 22.12 or newer, then reopen your terminal.")
    version = subprocess.check_output([node, "--version"], text=True).strip()
    if tuple(map(int, version.lstrip("v").split(".")[:2])) < (22, 12):
        raise RuntimeError("Install Node.js 22.12 or newer.")

    requirements = ROOT / "backend" / "requirements.txt"
    backend_key = fingerprint([requirements])
    if not matches("python", backend_key):
        print("Checking Python dependencies…", flush=True)
        run(sys.executable, "-m", "pip", "install", "-r", str(requirements))
        record("python", backend_key)

    from dotenv import load_dotenv

    load_dotenv(ROOT / ".env")
    try:
        port = int(os.environ.get("PORT", "8765"))
    except ValueError as exc:
        raise RuntimeError("PORT in .env must be an integer from 1 to 65535.") from exc
    if not 1 <= port <= 65535:
        raise RuntimeError("PORT in .env must be from 1 to 65535.")
    require_free_port(port)

    manifests = [FRONTEND / "package.json", FRONTEND / "package-lock.json"]
    frontend_key = f"{version}:{fingerprint(manifests)}"
    npm_cmd = ("cmd.exe", "/d", "/c", "npm.cmd") if sys.platform == "win32" else (npm,)
    vite = FRONTEND / "node_modules" / "vite" / "package.json"
    if not matches("node", frontend_key) or not vite.is_file():
        print("Installing frontend dependencies from the lockfile…", flush=True)
        run(*npm_cmd, "--prefix", "frontend", "ci")
        record("node", frontend_key)

    inputs = manifests + [FRONTEND / name for name in ("index.html", "tsconfig.json", "vite.config.ts")]
    inputs.extend(path for folder in ("src", "public") for path in (FRONTEND / folder).rglob("*") if path.is_file())
    build_key = f"{version}:{fingerprint(inputs)}"
    dist = FRONTEND / "dist"
    if not matches("build", build_key) or not (dist / "index.html").is_file() or not (dist / "assets").is_dir():
        print("Building the integrated Litera frontend…", flush=True)
        run(*npm_cmd, "--prefix", "frontend", "run", "build", "--", "--no-emptyOutDir")
        record("build", build_key)
    else:
        print("Using the existing Litera frontend build.", flush=True)

    require_free_port(port)
    print(f"Litera student: http://127.0.0.1:{port}\nLitera teacher: http://127.0.0.1:{port}/teacher", flush=True)
    print("Press Ctrl+C here to stop Litera.", flush=True)
    # Import with the repository root on sys.path when running scripts/start_litera.py.
    sys.path.insert(0, str(ROOT))
    import uvicorn
    from backend.server import app

    uvicorn.run(app, host="127.0.0.1", port=port)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
    except (OSError, RuntimeError, subprocess.CalledProcessError) as error:
        print(f"Litera startup stopped. {error}", file=sys.stderr)
        sys.exit(1)
