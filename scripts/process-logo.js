import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

const sourceImage = 'C:/Users/vince/.gemini/antigravity/brain/9cc62c9e-21ab-4142-bf71-8729ced62586/.user_uploaded/media_1791409788979.png';
const iconsDir = path.resolve('icons');

if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

async function processLogo() {
  console.log('Processing user logo from:', sourceImage);

  // Load the raw image
  const img = sharp(sourceImage);
  const { width, height } = await img.metadata();

  // Convert near-white background to transparent for crisp extension icon appearance
  const rawBuffer = await img.ensureAlpha().raw().toBuffer();
  const channels = 4;
  for (let i = 0; i < rawBuffer.length; i += channels) {
    const r = rawBuffer[i];
    const g = rawBuffer[i + 1];
    const b = rawBuffer[i + 2];
    // If pixel is white / light-gray background
    if (r > 235 && g > 235 && b > 235) {
      rawBuffer[i + 3] = 0; // set alpha to 0 (transparent)
    } else {
      // Force black foreground for pure monochrome DA
      rawBuffer[i] = 0;
      rawBuffer[i + 1] = 0;
      rawBuffer[i + 2] = 0;
    }
  }

  const cleanLogo = sharp(rawBuffer, {
    raw: { width: width || 1024, height: height || 1024, channels: 4 }
  });

  // Save master transparent logo
  await cleanLogo.clone().png().toFile(path.join(iconsDir, 'logo.png'));
  console.log('Saved icons/logo.png');

  // Generate icons 16, 48, 128
  for (const size of [16, 48, 128]) {
    await cleanLogo
      .clone()
      .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toFile(path.join(iconsDir, `icon${size}.png`));
    console.log(`Saved icons/icon${size}.png (${size}x${size})`);
  }

  console.log('All icons generated successfully with pure black & white DA!');
}

processLogo().catch(console.error);
