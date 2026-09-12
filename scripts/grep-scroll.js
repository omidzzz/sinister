const fs = require("fs");
const css = fs.readFileSync("src/app/globals.css", "utf8");
const lines = css.split(/\r?\n/);
for (let i = 0; i < lines.length; i++) {
  const t = lines[i];
  if (/overflow|max-height|chat-scroll|chat-body|chat-msg/.test(t)) {
    console.log((i + 1) + "| " + t);
  }
}
console.log("--- page.tsx message containers ---");
const chat = fs.readFileSync("src/app/page.tsx", "utf8");
const clines = chat.split(/\r?\n/);
for (let i = 0; i < clines.length; i++) {
  const t = clines[i];
  if (/className=\{?["']chat-/.test(t)) console.log((i + 1) + "| " + t.trim());
}