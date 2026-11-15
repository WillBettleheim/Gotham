// Residents drawn as small pixel-art people: realistic proportions, outlines and shading,
// faces, hairstyles, job outfits and props for what they're doing.
import { T } from "./map.js";

const OUTLINE = "rgba(28,18,16,0.85)";
function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const c = (v) => Math.max(0, Math.min(255, v + amt));
  return `rgb(${c(n >> 16)},${c((n >> 8) & 255)},${c(n & 255)})`;
}
const hash = (s) => { let h = 0; for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) | 0; return Math.abs(h); };

export function outfitFor(res) {
  const p = res.work?.place;
  return { police: "police", clinic: "doctor", cafe: "chef", bakery: "chef", garden: "farmer", bank: "suit", townhall: "suit", school: "teacher", library: "teacher", post: "postal", store: "apron", market: "apron" }[p] ?? "casual";
}

function rect(ctx, x, y, w, h, fill, outline = true) {
  ctx.fillStyle = fill; ctx.fillRect(x, y, w, h);
  if (outline) { ctx.strokeStyle = OUTLINE; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1); }
}
function rrect(ctx, x, y, w, h, r, fill, outline = true) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  ctx.fillStyle = fill; ctx.fill();
  if (outline) { ctx.strokeStyle = OUTLINE; ctx.lineWidth = 1; ctx.stroke(); }
}

export function drawCharacter(ctx, a, time) {
  const L = a.res.look, outfit = outfitFor(a.res);
  const h = hash(a.res.id);
  const skirt = L.skirt ?? (h % 10 < 3 && outfit === "casual");
  const px = Math.round((a.x + 0.5) * T), py = Math.round((a.y + 0.5) * T + 12);
  const moving = a.state === "walking";
  const ph = moving ? Math.sin(time * 10 + a.seed) : 0;
  const bob = moving ? Math.abs(Math.cos(time * 10 + a.seed)) * 1.2 : Math.sin(time * 2 + a.seed) * 0.4;
  const f = a.facing, side = f === "left" ? -1 : f === "right" ? 1 : 0, back = f === "up";
  const doing = a.doing;

  // shadow
  ctx.fillStyle = "rgba(0,0,0,0.28)";
  ctx.beginPath(); ctx.ellipse(px, py + 1, 9, 3.2, 0, 0, Math.PI * 2); ctx.fill();

  // ----- legs & shoes -----
  const legTop = py - 13 - bob, legH = 12;
  const pants = outfit === "police" ? "#25335a" : outfit === "suit" ? "#2d2f3a" : outfit === "farmer" ? "#3f5f9e" : L.pants;
  const step = ph * 2.2;
  const legs = side ? [[-2, step], [1, -step]] : [[-4, ph > 0 ? -ph * 2 : 0], [1, ph < 0 ? ph * 2 : 0]];
  for (const [lx, ly] of legs) {
    const x = px + lx + (side ? ly * side * 0.6 : 0);
    rect(ctx, Math.round(x), Math.round(legTop + Math.min(0, ly)), 4, legH - Math.abs(Math.min(0, ly)) * 0.3, pants);
    ctx.fillStyle = shade(pants.startsWith("#") ? pants : "#333333", -25); ctx.fillRect(Math.round(x) + 3, Math.round(legTop + 2), 1, legH - 4);
    rect(ctx, Math.round(x) - (side < 0 ? 1 : 0), Math.round(py - 3 + Math.min(0, ly) * 0.5), side ? 6 : 5, 3, outfit === "police" || outfit === "suit" ? "#111114" : "#3a2a22");
  }
  if (skirt) {
    ctx.fillStyle = L.pants; ctx.beginPath();
    ctx.moveTo(px - 6, legTop - 1); ctx.lineTo(px + 6, legTop - 1); ctx.lineTo(px + 8, legTop + 7); ctx.lineTo(px - 8, legTop + 7); ctx.closePath();
    ctx.fill(); ctx.strokeStyle = OUTLINE; ctx.stroke();
  }

  // ----- torso -----
  const tTop = py - 26 - bob, tH = 14, tW = side ? 10 : 13, tx = px - tW / 2;
  let shirt = L.shirt;
  if (outfit === "police") shirt = "#2f4a8a";
  if (outfit === "doctor") shirt = "#7fb7d9";
  if (outfit === "postal") shirt = "#3d6fb6";
  if (outfit === "suit") shirt = "#e9e6df";
  rrect(ctx, tx, tTop, tW, tH, 3, shirt);
  ctx.fillStyle = "rgba(0,0,0,0.14)"; ctx.fillRect(tx + tW - 4, tTop + 2, 3, tH - 3);             // side shade
  ctx.fillStyle = "rgba(255,255,255,0.18)"; ctx.fillRect(tx + 2, tTop + 2, 2, tH - 5);              // highlight
  // outfit layers
  if (outfit === "doctor" || outfit === "teacher") {
    const coat = outfit === "doctor" ? "#f6f7fb" : shade(L.shirt, -45);
    rrect(ctx, tx - 1, tTop - 0.5, tW + 2, tH + (outfit === "doctor" ? 7 : 1), 3, coat);
    if (!back) { ctx.fillStyle = shirt; ctx.fillRect(px - 2, tTop + 1, 4, tH - 2); }
    if (outfit === "doctor" && !back) { ctx.strokeStyle = "#3b3b48"; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(px, tTop + 4, 4, 0.2, Math.PI - 0.2); ctx.stroke(); }
  }
  if (outfit === "suit") {
    rrect(ctx, tx - 0.5, tTop, tW + 1, tH, 3, "#2d2f3a");
    if (!back) {
      ctx.fillStyle = "#e9e6df"; ctx.beginPath(); ctx.moveTo(px - 3, tTop); ctx.lineTo(px + 3, tTop); ctx.lineTo(px, tTop + 7); ctx.fill();
      ctx.fillStyle = a.res.work?.place === "townhall" ? "#2f6db3" : "#b8322d"; ctx.fillRect(px - 1, tTop + 1, 2, 7);
    }
  }
  if ((outfit === "chef" || outfit === "apron") && !back) {
    const ap = outfit === "chef" ? "#fbf8f2" : "#7a5230";
    rrect(ctx, px - 5, tTop + 4, 10, tH + 4, 2, ap);
    ctx.fillStyle = ap; ctx.fillRect(px - 3, tTop, 6, 5);
  }
  if (outfit === "farmer" && !back) {
    rect(ctx, px - 4.5, tTop + 4, 9, tH - 3, "#3f5f9e");
    ctx.fillStyle = "#3f5f9e"; ctx.fillRect(px - 4, tTop, 2, 5); ctx.fillRect(px + 2, tTop, 2, 5);
    ctx.fillStyle = "#e8c35a"; ctx.fillRect(px - 4, tTop + 4, 1, 1); ctx.fillRect(px + 3, tTop + 4, 1, 1);
  }
  if (outfit === "police" && !back) {
    ctx.fillStyle = "#e8b83a"; ctx.fillRect(px + 2, tTop + 3, 2, 3);
    ctx.fillStyle = "#1c2a50"; ctx.fillRect(tx, tTop + tH - 3, tW, 2);
  }
  if (outfit === "postal") {
    ctx.strokeStyle = "#6b4427"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(tx + 1, tTop + 1); ctx.lineTo(tx + tW - 1, tTop + tH - 2); ctx.stroke();
    rect(ctx, px + (side >= 0 ? 4 : -9), tTop + tH - 5, 6, 6, "#8b5a32");
  }
  if (a.isMayor && !back) { ctx.fillStyle = "#c62f3a"; ctx.beginPath(); ctx.moveTo(tx, tTop + 1); ctx.lineTo(tx + 3, tTop + 1); ctx.lineTo(tx + tW, tTop + tH - 1); ctx.lineTo(tx + tW - 3, tTop + tH - 1); ctx.fill(); ctx.fillStyle = "#f2c94c"; ctx.fillRect(px - 1, tTop + 6, 2, 2); }

  // ----- arms -----
  const swing = moving ? ph * 2.5 : a.state === "talking" && a.speaking ? Math.sin(time * 7) * 1.5 : 0;
  const sleeve = outfit === "doctor" ? "#f6f7fb" : outfit === "suit" ? "#2d2f3a" : outfit === "teacher" ? shade(L.shirt, -45) : shirt;
  const armL = side ? null : [tx - 3, tTop + 1 + swing];
  const armR = side ? [px + side * 2 - 1.5, tTop + 1 - swing] : [tx + tW - 0.5, tTop + 1 - swing];
  const holding = doing === "fish" || doing === "garden" || doing === "read" || doing === "shop";
  for (const arm of [armL, armR]) {
    if (!arm) continue;
    let [ax, ay] = arm;
    if (holding && arm === armR && !back) { ay = tTop + 3; }
    rrect(ctx, ax, ay, 3.5, 10, 1.5, sleeve);
    ctx.fillStyle = L.skin; ctx.fillRect(ax + 0.5, ay + 8.5, 2.5, 2.5);
  }

  // ----- head -----
  const hy = tTop - 7, hx = px + side * 0.5;
  ctx.fillStyle = L.skin; ctx.fillRect(px - 1.5, tTop - 2, 3, 3);                 // neck
  ctx.beginPath(); ctx.ellipse(hx, hy, 6.4, 7, 0, 0, Math.PI * 2); ctx.fillStyle = L.skin; ctx.fill();
  ctx.strokeStyle = OUTLINE; ctx.lineWidth = 1; ctx.stroke();
  ctx.fillStyle = "rgba(0,0,0,0.10)"; ctx.beginPath(); ctx.ellipse(hx + 1.5, hy + 2, 4.5, 4.5, 0, 0, Math.PI); ctx.fill();
  if (!back && !side) { ctx.fillStyle = L.skin; ctx.fillRect(hx - 7.2, hy - 0.5, 1.5, 3); ctx.fillRect(hx + 5.7, hy - 0.5, 1.5, 3); } // ears

  // face
  if (!back) {
    const ex = side * 2.5;
    const blink = Math.sin(time * 1.3 + a.seed * 5) > 0.97 || a.state === "sleeping";
    ctx.fillStyle = "#24170f";
    const eyes = side ? [hx + ex + side * 1] : [hx - 2.6, hx + 2.6];
    for (const x of eyes) {
      if (blink) ctx.fillRect(x - 1, hy + 0.5, 2, 1);
      else { ctx.fillRect(x - 1, hy - 0.5, 2, 2.5); ctx.fillStyle = "rgba(255,255,255,0.8)"; ctx.fillRect(x - 0.5, hy - 0.5, 1, 1); ctx.fillStyle = "#24170f"; }
    }
    ctx.fillStyle = shade(L.hair, -10);
    for (const x of eyes) ctx.fillRect(x - 1.5, hy - 2.6, 3, 0.9);                  // eyebrows
    ctx.fillStyle = "rgba(0,0,0,0.18)"; ctx.fillRect(hx + side * 4.5 - 0.5, hy + 2, 1, 1.5);   // nose
    ctx.fillStyle = "rgba(230,110,110,0.35)"; ctx.fillRect(hx - 5 + ex, hy + 2.2, 2, 1); ctx.fillRect(hx + 3 + ex, hy + 2.2, 2, 1);
    const talking = a.state === "talking" && a.speaking && Math.sin(time * 16) > 0;
    ctx.fillStyle = talking ? "#6a2a2a" : "rgba(90,40,40,0.75)";
    ctx.fillRect(hx - 1.2 + ex, hy + 4, 2.4, talking ? 1.8 : 0.9);
    if (outfit === "teacher" || (h % 7 === 0)) { ctx.strokeStyle = "#2b2b30"; ctx.lineWidth = 0.8; for (const x of eyes) ctx.strokeRect(x - 1.8, hy - 1.2, 3.6, 3); }
  }

  // hair
  const hair = L.hair, hl = shade(hair, 35);
  ctx.fillStyle = hair;
  const style = L.hairStyle;
  if (style !== "bald") {
    if (back) { ctx.beginPath(); ctx.ellipse(hx, hy - 0.5, 6.8, 7, 0, 0, Math.PI * 2); ctx.fill(); }
    else {
      ctx.beginPath(); ctx.ellipse(hx - side * 0.8, hy - 3, 6.8, 4.6, 0, Math.PI, Math.PI * 2); ctx.fill();
      ctx.fillRect(hx - 6.8, hy - 3.2, 13.6, 2.2);
      if (side) ctx.fillRect(hx - side * 6.8 - (side > 0 ? 0 : -0) - 1.5, hy - 3, 3.5, 6);
      else { ctx.fillRect(hx - 6.8, hy - 3, 1.8, 4); ctx.fillRect(hx + 5, hy - 3, 1.8, 4); }
    }
    if (style === "long" || style === "ponytail") { ctx.fillRect(hx - 7, hy - 1, 2.6, style === "long" ? 12 : 4); ctx.fillRect(hx + 4.4, hy - 1, 2.6, style === "long" ? 12 : 4); }
    if (style === "ponytail" && (back || side)) { ctx.fillRect(hx - side * 6 - 1.5, hy, 3, 9); }
    if (style === "bun") { ctx.beginPath(); ctx.arc(hx, hy - 7.5, 3.4, 0, Math.PI * 2); ctx.fill(); }
    if (style === "spiky") for (let i = -2; i <= 2; i++) { ctx.beginPath(); ctx.moveTo(hx + i * 2.6 - 1.6, hy - 5); ctx.lineTo(hx + i * 2.6, hy - 9.5); ctx.lineTo(hx + i * 2.6 + 1.6, hy - 5); ctx.fill(); }
    if (style === "curly") for (let i = -3; i <= 3; i++) { ctx.beginPath(); ctx.arc(hx + i * 2, hy - 5.5 + Math.abs(i) * 0.6, 2.2, 0, Math.PI * 2); ctx.fill(); }
    if (style === "bob" && !back) { ctx.fillRect(hx - 7, hy - 2, 2.6, 7); ctx.fillRect(hx + 4.4, hy - 2, 2.6, 7); }
    ctx.fillStyle = hl; ctx.fillRect(hx - 3 - side, hy - 6.6, 4, 1);                  // shine
  }

  // hats by job
  const hat = (fill, brim, top = 3.5) => {
    ctx.fillStyle = fill; ctx.beginPath(); ctx.ellipse(hx, hy - 5, 6.6, top, 0, Math.PI, Math.PI * 2); ctx.fill(); ctx.strokeStyle = OUTLINE; ctx.stroke();
    if (brim) { ctx.fillStyle = brim; ctx.fillRect(hx - (side < 0 ? 9 : side > 0 ? 1 : 7), hy - 5, side ? 8 : 14, 1.8); }
  };
  if (outfit === "police") { hat("#1f2e58", "#141c36", 4); ctx.fillStyle = "#e8b83a"; if (!back) ctx.fillRect(hx - 1, hy - 7.5, 2, 2); }
  if (outfit === "postal") hat("#2f5a9a", "#1f3d6a", 3.6);
  if (outfit === "farmer") { ctx.fillStyle = "#e4c46a"; ctx.beginPath(); ctx.ellipse(hx, hy - 4.6, 10, 2.4, 0, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = OUTLINE; ctx.stroke(); hat("#e4c46a", null, 4); ctx.fillStyle = "#b5462e"; ctx.fillRect(hx - 6, hy - 5.8, 12, 1.3); }
  if (outfit === "chef" && (a.res.work?.place === "bakery" || a.res.job?.toLowerCase().includes("chef"))) {
    rrect(ctx, hx - 5, hy - 13, 10, 8, 3, "#fbf8f2"); ctx.fillStyle = "#e9e3d6"; ctx.fillRect(hx - 5, hy - 6.5, 10, 1.5);
  }
  if (L.hairStyle === "cap" && outfit === "casual") hat(L.shirt, shade(L.shirt, -30), 3.6);

  // ----- props for what they're doing -----
  if (!back && a.state === "idle") {
    const hand = [px + (side || 1) * 7, tTop + 11];
    if (doing === "fish") {
      const dir = a.facing === "left" ? -1 : 1;
      const tipX = px + dir * 24, tipY = tTop - 14;
      ctx.strokeStyle = "#6b4427"; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(hand[0], hand[1]); ctx.lineTo(tipX, tipY); ctx.stroke();
      const bobY = tipY + 30 + Math.sin(time * 3 + a.seed) * 1.5 + (a.bite ? Math.sin(time * 30) * 2 : 0);
      ctx.strokeStyle = "rgba(240,240,240,0.8)"; ctx.lineWidth = 0.7; ctx.beginPath(); ctx.moveTo(tipX, tipY); ctx.lineTo(tipX + dir * 4, bobY); ctx.stroke();
      ctx.fillStyle = "#e5482f"; ctx.beginPath(); ctx.arc(tipX + dir * 4, bobY, 1.8, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#fff"; ctx.fillRect(tipX + dir * 4 - 1, bobY - 1.8, 2, 1);
    } else if (doing === "garden") {
      rect(ctx, hand[0] - 2, hand[1] - 2, 7, 5, "#5f8fb0"); ctx.fillStyle = "#5f8fb0"; ctx.fillRect(hand[0] + 5, hand[1] - 3, 4, 1.5);
      if (Math.sin(time * 4) > 0) { ctx.fillStyle = "rgba(150,210,255,0.8)"; ctx.fillRect(hand[0] + 9, hand[1] - 1, 1, 2); ctx.fillRect(hand[0] + 10, hand[1] + 2, 1, 2); }
    } else if (doing === "read") {
      rect(ctx, px - 4, tTop + 6, 8, 6, "#8e3b2f"); ctx.fillStyle = "#f3ead8"; ctx.fillRect(px - 3, tTop + 7, 6, 4); ctx.fillStyle = "#8e3b2f"; ctx.fillRect(px - 0.5, tTop + 7, 1, 4);
    } else if (doing === "shop") {
      ctx.strokeStyle = "#7a4f2a"; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(hand[0] + 2, hand[1], 3.5, Math.PI, 0); ctx.stroke();
      rect(ctx, hand[0] - 2, hand[1], 8, 5, "#b5824a"); ctx.fillStyle = "#e5482f"; ctx.fillRect(hand[0], hand[1] - 1, 2, 2); ctx.fillStyle = "#8fd16a"; ctx.fillRect(hand[0] + 3, hand[1] - 1, 2, 2);
    }
  }
}

export function drawPortrait(canvas, res) {
  const ctx = canvas.getContext("2d");
  const s = canvas.width / 36;
  ctx.setTransform(s, 0, 0, s, 0, 0);
  ctx.clearRect(0, 0, 36, 36);
  // frame the head and shoulders
  const fake = { res, x: 18 / T - 0.5, y: (44 - 12) / T - 0.5, seed: 0, state: "idle", facing: "down" };
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
