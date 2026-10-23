const path = require('node:path');
const fs = require('node:fs/promises');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');
const requireLauncher = createRequire(path.resolve(__dirname, '../launcher/package.json'));
async function main() {
  const sharp = requireLauncher('sharp');
  const pngToIco = (await import(pathToFileURL(requireLauncher.resolve('png-to-ico')).href)).default;
  const output = path.resolve(__dirname, '../launcher/assets');
  await fs.mkdir(output, { recursive: true });
  const svg = await fs.readFile(path.resolve(__dirname, '../launcher/renderer/logo.svg'));
  const png = await sharp(svg).resize(512, 512).png().toBuffer();
  await fs.writeFile(path.join(output, 'unx.png'), png);
  await fs.writeFile(path.join(output, 'unx.ico'), await pngToIco(png));
  console.log('Prepared the UnX Manager application icons.');
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
