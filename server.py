"""Small static server. Audio processing happens entirely in the browser."""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import ssl
import ipaddress
import os
import shutil
import socket
import subprocess
import tempfile


ROOT = Path(__file__).resolve().parent


def local_addresses():
    """Best-effort discovery; no traffic is sent by the UDP connect."""
    addresses = {"127.0.0.1"}
    try:
        addresses.update(socket.gethostbyname_ex(socket.gethostname())[2])
    except OSError:
        pass
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
            probe.connect(("192.0.2.1", 80))
            addresses.add(probe.getsockname()[0])
    except OSError:
        pass
    return sorted(addresses)


def ensure_certificate(directory, addresses):
    """Create or renew a private, persistent self-signed certificate."""
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    cert, key = directory / "cert.pem", directory / "key.pem"
    openssl = shutil.which("openssl")
    if cert.exists() and key.exists():
        try:
            context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            context.load_cert_chain(cert, key)
            # Renew when less than a day remains. Valid existing certificates
            # still work if OpenSSL was removed after initial setup.
            if not openssl or subprocess.run(
                [openssl, "x509", "-checkend", "86400", "-noout", "-in", str(cert)],
                capture_output=True, check=False,
            ).returncode == 0:
                return cert, key
        except ssl.SSLError:
            pass
    if not openssl:
        raise RuntimeError("Automatic HTTPS setup needs OpenSSL. Install it once "
                           "(Debian/Ubuntu: sudo apt install openssl), then rerun.")
    san = ["DNS:localhost"]
    san.extend(f"IP:{ipaddress.ip_address(address)}" for address in addresses)
    # Generate in a private directory and publish only after OpenSSL succeeds.
    with tempfile.TemporaryDirectory(dir=directory) as scratch:
        new_cert, new_key = Path(scratch) / "cert.pem", Path(scratch) / "key.pem"
        result = subprocess.run([
            openssl, "req", "-x509", "-newkey", "rsa:2048", "-sha256", "-nodes",
            "-days", "3650", "-subj", "/CN=Voron Belt Tuner",
            "-addext", "subjectAltName=" + ",".join(san),
            "-keyout", str(new_key), "-out", str(new_cert),
        ], capture_output=True, text=True, check=False)
        if result.returncode:
            raise RuntimeError(f"Certificate generation failed: {result.stderr.strip()}")
        new_key.chmod(0o600)
        os.replace(new_key, key)
        os.replace(new_cert, cert)
    print(f"Created self-signed certificate in {directory}", flush=True)
    return cert, key


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", help="Bind address (default: all IPv4 interfaces for HTTPS)")
    parser.add_argument("--port", type=int, help="Default: 8443 for HTTPS, 8000 for HTTP")
    parser.add_argument("--http", action="store_true", help="HTTP on loopback for a reverse proxy")
    parser.add_argument("--cert-dir", type=Path, default=ROOT / ".certs",
                        help="Directory for automatically generated certificates")
    parser.add_argument("--cert", help="TLS certificate PEM")
    parser.add_argument("--key", help="TLS private key PEM")
    args = parser.parse_args()
    if bool(args.cert) != bool(args.key):
        parser.error("--cert and --key must be supplied together")
    if args.http and args.cert:
        parser.error("--http cannot be combined with --cert/--key")
    args.host = args.host or ("127.0.0.1" if args.http else "0.0.0.0")
    args.port = args.port if args.port is not None else (8000 if args.http else 8443)
    addresses = local_addresses()
    context = None
    if not args.http:
        try:
            cert, key = (args.cert, args.key) if args.cert else ensure_certificate(
                args.cert_dir.resolve(), addresses)
            context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            context.load_cert_chain(cert, key)
        except (OSError, RuntimeError) as error:
            parser.exit(1, f"HTTPS setup failed: {error}\n")
    handler = partial(SimpleHTTPRequestHandler, directory=str(ROOT / "web"))
    server = ThreadingHTTPServer((args.host, args.port), handler)
    if context:
        server.socket = context.wrap_socket(server.socket, server_side=True)
    scheme = "http" if args.http else "https"
    hosts = addresses if args.host == "0.0.0.0" else [args.host]
    print("Open one of these addresses (use a LAN address from your phone):", flush=True)
    for host in hosts:
        print(f"  {scheme}://{host}:{server.server_port}", flush=True)
    if context and not args.cert:
        print("Self-signed HTTPS: Chrome will show a certificate warning. "
              "For your own server, choose Advanced > Proceed, then allow microphone access.",
              flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
