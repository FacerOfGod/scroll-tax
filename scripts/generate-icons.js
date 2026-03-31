#!/usr/bin/env node
/**
 * Generates Android app icons from assets/icon.svg
 * Run: node scripts/generate-icons.js
 * Requires: npm install --save-dev sharp
 */

const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const SRC_SVG = path.join(ROOT, 'assets', 'icon.svg');

const ANDROID_SIZES = [
  { dir: 'mipmap-mdpi',    size: 48  },
  { dir: 'mipmap-hdpi',    size: 72  },
  { dir: 'mipmap-xhdpi',   size: 96  },
  { dir: 'mipmap-xxhdpi',  size: 144 },
  { dir: 'mipmap-xxxhdpi', size: 192 },
];

const ANDROID_RES = path.join(ROOT, 'android', 'app', 'src', 'main', 'res');

async function generateAndroid() {
  console.log('Generating Android icons...');
  for (const { dir, size } of ANDROID_SIZES) {
    const outDir = path.join(ANDROID_RES, dir);
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    for (const name of ['ic_launcher.png', 'ic_launcher_round.png']) {
      const outPath = path.join(outDir, name);
      await sharp(SRC_SVG)
        .resize(size, size)
        .png()
        .toFile(outPath);
      console.log(`  ${dir}/${name} (${size}x${size})`);
    }
  }
}

async function generatePreview() {
  const outPath = path.join(ROOT, 'assets', 'icon-preview.png');
  await sharp(SRC_SVG)
    .resize(512, 512)
    .png()
    .toFile(outPath);
  console.log(`\nPreview saved: assets/icon-preview.png`);
}

(async () => {
  try {
    await generateAndroid();
    await generatePreview();
    console.log('\nDone!');
  } catch (err) {
    console.error('Error:', err.message);
    console.error('\nMake sure sharp is installed: npm install --save-dev sharp');
    process.exit(1);
  }
})();
