// Network changes are restricted to a disposable GitHub-hosted Mac, never H00.
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { EventEmitter, once } from 'node:events';
import path from 'node:path';

if (process.platform !== 'darwin' || process.env.GITHUB_ACTIONS !== 'true'
  || process.env.RUNNER_ENVIRONMENT !== 'github-hosted' || process.env.RUNNER_OS !== 'macOS') {
  throw new Error('Offline iOS verification requires a disposable GitHub-hosted Mac.');
}
const run = promisify(execFile);
const command = (file, args, timeout = 60000) => run(file, args, { timeout, maxBuffer: 4 * 1024 * 1024 });
const root = path.resolve(process.argv[2] ?? 'test-results/ios-offline-ocr');
await mkdir(root, { recursive: true });
await command('sudo', ['-n', 'true']);
const sdk = (await command('xcrun', ['--sdk', 'iphonesimulator', '--show-sdk-path'])).stdout.trim();
const arch = process.arch === 'arm64' ? 'arm64' : 'x86_64';
const binary = path.join(root, 'apple-ocr-checks');
await command('xcrun', ['--sdk', 'iphonesimulator', 'swiftc', '-warnings-as-errors', '-swift-version', '5',
  '-D', 'MLEARN_OCR_CHECKS',
  '-target', `${arch}-apple-ios18.0-simulator`, '-sdk', sdk,
  '-module-cache-path', path.join(process.env.RUNNER_TEMP, 'mlearn-ios-ocr-module-cache'),
  'apps/client/modules/mlearn-native/ios/AppleOcrProvider.swift',
  'tests/mobile/ocr/AppleOcrChecks.swift', '-o', binary], 180000);
const runtimes = JSON.parse((await command('xcrun', ['simctl', 'list', 'runtimes', '-j'])).stdout).runtimes
  .filter(runtime => runtime.isAvailable && runtime.identifier.includes('.iOS-'))
  .sort((a, b) => b.version.localeCompare(a.version, 'en', { numeric: true }));
if (!runtimes.length) throw new Error('No installed iOS runtime');
await writeFile(path.join(root, 'environment.json'), JSON.stringify({
  sdk, arch, node: process.version, runtime: runtimes[0].identifier,
  runtimeVersion: runtimes[0].version, runtimeBuild: runtimes[0].buildversion,
}, null, 2));
const device = (await command('xcrun', ['simctl', 'create', `mLearn offline OCR ${process.env.GITHUB_RUN_ID}`,
  'com.apple.CoreSimulator.SimDeviceType.iPhone-16', runtimes[0].identifier])).stdout.trim();
const disabled = [];
try {
  await command('xcrun', ['simctl', 'boot', device]);
  await command('xcrun', ['simctl', 'bootstatus', device, '-b'], 180000);
  const listing = (await command('/usr/sbin/networksetup', ['-listallnetworkservices'])).stdout;
  const services = listing.trim().split('\n').slice(1).filter(service => service && !service.startsWith('*'));
  if (!services.length) throw new Error('No enabled network service to disconnect');
  await writeFile(path.join(root, 'network-services.txt'), listing);
  const events = new EventEmitter();
  const ready = once(events, 'ready');
  const offline = once(events, 'offline');
  const verified = once(events, 'verified');
  const child = spawn('xcrun', ['simctl', 'spawn', device, binary,
    path.resolve('tests/fixtures/ocr/vision'), path.join(root, 'provider-results.json')],
  { signal: AbortSignal.timeout(120000), stdio: ['ignore', 'pipe', 'pipe'] });
  const stop = () => { child.kill(); };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  let log = '';
  const lines = createInterface({ input: child.stdout });
  lines.on('line', line => {
    log += `${line}\n`;
    if (line === 'IOS_OCR_READY_FOR_OFFLINE') events.emit('ready');
    if (line === 'IOS_OCR_OFFLINE_CONFIRMED') events.emit('offline');
    if (line === 'IOS_OFFLINE_OCR_VERIFIED') events.emit('verified');
  });
  child.stderr.on('data', data => { log += data.toString(); });
  const completed = once(child, 'close').then(([code, signal]) => {
    if (code !== 0) throw new Error(`iOS provider check failed: ${code ?? signal}\n${log}`);
  });
  try {
    try {
      await Promise.race([ready, completed.then(() => { throw new Error('Missing online readiness'); })]);
      for (const service of services) {
        disabled.push(service);
        await command('sudo', ['-n', '/usr/sbin/networksetup', '-setnetworkserviceenabled', service, 'off'], 10000);
      }
      await Promise.race([offline, completed.then(() => { throw new Error('Missing offline confirmation'); })]);
      await writeFile(path.join(root, 'offline-network.txt'), (await command('/usr/sbin/scutil', ['--nwi'])).stdout);
      await Promise.race([verified, completed.then(() => { throw new Error('Missing offline verification'); })]);
    } finally {
      await Promise.all(disabled.map(service =>
        command('sudo', ['-n', '/usr/sbin/networksetup', '-setnetworkserviceenabled', service, 'on'], 10000)));
    }
    await completed;
    await writeFile(path.join(root, 'restored-network.txt'), (await command('/usr/sbin/scutil', ['--nwi'])).stdout);
  } finally {
    process.removeListener('SIGTERM', stop);
    process.removeListener('SIGINT', stop);
    child.kill();
    lines.close();
    await writeFile(path.join(root, 'provider-run.log'), log);
  }
} finally {
  try { await command('xcrun', ['simctl', 'shutdown', device]); }
  finally { await command('xcrun', ['simctl', 'delete', device]); }
}
