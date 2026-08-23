// Generates the mobile app's icon PNGs via headless Chromium (Playwright).
// Source of truth for the icon design — edit the SVG glyph here, re-run to
// regenerate mobile/assets/*.png. Not part of the app bundle itself.
import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, "..", "assets");
const storeDir = path.join(__dirname, "..", "store-assets"); // listing-only images, not bundled into the app
mkdirSync(outDir, { recursive: true });
mkdirSync(storeDir, { recursive: true });

const SKY = "#0EA5E9";
const WHITE = "#FFFFFF";

// A simple ledger/receipt glyph: a page with three ledger rows and a
// checkmark badge — reads clearly at both 1024px (store listing) and
// ~40px (home screen). Centered on a 1024x1024 viewBox.
function glyph({ docFill, lineFill, badgeFill, badgeStroke, checkStroke, scale = 1 }) {
  return `
    <g transform="translate(512 512) scale(${scale}) translate(-512 -512)">
      <rect x="292" y="180" width="440" height="600" rx="48" fill="${docFill}" />
      <rect x="340" y="300" width="344" height="32" rx="16" fill="${lineFill}" />
      <rect x="340" y="384" width="344" height="32" rx="16" fill="${lineFill}" />
      <rect x="340" y="468" width="220" height="32" rx="16" fill="${lineFill}" />
      <circle cx="692" cy="742" r="124" fill="${badgeFill}" stroke="${badgeStroke}" stroke-width="20" />
      <polyline points="648,746 682,780 750,690" fill="none" stroke="${checkStroke}"
        stroke-width="26" stroke-linecap="round" stroke-linejoin="round" />
    </g>`;
}

function page({ width, height, background, svgInner }) {
  return `<!doctype html><html><head><style>
    html,body{margin:0;padding:0;background:${background};}
    svg{display:block;}
  </style></head><body>
    <svg width="${width}" height="${height}" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
      ${svgInner}
    </svg>
  </body></html>`;
}

// Play Store feature graphic: 1024x500, icon + wordmark, not the square
// icon viewBox — a plain flex layout instead of the shared page() helper.
function featureGraphicHtml() {
  const iconSvg = `<svg width="360" height="360" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
    ${glyph({ docFill: WHITE, lineFill: SKY, badgeFill: SKY, badgeStroke: WHITE, checkStroke: WHITE })}
  </svg>`;
  return `<!doctype html><html><head><style>
    html,body{margin:0;padding:0;background:${SKY};width:1024px;height:500px;overflow:hidden;}
    .wrap{display:flex;align-items:center;gap:40px;width:1024px;height:500px;padding:0 56px;box-sizing:border-box;
      font-family:-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;}
    .text{color:${WHITE};}
    .title{font-size:64px;font-weight:800;letter-spacing:-1px;line-height:1.05;}
    .subtitle{font-size:28px;font-weight:500;opacity:0.92;margin-top:14px;}
  </style></head><body>
    <div class="wrap">
      ${iconSvg}
      <div class="text">
        <div class="title">Prime Accountax</div>
        <div class="subtitle">Receiving &middot; Production &middot; Shipping</div>
      </div>
    </div>
  </body></html>`;
}

const targets = [
  {
    file: "feature-graphic.png",
    width: 1024, height: 500,
    html: featureGraphicHtml(),
    store: true,
  },
  {
    file: "icon.png",
    width: 1024, height: 1024,
    background: SKY,
    transparent: false,
    svgInner: `<rect width="1024" height="1024" fill="${SKY}"/>` +
      glyph({ docFill: WHITE, lineFill: SKY, badgeFill: SKY, badgeStroke: WHITE, checkStroke: WHITE }),
  },
  {
    file: "android-icon-foreground.png",
    width: 1024, height: 1024,
    background: "transparent",
    transparent: true,
    svgInner: glyph({ docFill: WHITE, lineFill: SKY, badgeFill: SKY, badgeStroke: WHITE, checkStroke: WHITE, scale: 0.8 }),
  },
  {
    file: "android-icon-background.png",
    width: 1024, height: 1024,
    background: SKY,
    transparent: false,
    svgInner: `<rect width="1024" height="1024" fill="${SKY}"/>`,
  },
];

const browser = await chromium.launch();
for (const t of targets) {
  const page1 = await browser.newPage({ viewport: { width: t.width, height: t.height } });
  const html = t.html ?? page({ width: t.width, height: t.height, background: t.transparent ? "transparent" : t.background, svgInner: t.svgInner });
  await page1.setContent(html);
  const buf = await page1.screenshot({ omitBackground: !!t.transparent });
  writeFileSync(path.join(t.store ? storeDir : outDir, t.file), buf);
  console.log("wrote", t.file);
  await page1.close();
}
await browser.close();
