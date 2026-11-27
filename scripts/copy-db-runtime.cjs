/**
 * Copy the synchronous Postgres bridge into the Next.js server output so the
 * worker can be found even when the process runs from a different cwd.
 */
"use strict";
const fs = require("fs");
const path = require("path");

const srcDir = path.join(process.cwd(), "server", "db");
const distDir = process.env.NEXT_DIST_DIR || ".next";
const destDir = path.join(process.cwd(), distDir, "server");

if (fs.existsSync(destDir)) {
  for (const file of ["postgres-worker.cjs", "sql-translate.cjs"]) {
    fs.copyFileSync(path.join(srcDir, file), path.join(destDir, file));
  }
  console.log(`Copied Postgres runtime files to ${destDir}`);
}
