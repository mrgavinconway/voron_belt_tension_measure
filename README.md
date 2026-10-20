# Voron Belt Tuner

A phone-friendly belt frequency meter, served from any Linux machine with
Python 3.10+ and OpenSSL (normally already available on Linux). No pip packages, npm installation, account or audio upload is
required by the app. JavaScript on the phone processes microphone audio.

## Run on Linux

```sh
git clone https://github.com/mrgavinconway/voron_belt_tension_measure.git
cd voron_belt_tension_measure
python3 server.py
```

The server automatically generates a self-signed certificate on first run,
reuses it on later runs, and starts HTTPS on port **8443**, accessible on your LAN.
Open the printed `https://YOUR-LINUX-IP:8443` address in Chrome on your phone,
on the same network. For your own server, choose **Advanced → Proceed** on
the certificate warning, then allow microphone access. No certificate creation
or installation on the phone is required for this Chrome workflow.

Keep the process running and permit TCP port 8443 through your Linux firewall
if needed. Use this unauthenticated app on your trusted LAN.
Certificates and the private key are stored in `.certs/`, outside the served
web directory and excluded from Git. Certificates renew automatically when
less than a day remains; the generated certificate lasts ten years.
If OpenSSL is missing, the server prints an installation hint.
Use `--port 9443` to choose a different port.

### Phone access: Tailscale HTTPS

If you use Tailscale, install/sign in on the Linux server and Pixel using
the same tailnet. This optional approach avoids the certificate warning.
Start the app in HTTP proxy mode instead of the default HTTPS mode:

```sh
python3 server.py --http
```

Then, in a second terminal:

```sh
sudo tailscale serve --bg http://127.0.0.1:8000
```

Follow any prompt to enable HTTPS, then open the HTTPS URL printed by
Tailscale in Chrome on your Pixel. Allow microphone access. This serves the
app privately to your tailnet; it does not require public port forwarding.
The Python process must remain running even though Serve is in the background.

[Tailscale Serve documentation](https://tailscale.com/docs/reference/tailscale-cli/serve)

### Other HTTPS options

An existing HTTPS reverse proxy can forward to `127.0.0.1:8000` when you start
the app with `python3 server.py --http`.
Alternatively the server accepts your own certificate and key:

```sh
python3 server.py --host 0.0.0.0 --port 8443 --cert /path/fullchain.pem --key /path/private.key
```

For a warning-free connection, use a certificate trusted by the phone and
a matching hostname. Custom certificates are not automatically renewed.

### Keep it running after logout (optional systemd)

Create `/etc/systemd/system/voron-belt-tuner.service`, replacing the user
and absolute paths:

```ini
[Unit]
Description=Voron Belt Tuner
After=network.target

[Service]
User=YOUR_USER
WorkingDirectory=/absolute/path/voron_belt_tension_measure
ExecStart=/usr/bin/python3 /absolute/path/voron_belt_tension_measure/server.py --cert-dir /var/lib/voron-belt-tuner
StateDirectory=voron-belt-tuner
Restart=on-failure
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=read-only

[Install]
WantedBy=multi-user.target
```

Stop the manually started Python process before enabling the service:

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now voron-belt-tuner
```

## Measurement

1. Select V2.4 250 or 300 and the belt system.
2. For the official setup, keep the span at 150 mm and follow the on-screen
   positioning instructions. A/B starts at 110 Hz; vertical Z belts at 140 Hz.
   The Z target is **not** for the short motor reduction belts.
3. Start listening, hold the phone near the span, and gently pluck one belt.
4. Wait for a stable reading. It holds after the sound fades. Re-pluck to update.
5. Choose a belt and position, then save the reading. Changing setup clears
   the held reading so it cannot be attributed to a different configuration.
6. Stop listening when finished. Switching away from the page also stops
   the microphone.

For front/middle/back checks, enter the **measured free span**, not the build
size or gantry coordinate. The app scales the target as `reference × 150 / span`.
Saved readings show `measured Hz × span / 150` so different spans can be compared.
This is an ideal-string approximation, not a separately validated Voron procedure.
Official targets are starting points. The app's ±5% near-target band is a UI
aid, not a manufacturer tolerance.

Readings are kept in this browser's local storage (last 100); export CSV to
retain them elsewhere. Different hostnames/browsers have separate storage.
No server-side measurement storage is used.

## Limits and verification

The detector covers 35–400 Hz. It analyses the latest 120 ms of audio every
40 ms using normalized autocorrelation and holds after two consistent frames.
The live spectrum shows 20–400 Hz, with target and held-frequency markers;
it remains visible even when a tone is too uncertain to hold.
It requests unprocessed audio,
but a browser/phone may still apply processing. Signal confidence indicates
periodicity, not certainty that the fundamental is correct. Fan tones,
speech, weak fundamentals and harmonics can cause false readings. Turn off
unnecessary noise, pluck again, and check readings that jump by about 2×.
Long spans may produce frequencies below the detector's range.

Automated tests exercise synthesized decaying tones at 44.1/48 kHz,
a dominant second harmonic, silence, noise and span conversions:

```sh
node --test tests/pitch.test.js
python3 -m unittest discover -s tests -p "test_*.py"
```

Node is needed only for these tests, not for running the app. Real belt and
Pixel 8 Pro microphone validation is still needed before treating this as
a calibrated instrument.

Sources:
- [Official Voron belt tension guidance](https://docs.vorondesign.com/tuning/secondary_printer_tuning.html#belt-tension)
- [Gates sonic tension measurement manual](https://www.gates.com/content/dam/documents-library/operating-manuals/sonic-tension-meter-manual-emea.pdf)
- [Browser microphone security requirements](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia)
