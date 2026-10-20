import {detectPitch, targetForSpan, normalizedHz} from './pitch.js';
const $ = id => document.getElementById(id);
let context, stream, analyser, timer, held = null, samples = [], lastGood = 0, starting = false;
let records = [];
try { const saved = JSON.parse(localStorage.getItem('voron-readings') || '[]'); if (Array.isArray(saved)) records = saved.filter(r => Number.isFinite(r.hz) && Number.isFinite(r.span)).slice(-100); } catch {}
const valid = () => $('span').checkValidity() && $('reference').checkValidity();
function resetReading() {
  held = null; samples = []; lastGood = 0;
  $('hz').textContent = '—'; $('save').disabled = true; $('quality').textContent = '—';
  $('equivalent').textContent = '150 mm reference';
  $('advice').textContent = 'Pluck one belt and wait for a stable reading.';
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
    context = new AudioContext(); await context.resume();
    analyser = context.createAnalyser(); analyser.fftSize = 16384;
    context.createMediaStreamSource(stream).connect(analyser);
    const data = new Float32Array(analyser.fftSize);
    $('listen').textContent = 'Stop listening'; $('state').textContent = 'LISTENING';
    timer = setInterval(() => {
      analyser.getFloatTimeDomainData(data);
      const pitch = detectPitch(data, context.sampleRate);
      const now = performance.now();
      if (!pitch || !valid()) {
        samples = [];
        if (now - lastGood > 1000) {
          $('state').textContent = held ? 'READING HELD' : 'LISTENING';
          $('quality').textContent = held ? 'PLUCK AGAIN TO UPDATE' : 'WAITING FOR SIGNAL';
        }
        return;
      }
      if (samples.length && Math.abs(pitch.hz / samples[samples.length - 1] - 1) > .025) samples = [];
      samples.push(pitch.hz); if (samples.length > 4) samples.shift();
      if (samples.length < 4) return;
      const hz = [...samples].sort((a,b) => a-b).slice(1,3).reduce((a,b) => a+b) / 2;
      held = {hz, span:+$('span').value, reference:+$('reference').value};
      lastGood = now;
      $('hz').textContent = hz.toFixed(1);
      $('state').textContent = 'STABLE SIGNAL';
      $('quality').textContent = pitch.confidence > .95 ? 'STRONG PERIODICITY' : 'FAIR PERIODICITY';
      const difference = (hz / targetForSpan(held.reference, held.span) - 1) * 100;
      $('advice').textContent = Math.abs(difference) <= 5 ? 'Near target · compare the other belts' : `${Math.abs(difference).toFixed(0)}% ${difference > 0 ? 'above target · loosen slightly' : 'below target · tighten slightly'}`;
      $('equivalent').textContent = `${normalizedHz(hz, held.span).toFixed(1)} Hz at 150 mm`;
      $('save').disabled = false;
    }, 150);
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
