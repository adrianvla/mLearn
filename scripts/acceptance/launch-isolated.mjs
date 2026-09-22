#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const MARKER_NAME = '.mlearn-acceptance-profile.json';
const PROFILE_PREFIX = 'mlearn-acceptance-';

function fail(message) {
  console.error(message);
  process.exit(2);
}

function createProfile() {
  const profile = mkdtempSync(path.join(os.tmpdir(), PROFILE_PREFIX));
  writeFileSync(path.join(profile, MARKER_NAME), JSON.stringify({
    schemaVersion: 1,
    id: randomUUID(),
    createdAt: new Date().toISOString(),
  }, null, 2));
  return realpathSync(profile);
}

function validateProfile(candidate) {
  const profile = path.resolve(candidate);
  if (!existsSync(profile) || !statSync(profile).isDirectory()) {
    fail(`Acceptance profile does not exist: ${profile}`);
  }

  const realProfile = realpathSync(profile);
  if (realProfile !== profile || path.basename(realProfile).startsWith(PROFILE_PREFIX) === false) {
    fail('Acceptance profile must be a real mLearn acceptance directory under the system temporary directory.');
  }

  const tempRoot = realpathSync(os.tmpdir());
  const relative = path.relative(tempRoot, realProfile);
  if (relative === '' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    fail('Acceptance profile is outside the system temporary directory.');
  }

  let marker;
  try {
    marker = JSON.parse(readFileSync(path.join(realProfile, MARKER_NAME), 'utf8'));
  } catch {
    fail('Acceptance profile marker is missing or invalid.');
  }
  if (marker?.schemaVersion !== 1 || typeof marker.id !== 'string') {
    fail('Acceptance profile marker is not recognized.');
  }
  return realProfile;
}

function parseArguments(args) {
  const separator = args.indexOf('--');
  const ownArgs = separator === -1 ? args : args.slice(0, separator);
  const childArgs = separator === -1 ? [] : args.slice(separator + 1);
  let executable;
  let profile;

  for (let index = 0; index < ownArgs.length; index += 1) {
    const arg = ownArgs[index];
    if (arg === '--profile') {
      profile = ownArgs[index + 1];
      if (!profile) fail('--profile requires a path previously printed by this launcher.');
      index += 1;
    } else if (arg.startsWith('-')) {
      fail(`Unknown option: ${arg}`);
    } else if (executable === undefined) {
      executable = arg;
    } else {
      fail('Pass application arguments after --.');
    }
  }

  if (!executable) {
    fail('Usage: node scripts/acceptance/launch-isolated.mjs /path/to/mLearn [--profile /tmp/mlearn-acceptance-…] [-- app-args]');
  }

  const resolvedExecutable = path.resolve(executable);
  if (!existsSync(resolvedExecutable) || !statSync(resolvedExecutable).isFile()) {
    fail(`Packaged application executable not found: ${resolvedExecutable}`);
  }
  return {
    executable: resolvedExecutable,
    childArgs,
    profile: profile ? validateProfile(profile) : createProfile(),
  };
}

const { executable, childArgs, profile } = parseArguments(process.argv.slice(2));
console.log(`ISOLATED_MLEARN_USER_DATA=${profile}`);

const child = spawn(executable, childArgs, {
  cwd: path.dirname(executable),
  env: { ...process.env, MLEARN_USER_DATA: profile },
  stdio: 'inherit',
});

child.on('error', (error) => {
  console.error(`Could not launch packaged mLearn: ${error.message}`);
  process.exitCode = 1;
});
child.on('exit', (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
