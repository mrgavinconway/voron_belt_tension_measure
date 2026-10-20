"""Exercise generated certificates and the real HTTPS command-line server."""
import os
from pathlib import Path
import ssl
import subprocess
import sys
import tempfile
import unittest
import urllib.error
import urllib.request

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from server import ROOT, ensure_certificate


class HTTPSSetupTests(unittest.TestCase):
    def test_generation_reuse_and_repair(self):
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp) / "certs"
            cert, key = ensure_certificate(directory, ["127.0.0.1"])
            original = cert.read_bytes(), key.read_bytes()
            ensure_certificate(directory, ["127.0.0.1"])
            self.assertEqual(original, (cert.read_bytes(), key.read_bytes()))
            if os.name == "posix":
                self.assertEqual(key.stat().st_mode & 0o777, 0o600)
            key.write_text("broken key")
            ensure_certificate(directory, ["127.0.0.1"])
            context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            context.load_cert_chain(cert, key)
            self.assertNotEqual(original[0], cert.read_bytes())

    def test_cli_serves_https_and_keeps_private_key_outside_webroot(self):
        with tempfile.TemporaryDirectory() as tmp:
            process = subprocess.Popen(
                [sys.executable, str(ROOT / "server.py"), "--host", "127.0.0.1",
                 "--port", "0", "--cert-dir", tmp],
                stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
            )
            try:
                url = None
                for _ in range(5):
                    line = process.stdout.readline().strip()
                    if line.startswith("https://"):
                        url = line
                        break
                self.assertIsNotNone(url)
                # Trust only this test's generated certificate, with hostname
                # verification enabled; actually exercise TLS, not HTTP.
                context = ssl.create_default_context(cafile=str(Path(tmp) / "cert.pem"))
                with urllib.request.urlopen(url, context=context, timeout=5) as response:
                    self.assertIn(b"Voron Belt Tuner", response.read())
                with self.assertRaises(urllib.error.HTTPError) as result:
                    urllib.request.urlopen(url + "/.certs/key.pem", context=context, timeout=5)
                self.assertEqual(result.exception.code, 404)
                result.exception.close()
            finally:
                process.terminate()
                process.communicate(timeout=5)


if __name__ == "__main__":
    unittest.main()
