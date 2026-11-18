// Khronos glTF Validator over GLB files. Usage: node validate.mjs <file.glb>...
// Prints one JSON line per file {file, errors, warnings, messages}; exits 1 when any file has an
// error or a warning (infos and hints are ignored), 2 on usage errors.
import fs from "fs";
import path from "path";
import validator from "gltf-validator";

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("usage: node validate.mjs <file.glb>...");
  process.exit(2);
}
let bad = false;
for (const f of files) {
  const r = await validator.validateBytes(new Uint8Array(fs.readFileSync(f)), { uri: path.basename(f) });
  const messages = r.issues.messages.filter((m) => m.severity <= 1).map((m) => `${m.code} ${m.pointer}: ${m.message}`);
  if (r.issues.numErrors || r.issues.numWarnings) bad = true;
  console.log(JSON.stringify({ file: f, errors: r.issues.numErrors, warnings: r.issues.numWarnings, messages }));
}
process.exit(bad ? 1 : 0);
