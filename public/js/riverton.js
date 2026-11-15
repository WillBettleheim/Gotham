// Riverton, the neighboring town down the east road: travel, trade, merchants and diplomacy.
import { RIVERTON_EXIT } from "./mapdata.js";
import { MODELS } from "./residents.js";

const clamp = (v, a = 0, b = 100) => Math.max(a, Math.min(b, v));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const NEWS = [
  "Riverton's mayor wants to build a bridge between our towns",
  "Riverton's bakery makes cinnamon rolls the size of your head",
  "there's a traveling circus camped outside Riverton",
  "Riverton just banned fishing on Sundays",
  "Riverton's harvest was poor this year, so they're paying well for vegetables",
  "a famous painter is visiting Riverton",
  "Riverton held an election and the results were a mess",
  "Riverton's river flooded last month and they're still rebuilding",
];
const MERCHANT_NAMES = ["Bram", "Oksana", "Tobias", "Marisol", "Dmitri", "Lucia", "Aurelio", "Wenna"];
const LOOKS = [
  { skin: "#e0ac7e", hair: "#3a2a1a", hairStyle: "cap", shirt: "#7a2f8f", pants: "#2b2b3a" },
  { skin: "#c68a62", hair: "#151515", hairStyle: "long", shirt: "#127a6b", pants: "#3a3020" },
  { skin: "#f1c7a5", hair: "#8b5a2b", hairStyle: "bun", shirt: "#b5651d", pants: "#2e3a4f" },
];

export class Riverton {
  constructor(society) {
    this.society = society;
    this.sim = society.sim;
    this.relations = 50;
    this.deal = false;
    this.merchant = null;   // { res, until, x, y }
    this.trips = 0;
    this.trade = 0;         // coins earned selling in Riverton
  }

  get priceBonus() { return this.deal ? 1.6 : 1.3; }

  // ----- council actions -----
  sendGift() {
    if (this.society.treasury < 50) return "The treasury needs 50 coins.";
    this.society.treasury -= 50; this.relations = clamp(this.relations + 12);
    this.society.log("🎁", "Gotham sent a gift of 50 coins to Riverton. Relations improved.", "law", true);
    return null;
  }
  signDeal() {
    if (this.deal) return "Gotham already has a trade deal with Riverton.";
    if (this.relations < 40) return "Riverton doesn't trust Gotham enough yet (relations must be at least 40).";
    if (this.society.treasury < 100) return "Signing costs 100 coins from the treasury.";
    this.society.treasury -= 100; this.deal = true; this.relations = clamp(this.relations + 10);
    this.society.log("🤝", "Gotham and Riverton signed a trade deal: better prices for travelers and a merchant every day.", "law", true);
    return null;
  }

  // ----- daily rhythm -----
  onHour(h) {
    if (h === 9 && !this.merchant && Math.random() < (this.deal ? 1 : 0.35)) this.merchantArrives();
    if (this.merchant && this.sim.time >= this.merchant.until) {
      this.society.log("🛒", `${this.merchant.res.name}, the merchant from Riverton, packed up and headed home.`, "economy");
      this.merchant = null;
    }
  }
  onNewDay() { if (this.deal) this.relations = clamp(this.relations + 1); }
  onDisaster(d) {
    if (this.relations >= 60) {
      const aid = 60 + Math.round(this.relations);
      setTimeout(() => {
        this.society.treasury += aid;
        this.society.log("🚚", `Riverton heard about the ${d.name.toLowerCase()} and sent ${aid} coins of aid.`, "disaster", true);
      }, 4000);
    }
  }

  merchantArrives() {
    const tiles = this.sim.town.places.cmarket ?? [];
    const spot = tiles[Math.floor(tiles.length / 2)] ?? { x: 31, y: 58 };
    const name = pick(MERCHANT_NAMES);
    this.merchant = {
      res: { id: `merchant_${name}`, name, model: pick(Object.keys(MODELS)), look: pick(LOOKS), traits: { rebel: 0, diligence: 1, ambition: 0.5, generosity: 0.5 }, job: "Merchant" },
      until: this.sim.time + 8 * 60, x: spot.x, y: spot.y, seed: Math.random() * 9, state: "idle", facing: "down", visible: true, sales: 0,
    };
    this.society.log("🛒", `${name}, a merchant from Riverton, set up a stall at the Citizens' Market with exotic goods.`, "economy", true);
  }

  // ----- residents travel -----
  travelOption(a) {
    if (a.state === "away" || a.coins < 12) return null;
    const goods = (a.inv?.fish ?? 0) + (a.inv?.veg ?? 0);
    const curious = (a.likes?.stroll ?? 0.5) * 30 + (100 - (a.fun ?? 50)) * 0.15;
    const score = 4 + goods * 6 + curious * 0.5 + (this.deal ? 10 : 0) + (this.relations - 50) * 0.1;
    return { kind: "travel", score, place: "riverton", tile: [RIVERTON_EXIT.x, RIVERTON_EXIT.y], label: "heading down the road to Riverton" };
  }

  onArrive(a) {
    if (a.doing === "travel" && a.x === RIVERTON_EXIT.x && a.y === RIVERTON_EXIT.y) this.depart(a);
    if (this.merchant && a.place === "cmarket" && a.coins > 30 && (a.fun ?? 50) < 75 && Math.random() < 0.6) {
      a.coins -= 12; this.merchant.sales += 12; a.fun = clamp((a.fun ?? 50) + 15); a.mood = clamp(a.mood + 4);
      const item = pick(["a jar of Riverton honey", "a silk scarf", "a strange brass compass", "spiced tea", "a carved wooden duck"]);
      a.activity = `buying ${item} from ${this.merchant.res.name}`;
      if (Math.random() < 0.35) this.society.log("🛍️", `${a.res.name} bought ${item} from ${this.merchant.res.name}.`, "economy", false, a.id);
    }
  }

  depart(a) {
    a.coins -= 10;
    a.state = "away"; a.place = "riverton";
    a.awayUntil = this.sim.time + 360 + Math.random() * 360;
    a.activity = "visiting Riverton 🚶";
    this.trips++;
    this.society.log("🧳", `${a.res.name} set off down the east road to Riverton.`, "community", false, a.id);
  }

  // called every frame for travelers
  tick(a) {
    if (a.state !== "away" || this.sim.time < a.awayUntil) return;
    // home again, with stories, souvenirs and maybe money
    const goodsValue = Math.round(((a.inv?.fishValue ?? 0) + (a.inv?.veg ?? 0) * 3) * this.priceBonus);
    if (goodsValue > 0) { a.coins += goodsValue; this.trade += goodsValue; a.inv = { fish: 0, fishValue: 0, veg: 0 }; }
    a.state = "idle"; a.place = "riverton";
    a.x = RIVERTON_EXIT.x; a.y = RIVERTON_EXIT.y; a.path = []; a.dwellUntil = this.sim.time + 5;
    a.fun = clamp((a.fun ?? 50) + 25); a.mood = clamp(a.mood + 6); a.energy = clamp((a.energy ?? 60) - 15);
    const news = pick(NEWS);
    this.society.social.learn(a, `In Riverton, ${news}`, a.res.name);
    this.relations = clamp(this.relations + 1);
    a.memories.push({ about: a.id, text: `I visited Riverton. ${news.charAt(0).toUpperCase()}${news.slice(1)}.`, time: "" });
    this.society.log("🏡", `${a.res.name} came back from Riverton${goodsValue ? ` with ${goodsValue} coins from selling goods` : ""} and says ${news}.`, "community", true, a.id);
  }

  situation() {
    return `Riverton, the neighboring town down the east road: relations ${Math.round(this.relations)}/100${this.deal ? ", with a trade deal" : ""}. Goods sell for ${Math.round((this.priceBonus - 1) * 100)}% more there.${this.merchant ? ` ${this.merchant.res.name}, a merchant from Riverton, is at the Citizens' Market today.` : ""}`;
  }

  serialize() { return { relations: this.relations, deal: this.deal, trips: this.trips, trade: this.trade, away: Object.fromEntries(this.sim.agents.filter((a) => a.state === "away").map((a) => [a.id, a.awayUntil])) }; }
  restore(s) {
    if (!s) return;
    Object.assign(this, { relations: s.relations ?? 50, deal: !!s.deal, trips: s.trips ?? 0, trade: s.trade ?? 0 });
  }
}
