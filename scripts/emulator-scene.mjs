/**
 * Launch the Android emulator with coffee-leaf photos in its virtual 3D scene,
 * so the scan tab's back camera can "see" real leaves.
 *
 * The emulator's virtual scene has two picture slots: a poster on the wall and
 * one lying on the table. They're set at launch (-virtualscene-poster), and can
 * be swapped live in Extended controls (…) → Camera → Virtual scene images.
 *
 * Usage:
 *   node scripts/emulator-scene.mjs --wall <sick.jpg> --table <healthy.jpg> [--avd Pixel_6]
 *
 * Use held-out (validation) images, padded to square so the whole leaf shows —
 * see TRAINING.md → "Testing in the emulator's virtual scene".
 * The AVD needs hw.camera.back=virtualscene (the default for new AVDs).
 *
 * In the emulator: hold Alt (Option on macOS) and use W/A/S/D + mouse to walk
 * up to a poster until the leaf fills the camera frame.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, a, i, all) => (a.startsWith('--') ? [...pairs, [a.slice(2), all[i + 1]]] : pairs), []),
);

const sdk =
  process.env.ANDROID_HOME ??
  process.env.ANDROID_SDK_ROOT ??
  (process.platform === 'win32'
    ? path.join(process.env.LOCALAPPDATA ?? '', 'Android', 'Sdk')
    : process.platform === 'darwin'
      ? path.join(homedir(), 'Library', 'Android', 'sdk')
      : path.join(homedir(), 'Android', 'Sdk'));
const emulator = path.join(sdk, 'emulator', process.platform === 'win32' ? 'emulator.exe' : 'emulator');

if (!existsSync(emulator)) {
  console.error(`Emulator not found at ${emulator}. Set ANDROID_HOME.`);
  process.exit(1);
}

const avd = args.avd ?? 'Pixel_6';
const cmd = ['-avd', avd, '-camera-back', 'virtualscene'];
for (const slot of ['wall', 'table']) {
  if (!args[slot]) continue;
  const file = path.resolve(args[slot]);
  if (!existsSync(file)) {
    console.error(`--${slot}: file not found: ${file}`);
    process.exit(1);
  }
  cmd.push('-virtualscene-poster', `${slot}=${file}`);
}

console.log(`${emulator} ${cmd.join(' ')}`);
spawn(emulator, cmd, { detached: true, stdio: 'ignore' }).unref();
