"""Small static server. Audio processing happens entirely in the browser."""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import ssl


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--cert", help="TLS certificate PEM")
    parser.add_argument("--key", help="TLS private key PEM")
    args = parser.parse_args()
    if bool(args.cert) != bool(args.key):
        parser.error("--cert and --key must be supplied together")
    handler = partial(SimpleHTTPRequestHandler, directory=str(Path(__file__).parent / "web"))
    server = ThreadingHTTPServer((args.host, args.port), handler)
    if args.cert:
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(args.cert, args.key)
        server.socket = context.wrap_socket(server.socket, server_side=True)
    print(f"Serving on {'https' if args.cert else 'http'}://{args.host}:{args.port}", flush=True)
    print("Phone microphone access requires a trusted HTTPS address.", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
