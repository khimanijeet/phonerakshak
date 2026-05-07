const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

async function testWatermark() {
  const inputPath = path.join(__dirname, 'test_input.png');
  const outputPath = path.join(__dirname, 'test_output.png');

  // Create a dummy image
  await sharp({
    create: {
      width: 400,
      height: 400,
      channels: 4,
      background: { r: 100, g: 100, b: 100, alpha: 1 }
    }
  }).png().toFile(inputPath);

  const deviceId = 'test-device-12345678';
  const timestampStr = new Date().toLocaleString();
  const locStr = 'Loc: 12.3456, 78.9012';
  const watermarkText = `PhoneRakshak | ${timestampStr} | ${locStr} | ID: ${deviceId.slice(0, 8)}`;

  const metadata = await sharp(inputPath).metadata();
  const w = metadata.width;
  const h = metadata.height;

  const svgText = `
    <svg width="${w}" height="${h}">
      <style>
        .text { fill: white; font-size: ${Math.floor(h * 0.03)}px; font-family: sans-serif; font-weight: bold; }
        .shadow { fill: black; font-size: ${Math.floor(h * 0.03)}px; font-family: sans-serif; font-weight: bold; opacity: 0.5; }
      </style>
      <text x="12" y="${h - 10}" class="shadow">${watermarkText}</text>
      <text x="10" y="${h - 12}" class="text">${watermarkText}</text>
    </svg>
  `;

  const buffer = await sharp(inputPath)
    .composite([{ input: Buffer.from(svgText), top: 0, left: 0 }])
    .toBuffer();

  fs.writeFileSync(outputPath, buffer);
  console.log('Test watermark created at:', outputPath);
}

testWatermark().catch(console.error);
