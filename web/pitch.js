// Normalized autocorrelation with earliest strong peak selection.
// Downsampling keeps low-frequency analysis inexpensive on a phone.
export function detectPitch(input, sampleRate, minHz = 35, maxHz = 400) {
  const stride = Math.max(1, Math.floor(sampleRate / 4000));
  const rate = sampleRate / stride;
  const n = Math.floor(input.length / stride);
  const data = new Float64Array(n);
  let mean = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < stride; j++) data[i] += input[i * stride + j] / stride;
    mean += data[i] / n;
  }
  let energy = 0;
  for (let i = 0; i < n; i++) { data[i] -= mean; energy += data[i] ** 2; }
  const rms = Math.sqrt(energy / n);
  if (rms < 0.001) return null;
  const lo = Math.max(2, Math.floor(rate / maxHz));
  const hi = Math.min(Math.ceil(rate / minHz), Math.floor(n / 2) - 1);
  const corr = new Float64Array(hi + 2);
  for (let lag = lo - 1; lag <= hi + 1; lag++) {
    let cross = 0, a = 0, b = 0;
    for (let i = 0; i < n - lag; i++) {
      cross += data[i] * data[i + lag];
      a += data[i] ** 2;
      b += data[i + lag] ** 2;
    }
    corr[lag] = cross / Math.sqrt(a * b || 1);
  }
  const peaks = [];
  for (let lag = lo; lag <= hi; lag++) {
    if (corr[lag] > corr[lag - 1] && corr[lag] >= corr[lag + 1]) peaks.push(lag);
  }
  if (!peaks.length) return null;
  const best = Math.max(...peaks.map(lag => corr[lag]));
  if (best < 0.8) return null;
  const lag = peaks.find(lag => corr[lag] >= Math.max(0.8, best * 0.94));
  const left = corr[lag - 1], mid = corr[lag], right = corr[lag + 1];
  const offset = 0.5 * (left - right) / (left - 2 * mid + right || 1);
  const hz = rate / (lag + offset);
  return hz >= minHz && hz <= maxHz ? {hz, confidence: mid, rms} : null;
}

export function targetForSpan(reference, span) { return reference * 150 / span; }
export function normalizedHz(hz, span) { return hz * span / 150; }
