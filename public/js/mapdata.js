// Layout traced from the town picture (public/assets/town.webp, 1536x1664 = 48x52 tiles of 32px).
// The top 32 rows are the original picture; South Gotham (rows 32-51) was built from pieces of it.
// Rects are [x, y, w, h] in tiles. Later rects override earlier ones.

export const IMAGE = "assets/town.webp";

export const RECTS = {
  // cobblestone streets
  PATH: [
    [7, 11, 32, 2],   // north road, west part (store, town hall, library)
    [6, 11, 2, 10],   // west road down to the inn
    [0, 14, 2, 2],    // road west of the bridge
    [6, 19, 36, 2],   // south road (inn, plaza, market)
    [18, 12, 12, 8],  // plaza
    [41, 12, 2, 16],  // east road
    [23, 21, 2, 7],   // avenue to the south gate
    [24, 26, 18, 2],  // lower road (small house, clinic)
    [16, 25, 8, 3],   // blacksmith yard
    [17, 6, 2, 5],    // walk to the little red house
    [23, 9, 2, 2],    // town hall steps
    [34, 10, 1, 1],   // library steps
    [12, 10, 1, 1],   // general store porch
    [11, 17, 3, 2],   // inn porch
    [28, 25, 1, 1], [35, 25, 1, 1], // house and clinic steps
    // South Gotham
    [23, 32, 2, 8],   // avenue from the gate
    [8, 38, 37, 2],   // High Street (bakery, school, bank, post office)
    [8, 47, 37, 2],   // Cottage Row
    [8, 38, 2, 11],   // west lane
    [43, 38, 2, 11],  // east lane
  ],
  BRIDGE: [[2, 13, 4, 3]],
  DIRT: [
    [39, 11, 9, 2],   // track east to the farm
    [38, 5, 3, 7],    // track up to the windmill and barn
    [39, 5, 8, 2],    // track to the barn
    [33, 12, 8, 7],   // market square
    [42, 25, 6, 1],   // path to the red cottage
    [42, 13, 5, 3],   // notice board green
    [23, 28, 2, 4],   // through the south gate
    [44, 24, 1, 1], [42, 28, 1, 3], [43, 30, 3, 1], // red cottage gate, jail path
  ],
  GRASS: [
    [20, 13, 3, 3], [25, 13, 3, 3], [20, 16, 3, 3], [25, 16, 3, 3], // plaza gardens
    [10, 21, 1, 6], [8, 24, 2, 1], [11, 26, 1, 1], // garden path between the two cottages
  ],
  FIELD: [[41, 7, 7, 4]],
  FOUNTAIN: [[22, 15, 4, 2], [23, 14, 2, 4]],
  BLOCK: [[35, 13, 4, 3], [32, 15, 3, 3]], // market stalls
  JAIL: [[43, 27, 4, 3]],
  YARD: [[46, 30, 2, 2]],
};

// Where each resident lives (door tile they walk to). Order matches residents' `home` index.
export const HOMES = [
  { x: 34, y: 10, name: "the Library (upstairs)" },        // 0 ophelia
  { x: 19, y: 26, name: "the Blacksmith (back room)" },    // 1 orion
  { x: 12, y: 18, name: "the Inn" },                       // 2 sonny
  { x: 17, y: 6, name: "the little red house" },           // 3 sage
  { x: 23, y: 10, name: "Town Hall (residence)" },         // 4 selene
  { x: 44, y: 6, name: "the barn" },                       // 5 hana
  { x: 8, y: 24, name: "the red cottage by the river" },  // 6 hugo
  { x: 11, y: 26, name: "the blue cottage" },              // 7 hazel
  { x: 28, y: 25, name: "the little house on the lower road" }, // 8 nova
  { x: 12, y: 10, name: "the General Store (upstairs)" },  // 9 gus
  { x: 39, y: 5, name: "the windmill" },                   // 10 dex
  { x: 44, y: 24, name: "the red cottage by the farm" },   // 11 lola
  { x: 13, y: 18, name: "the Inn (rented room)" },         // 12 mira
  // South Gotham's Cottage Row: room for newcomers
  { x: 13, y: 47, name: "1 Cottage Row", capacity: 2 },
  { x: 18, y: 47, name: "2 Cottage Row", capacity: 2 },
  { x: 23, y: 47, name: "3 Cottage Row", capacity: 2 },
  { x: 29, y: 47, name: "4 Cottage Row", capacity: 2 },
  { x: 33, y: 47, name: "5 Cottage Row", capacity: 2 },
  { x: 39, y: 47, name: "6 Cottage Row", capacity: 2 },
];

// Building doors used by the simulation.
export const DOORS = {
  jail: { x: 45, y: 30 },
};

// Standing spots for each kind of place: [x, y, w, h] areas; only walkable tiles count.
export const PLACE_AREAS = {
  cafe: [[10, 17, 5, 4]],          // the Inn
  store: [[9, 10, 7, 3]],          // the General Store
  library: [[31, 10, 7, 3]],
  townhall: [[19, 9, 10, 3]],
  courthouse: [[19, 9, 10, 3]],    // court is held at Town Hall
  plaza: [[18, 12, 12, 8]],
  park: [[42, 13, 5, 3], [0, 13, 6, 3]], // notice board green and the bridge
  market: [[33, 12, 8, 7]],
  police: [[16, 25, 8, 3]],        // the Police station yard
  garden: [[41, 7, 7, 4]],
  clinic: [[33, 25, 5, 3]],
  jailyard: [[46, 30, 2, 2]],
  bakery: [[10, 38, 5, 2]],
  school: [[17, 38, 5, 2]],
  bank: [[27, 38, 5, 2]],
  post: [[36, 38, 5, 2]],
};

// River center line in tiles, sampled by row (for ducks and sparkles).
export const RIVER = [[4, 4.2], [8, 3.6], [12, 3.4], [16, 2.6], [20, 2.4], [24, 3.6], [28, 5.6], [31, 6.6], [35, 4.5], [39, 2.3], [42, 0.2]];
export const WATERFALL = { x: 118, y: 40, w: 54, h: 140 };       // pixels
export const FOUNTAIN_PX = { x: 772, y: 498 };
export const CHIMNEYS = [[350, 160], [372, 400], [578, 662], [1128, 128], [578, 62], [325, 676], [390, 752], [1205, 666], [1398, 640]];
