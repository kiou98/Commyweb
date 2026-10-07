import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

const sourceLogotype = 'C:/Users/vince/.gemini/antigravity/brain/9cc62c9e-21ab-4142-bf71-8729ced62586/.user_uploaded/media_1791410948475.png';
const iconsDir = path.resolve('icons');

async function processLogotype() {
  console.log('Processing full logotype from:', sourceLogotype);

  const img = sharp(sourceLogotype);
  const { width, height } = await img.metadata();

  const rawBuffer = await img.ensureAlpha().raw().toBuffer();
  const channels = 4;

  // Make near-white transparent & force black text for crisp vector-like quality
  for (let i = 0; i < rawBuffer.length; i += channels) {
    const r = rawBuffer[i];
    const g = rawBuffer[i + 1];
    const b = rawBuffer[i + 2];

    if (r > 230 && g > 230 && b > 230) {
      rawBuffer[i + 3] = 0; // Transparent
    } else {
      rawBuffer[i] = 0;
      rawBuffer[i + 1] = 0;
      rawBuffer[i + 2] = 0;
    }
  }

  const cleanLogotype = sharp(rawBuffer, {
    raw: { width: width || 1200, height: height || 400, channels: 4 }
  }).trim(); // Trim transparent borders for perfect padding

  // Save clean full logotype
  await cleanLogotype.clone().png().toFile(path.join(iconsDir, 'logotype.png'));
  console.log('Saved icons/logotype.png');
}

processLogotype().catch(console.error);
