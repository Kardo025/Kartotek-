// Copies the Vite output to ..\src\ and puts a licence banner on top (the minifier drops the packages' own notices).
// The full texts are in THIRD-PARTY-NOTICES.md at the repository root.
const fs = require("fs");
const path = require("path");

const banners = {
  "ui.js": "/*! Kartotek UI bundle. Kartotek: GNU AGPL v3 (AGPL-3.0-only). Bundled: React, React DOM, scheduler, Motion (framer-motion), Phosphor Icons (all MIT) and a trimmed copy of the stageshow kit (MIT, Benji Taylor). Licence texts and copyright lines: THIRD-PARTY-NOTICES.md in the repository. */\n",
  "ui.css": "/*! Kartotek UI styles. Kartotek: GNU AGPL v3 (AGPL-3.0-only). Includes Tailwind CSS (MIT) output and the Inter Variable font (SIL Open Font License 1.1, Copyright The Inter Project Authors). Licence texts and copyright lines: THIRD-PARTY-NOTICES.md in the repository. */\n",
};

function copy() {
  for (const name of Object.keys(banners)) {
    const from = path.join(__dirname, "..", "dist", name);
    const to = path.join(__dirname, "..", "..", "src", name);
    fs.writeFileSync(to, banners[name] + fs.readFileSync(from, "utf8"));
  }
  console.log("copied ui.js and ui.css to src\\ with licence banners");
}

module.exports = copy;
if (require.main === module) copy();
