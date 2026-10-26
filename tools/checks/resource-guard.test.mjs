import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateResources, ResourceMeasurementError } from '../resource-guard.mjs';

const GiB = 1024 ** 3;
const MiB = 1024 ** 2;
function samples(overrides = {}) {
  return [0, 1, 2].map(index => ({ pid: 82251, timeMs: 1000 + index * 5000,
    physicalFootprintBytes: 1936 * MiB, rssBytes: 4832288 * 1024,
    totalBytes: 16 * GiB, availableBytes: 7 * GiB, pressureLevel: 1,
    swapUsedBytes: 3574 * MiB, swapOutBytes: 15 * GiB, ...overrides }));
}

test('high RSS and allocated but stable swap do not reject a healthy host', () => {
  const result = evaluateResources(samples(), GiB);
  assert.equal(result.safe, true);
  assert.equal(result.sampled, true);
  assert.equal(result.projectedHeadroomBytes, 6 * GiB);
});

test('current physical footprint above the former fixed cap can fit safely', () => {
  const result = evaluateResources(samples({ physicalFootprintBytes: 4 * GiB }), GiB);
  assert.equal(result.safe, true);
});

test('warning and critical pressure reject even with nominal available memory', () => {
  for (const pressureLevel of [2, 4])
    assert.deepEqual(evaluateResources(samples({ pressureLevel }), GiB).reasons, ['host_pressure']);
});

test('a workload that would consume the host reserve is rejected', () => {
  const result = evaluateResources(samples({ availableBytes: 5 * GiB }), 2 * GiB);
  assert.equal(result.safe, false);
  assert.deepEqual(result.reasons, ['projected_headroom']);
});

test('guard does not count an already allocated workload a second time', () => {
  assert.equal(evaluateResources(samples({ availableBytes: 4 * GiB }), 0).safe, true);
});

test('sustained footprint growth is projected against remaining host headroom', () => {
  const readings = samples({ availableBytes: 6 * GiB });
  readings.forEach((sample, index) => { sample.physicalFootprintBytes += index * GiB; });
  const result = evaluateResources(readings, GiB);
  assert.equal(result.growthBytes, 2 * GiB);
  assert.deepEqual(result.reasons, ['projected_headroom']);
});

test('one footprint spike is not treated as sustained future growth', () => {
  const readings = samples();
  readings[1].physicalFootprintBytes += GiB;
  readings[2].physicalFootprintBytes += GiB;
  assert.equal(evaluateResources(readings, GiB).growthBytes, 0);
});

test('ongoing swap allocation and traffic reject a launch without stressing the host', () => {
  const readings = samples();
  readings.forEach((sample, index) => {
    sample.swapUsedBytes += index * 64 * MiB;
    sample.swapOutBytes += index * 128 * MiB;
  });
  assert.deepEqual(evaluateResources(readings, GiB).reasons, ['sustained_swap_growth']);
  readings[2].swapUsedBytes = readings[1].swapUsedBytes;
  assert.equal(evaluateResources(readings, GiB).safe, true);
});

test('missing or inconsistent process metrics fail closed', () => {
  for (const readings of [
    samples({ physicalFootprintBytes: undefined }), samples({ pressureLevel: 0 }),
    samples().map((sample, index) => ({ ...sample, pid: index ? 99 : 82251 })),
    samples().map(sample => ({ ...sample, timeMs: 1000 })),
  ]) assert.throws(() => evaluateResources(readings, GiB), ResourceMeasurementError);
  assert.equal(evaluateResources(samples().slice(0, 1), GiB).sampled, false);
});
