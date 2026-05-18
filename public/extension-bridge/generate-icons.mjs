/**
 * Generates PNG icons for Chrome extension from the SVG source.
 * Run: node generate-icons.mjs
 * Requires: npm install sharp (or run manually)
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Inline SVG as base — same robot design
const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">
  <rect width="128" height="128" rx="24" fill="#0f172a"/>
  <rect x="24" y="34" width="80" height="60" rx="16" fill="#1e293b" stroke="#06b6d4" stroke-width="4"/>
  <line x1="64" y1="34" x2="64" y2="16" stroke="#06b6d4" stroke-width="4"/>
  <circle cx="64" cy="12" r="6" fill="#3b82f6"/>
  <rect x="14" y="54" width="10" height="20" rx="4" fill="#06b6d4"/>
  <rect x="104" y="54" width="10" height="20" rx="4" fill="#06b6d4"/>
  <circle cx="44" cy="54" r="8" fill="#3b82f6"/>
  <circle cx="84" cy="54" r="8" fill="#3b82f6"/>
  <path d="M 44 76 Q 64 86 84 76" fill="none" stroke="#06b6d4" stroke-width="4" stroke-linecap="round"/>
</svg>`;

// Check if sharp is available
try {
  const sharp = (await import("sharp")).default;
  const sizes = [16, 48, 128];
  for (const size of sizes) {
    const buf = Buffer.from(svgContent);
    await sharp(buf).resize(size, size).png().toFile(path.join(__dirname, `icon${size}.png`));
    console.log(`✅ Generated icon${size}.png`);
  }
  console.log("✅ All icons generated successfully!");
} catch (e) {
  console.error("❌ sharp not available. Install with: npm install sharp");
  console.log("📝 Fallback: Copying SVG data as placeholder...");
  // Fallback: write raw SVG renamed to .png (will NOT work in Chrome, but won't crash build)
  // The user must manually convert SVG → PNG for actual Chrome loading
  console.log("👉 Please convert icon.svg to icon16.png, icon48.png, icon128.png manually");
  console.log("   Tool: https://cloudconvert.com/svg-to-png or Photoshop/GIMP");
}
