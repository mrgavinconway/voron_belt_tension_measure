import {detectPitch, targetForSpan, normalizedHz, createPitchTracker, POLL_MS, WINDOW_SECONDS} from './pitch.js';
const $ = id => document.getElementById(id);
let context, stream, analyser, timer, held = null, lastGood = 0, starting = false;
const tracker = createPitchTracker();
let records = [];
try { const saved = JSON.parse(localStorage.getItem('voron-readings') || '[]'); if (Array.isArray(saved)) records = saved.filter(r => Number.isFinite(r.hz) && Number.isFinite(r.span)).slice(-100); } catch {}
const valid = () => $('span').checkValidity() && $('reference').checkValidity();
function resetReading() {
  held = null; tracker.reset(); lastGood = 0;
  $('hz').textContent = '—'; $('save').disabled = true; $('quality').textContent = '—';
  $('equivalent').textContent = '150 mm reference';
  $('advice').textContent = 'Pluck one belt and wait for a stable reading.';
  drawSpectrum();
}
function setup(changeSystem = false) {
  if (changeSystem) {
    $('reference').value = $('system').value === 'ab' ? 110 : 140;
    const belts = $('system').value === 'ab' ? ['A', 'B'] : ['Z front left', 'Z front right', 'Z rear left', 'Z rear right'];
    $('belt').replaceChildren(...belts.map(name => new Option(name, name)));
  }
  resetReading();
  $('target').textContent = valid() ? `${targetForSpan(+$('reference').value, +$('span').value).toFixed(1)} Hz` : 'Enter valid values';
  $('instructions').textContent = $('system').value === 'ab'
    ? 'Official A/B setup: position the X extrusion so the moving X/Y idler centres are 150 mm from the front idler centres. Measure both belts, alternating adjustments until matched. Move away a few centimetres, return and recheck.'
    : 'Official Z setup: raise the gantry until the fixed belt attachment is 150 mm from the Z idler centre. Measure each of the four vertical Z belts. Move down a few centimetres, return and recheck. This preset is not for the short motor reduction belts.';
}
for (const id of ['printer', 'system', 'span', 'reference', 'belt', 'position']) {
  $(id).addEventListener('change', () => setup(id === 'system'));
}
for (const id of ['span', 'reference']) $(id).addEventListener('input', () => setup());
function stop() {
  clearInterval(timer); stream?.getTracks().forEach(track => track.stop());
  context?.close(); context = null; stream = null; analyser = null;
  $('listen').textContent = 'Start listening'; $('state').textContent = 'MICROPHONE OFF';
}
function drawSpectrum(bins, sampleRate, fftSize) {
  const canvas = $('spectrum');
  const width = canvas.clientWidth, height = 180, scale = window.devicePixelRatio || 1;
  if (canvas.width !== Math.round(width * scale) || canvas.height !== Math.round(height * scale)) {
    canvas.width = Math.round(width * scale); canvas.height = Math.round(height * scale);
  }
  const pen = canvas.getContext('2d');
  pen.setTransform(scale, 0, 0, scale, 0, 0);
  pen.clearRect(0, 0, width, height);
  const left = 34, right = width - 12, top = 24, bottom = height - 26;
  const x = hz => left + (hz - 20) / 380 * (right - left);
  const y = db => bottom - Math.max(0, Math.min(1, (db + 100) / 80)) * (bottom - top);
  pen.font = '10px system-ui'; pen.lineWidth = 1;
  for (const db of [-100, -60, -20]) {
    pen.strokeStyle = '#35453b'; pen.beginPath(); pen.moveTo(left,y(db)); pen.lineTo(right,y(db)); pen.stroke();
    pen.fillStyle = '#a5bbad'; pen.textAlign = 'right'; pen.fillText(String(db),left-5,y(db)+3);
  }
  pen.textAlign = 'center';
  for (const hz of [50,100,200,300,400]) {
    pen.fillStyle = '#a5bbad'; pen.fillText(String(hz), x(hz), height-10);
  }
  if (bins) {
    pen.strokeStyle = '#b5ed7b'; pen.lineWidth = 2; pen.beginPath();
    let first = true;
    for (let i = Math.ceil(20 * fftSize / sampleRate); i < bins.length && i * sampleRate / fftSize <= 400; i++) {
      const px = x(i * sampleRate / fftSize), py = y(bins[i]);
      if (first) { pen.moveTo(px,py); first = false; } else pen.lineTo(px,py);
    }
    pen.stroke();
  }
  const marker = (hz, label, color) => {
    if (hz < 20 || hz > 400) return;
    pen.strokeStyle = color; pen.lineWidth = 1; pen.setLineDash([4,4]);
    pen.beginPath(); pen.moveTo(x(hz),top); pen.lineTo(x(hz),bottom); pen.stroke(); pen.setLineDash([]);
    pen.fillStyle = color; pen.textAlign = hz > 300 ? 'right' : 'left';
    pen.fillText(label, x(hz), label.startsWith('Target') ? 12 : 23);
  };
  if (valid()) marker(targetForSpan(+$('reference').value,+$('span').value), 'Target', '#f5ca78');
  if (held) marker(held.hz, 'Held', '#8acbff');
}
window.addEventListener('resize', () => drawSpectrum());
async function start() {
  if (starting) return;
  if (context) { stop(); return; }
  if (!valid()) { $('advice').textContent = 'Enter a valid span and target first.'; return; }
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    $('advice').textContent = 'Microphone access needs HTTPS. Open the https:// address printed by your Linux server.';
    return;
  }
  starting = true; $('listen').disabled = true; resetReading();
  try {
    stream = await navigator.mediaDevices.getUserMedia({audio: {echoCancellation:false, noiseSuppression:false, autoGainControl:false}, video:false});
    context = new AudioContext({latencyHint:'interactive'}); await context.resume();
    analyser = context.createAnalyser();
    analyser.fftSize = Math.min(32768, 2 ** Math.ceil(Math.log2(context.sampleRate * WINDOW_SECONDS)));
    analyser.smoothingTimeConstant = .2;
    context.createMediaStreamSource(stream).connect(analyser);
    const data = new Float32Array(analyser.fftSize);
    const recent = data.subarray(Math.max(0, data.length - Math.ceil(context.sampleRate * WINDOW_SECONDS)));
    const bins = new Float32Array(analyser.frequencyBinCount);
    $('listen').textContent = 'Stop listening'; $('state').textContent = 'LISTENING';
    timer = setInterval(() => {
      analyser.getFloatTimeDomainData(data);
      analyser.getFloatFrequencyData(bins);
      drawSpectrum(bins, context.sampleRate, analyser.fftSize);
      const pitch = detectPitch(recent, context.sampleRate);
      const now = performance.now();
      if (!pitch || !valid()) {
        tracker.reset();
        if (now - lastGood > 300) {
          $('state').textContent = held ? 'READING HELD' : 'LISTENING';
          $('quality').textContent = held ? 'PLUCK AGAIN TO UPDATE' : 'WAITING FOR SIGNAL';
        }
        return;
      }
      const hz = tracker.update(pitch);
      if (hz === null) return;
      held = {hz, span:+$('span').value, reference:+$('reference').value};
      lastGood = now;
      $('hz').textContent = hz.toFixed(1);
      $('state').textContent = 'STABLE SIGNAL';
      $('quality').textContent = pitch.confidence > .95 ? 'STRONG PERIODICITY' : 'FAIR PERIODICITY';
      const difference = (hz / targetForSpan(held.reference, held.span) - 1) * 100;
      $('advice').textContent = Math.abs(difference) <= 5 ? 'Near target · compare the other belts' : `${Math.abs(difference).toFixed(0)}% ${difference > 0 ? 'above target · loosen slightly' : 'below target · tighten slightly'}`;
      $('equivalent').textContent = `${normalizedHz(hz, held.span).toFixed(1)} Hz at 150 mm`;
      $('save').disabled = false;
    }, POLL_MS);
  } catch (error) {
    stop();
    $('advice').textContent = error.name === 'NotAllowedError'
      ? 'Microphone permission denied. Allow microphone access in your browser site settings, then retry.'
      : `Could not start microphone: ${error.message}`;
  } finally { starting = false; $('listen').disabled = false; }
}
$('listen').addEventListener('click', start);
document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
window.addEventListener('pagehide', stop);
function render() {
  $('records').replaceChildren();
  if (!records.length) {
    const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = 'No readings saved yet.'; $('records').append(empty);
  }
  for (const record of [...records].reverse()) {
    const row = document.createElement('div'); row.className = 'record';
    const label = document.createElement('div'); label.textContent = `${record.printer} · ${record.belt}`;
    const detail = document.createElement('small'); detail.textContent = `${record.position} · ${record.span} mm · ${record.hz.toFixed(1)} Hz`;
    label.append(detail);
    const value = document.createElement('strong'); value.textContent = `${normalizedHz(record.hz, record.span).toFixed(1)} Hz`;
    const unit = document.createElement('small'); unit.textContent = 'at 150 mm'; value.append(unit);
    row.append(label, value); $('records').append(row);
  }
  $('export').disabled = $('clear').disabled = !records.length;
}
function persist() { try { localStorage.setItem('voron-readings', JSON.stringify(records)); } catch { $('advice').textContent = 'Browser storage unavailable. Export CSV to keep your readings.'; } render(); }
$('save').addEventListener('click', () => {
  if (!held) return;
  records.push({...held, printer:$('printer').value, belt:$('belt').value, position:$('position').value, time:new Date().toISOString()});
  records = records.slice(-100); persist(); $('save').disabled = true;
});
$('clear').addEventListener('click', () => { if (confirm('Clear all saved readings on this browser?')) { records = []; persist(); } });
$('export').addEventListener('click', () => {
  const rows = [['time','printer','belt','position','span_mm','frequency_hz','equivalent_150mm_hz','reference_hz'],
    ...records.map(r => [r.time,r.printer,r.belt,r.position,r.span,r.hz,normalizedHz(r.hz,r.span),r.reference])];
  const csv = rows.map(row => row.map(value => `"${String(value).replaceAll('"','""')}"`).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], {type:'text/csv'}));
  const link = document.createElement('a'); link.href = url; link.download = 'voron-belt-readings.csv'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});
setup(true); render();
