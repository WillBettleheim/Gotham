// Procedural chibi characters.
import { T } from "./map.js";

export function drawCharacter(ctx, a, time) {
  const L = a.res.look;
  const px = (a.x + 0.5) * T, py = (a.y + 0.5) * T + 10;
  const moving = a.state === "walking";
  const ph = moving ? Math.sin(time * 11 + a.seed) : 0;
  const bob = moving ? Math.abs(ph) * 1.6 : Math.sin(time * 2 + a.seed) * 0.6;
  const f = a.facing;

  ctx.fillStyle = "rgba(0,0,0,0.25)";
  ctx.beginPath(); ctx.ellipse(px, py, 9, 3.5, 0, 0, Math.PI * 2); ctx.fill();

  // legs
  ctx.fillStyle = L.pants;
  ctx.fillRect(px - 5, py - 7 - (ph > 0 ? ph * 2 : 0), 4, 7);
  ctx.fillRect(px + 1, py - 7 - (ph < 0 ? -ph * 2 : 0), 4, 7);
  ctx.fillStyle = "#3a2a22";
  ctx.fillRect(px - 5, py - 2 - (ph > 0 ? ph * 2 : 0), 4, 2);
  ctx.fillRect(px + 1, py - 2 - (ph < 0 ? -ph * 2 : 0), 4, 2);

  // body
  const by = py - 18 - bob;
  ctx.fillStyle = L.shirt;
  roundRect(ctx, px - 7, by, 14, 12, 4); ctx.fill();
  ctx.fillStyle = "rgba(0,0,0,0.12)"; ctx.fillRect(px - 7, by + 9, 14, 3);
  // arms
  ctx.fillStyle = L.skin;
  const sw = moving ? ph * 2 : a.state === "talking" ? Math.sin(time * 6 + a.seed) * 1.2 : 0;
  ctx.fillRect(px - 10, by + 2 + sw, 3, 8);
  ctx.fillRect(px + 7, by + 2 - sw, 3, 8);

  // head
  const hy = by - 7;
  ctx.fillStyle = L.skin;
  ctx.beginPath(); ctx.arc(px, hy, 8.5, 0, Math.PI * 2); ctx.fill();

  // hair
  ctx.fillStyle = L.hair;
  if (f === "up") {
    ctx.beginPath(); ctx.arc(px, hy, 9, 0, Math.PI * 2); ctx.fill();
  } else {
    ctx.beginPath(); ctx.arc(px, hy - 1, 9, Math.PI * 1.02, Math.PI * 1.98); ctx.fill();
    const side = f === "left" ? -1 : f === "right" ? 1 : 0;
    ctx.fillRect(px - 9 + (side > 0 ? 2 : 0), hy - 4, 18 - (side ? 2 : 0), 3);
    if (side) ctx.fillRect(px - side * 6 - 3, hy - 4, 6, 8);
  }
  if (L.hairStyle === "long") { ctx.fillRect(px - 9, hy - 2, 3, 11); ctx.fillRect(px + 6, hy - 2, 3, 11); }
  if (L.hairStyle === "bun") { ctx.beginPath(); ctx.arc(px, hy - 10, 4.5, 0, Math.PI * 2); ctx.fill(); }
  if (L.hairStyle === "spiky") { for (let i = -2; i <= 2; i++) { ctx.beginPath(); ctx.moveTo(px + i * 4 - 2, hy - 7); ctx.lineTo(px + i * 4, hy - 13); ctx.lineTo(px + i * 4 + 2, hy - 7); ctx.fill(); } }
  if (L.hairStyle === "cap") {
    ctx.fillStyle = L.shirt; ctx.beginPath(); ctx.arc(px, hy - 2, 9, Math.PI, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "rgba(0,0,0,0.2)"; ctx.fillRect(px - 9, hy - 3, 18, 2);
    if (f !== "up") { ctx.fillStyle = L.shirt; ctx.fillRect(f === "left" ? px - 13 : f === "right" ? px + 3 : px - 7, hy - 3, 10, 3); }
  }

  // face
  if (f !== "up") {
    const ex = f === "left" ? -3 : f === "right" ? 3 : 0;
    const blink = Math.sin(time * 1.3 + a.seed * 5) > 0.97;
    ctx.fillStyle = "#2a1d1a";
    if (blink) { ctx.fillRect(px - 4 + ex, hy + 1, 3, 1); ctx.fillRect(px + 2 + ex, hy + 1, 3, 1); }
    else { ctx.fillRect(px - 4 + ex, hy, 2, 3); ctx.fillRect(px + 2 + ex, hy, 2, 3); }
    ctx.fillStyle = "rgba(255,120,120,0.35)";
    ctx.fillRect(px - 7 + ex, hy + 3, 3, 2); ctx.fillRect(px + 4 + ex, hy + 3, 3, 2);
    if (a.state === "talking" && a.speaking) {
      const open = Math.sin(time * 18) > 0;
      ctx.fillStyle = "#7a3030"; ctx.fillRect(px - 1 + ex, hy + 5, 3, open ? 2 : 1);
    }
  }
}

export function drawPortrait(canvas, res) {
  const ctx = canvas.getContext("2d");
  const s = canvas.width / 32;
  ctx.setTransform(s, 0, 0, s, 0, 0);
  ctx.clearRect(0, 0, 32, 32);
  const fake = { res, x: 0, y: 0.25, seed: 0, state: "idle", facing: "down" };
  drawCharacter(ctx, fake, 0);
}

export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
