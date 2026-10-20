import {test} from 'node:test';
import assert from 'node:assert/strict';
import {detectPitch, targetForSpan, normalizedHz} from '../web/pitch.js';

for (const rate of [44100, 48000]) {
  for (const hz of [40, 55, 66, 82.5, 110, 140, 220, 350]) {
    test(`${hz} Hz at ${rate} Hz sample rate`, () => {
      const signal = Float32Array.from({length:16384}, (_, i) =>
        .15 * Math.exp(-i / rate * 3) * (Math.sin(2*Math.PI*hz*i/rate) + .5*Math.sin(4*Math.PI*hz*i/rate)));
      const result = detectPitch(signal, rate);
      assert.ok(result && Math.abs(result.hz-hz)/hz < .015, JSON.stringify(result));
    });
  }
}
test('dominant second harmonic retains a detectable fundamental', () => {
  const signal = Float32Array.from({length:16384}, (_, i) =>
    .04*Math.sin(2*Math.PI*110*i/48000) + .12*Math.sin(4*Math.PI*110*i/48000));
  assert.ok(Math.abs(detectPitch(signal,48000).hz - 110) < 2);
});
test('silence and seeded broadband noise have no pitch', () => {
  assert.equal(detectPitch(new Float32Array(16384),48000), null);
  let seed = 42;
  const noise = Float32Array.from({length:16384}, () => {
    seed = (Math.imul(seed,1664525)+1013904223)>>>0;
    return (seed/4294967296-.5)*.1;
  });
  assert.equal(detectPitch(noise,48000), null);
});
test('span conversions preserve the reference', () => {
  assert.equal(targetForSpan(110,300),55);
  assert.equal(targetForSpan(140,150),140);
  assert.equal(normalizedHz(55,300),110);
});
