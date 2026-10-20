import {test} from 'node:test';
import assert from 'node:assert/strict';
import {detectPitch, targetForSpan, normalizedHz, createPitchTracker, POLL_MS, WINDOW_SECONDS} from '../web/pitch.js';

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

for (const rate of [44100,48000]) {
  for (const hz of [40,55,110,140,350]) {
    for (const offset of [0,19,39]) {
      test(`short pluck ${hz} Hz at ${rate}, poll offset ${offset} ms`, () => {
        const tracker = createPitchTracker();
        let captured = null;
        for (let end = offset; end <= 240; end += POLL_MS) {
          const frame = Float32Array.from({length:Math.ceil(rate*WINDOW_SECONDS)}, (_, i) => {
            const t = end/1000 - WINDOW_SECONDS + i/rate;
            if (t < 0) return 0;
            const envelope = .15 * Math.min(1,t/.002) * Math.exp(-t/.06);
            return envelope * (Math.sin(2*Math.PI*hz*t) + .5*Math.sin(4*Math.PI*hz*t));
          });
          const value = tracker.update(detectPitch(frame,rate));
          if (value !== null) { captured = {value, end}; break; }
        }
        assert.ok(captured && captured.end <= 200, JSON.stringify(captured));
        assert.ok(Math.abs(captured.value/hz-1) < .025, JSON.stringify(captured));
      });
    }
  }
}
test('short-window noise does not produce a held reading', () => {
  const tracker = createPitchTracker();
  let seed = 73;
  for(let frame=0;frame<30;frame++) {
    const noise = Float32Array.from({length:5760}, () => {
      seed = (Math.imul(seed,1664525)+1013904223)>>>0;
      return (seed/4294967296-.5)*.1;
    });
    assert.equal(tracker.update(detectPitch(noise,48000)),null);
  }
});
