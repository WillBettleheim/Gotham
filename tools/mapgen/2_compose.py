import os
HERE = os.path.dirname(os.path.abspath(__file__))
P = lambda name: os.path.join(HERE, name)
# Expand Gotham south of the town gate, built from pieces of the original picture.
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import random, math
random.seed(11)
base = Image.open(P('stage1.png')).convert('RGB')
src = Image.open(P('town-original.webp')).convert('RGB')
W, H = 1536, 2048
im = Image.new('RGB', (W, H))
FONT = '/System/Library/Fonts/Supplemental/Georgia Bold.ttf'

def feather(size, r=5, radius=18):
    m = Image.new('L', size, 0)
    ImageDraw.Draw(m).rounded_rectangle([r, r, size[0] - 1 - r, size[1] - 1 - r], radius=radius, fill=255)
    return m.filter(ImageFilter.GaussianBlur(r * 0.8))

def tile_fill(tile, box, jitter=0, flip=True):
    x0, y0, x1, y1 = box
    out = Image.new('RGB', (x1 - x0, y1 - y0))
    for y in range(0, out.height, tile.height - 2):
        for x in range(0, out.width, tile.width - 2):
            t = tile
            if flip and random.random() < 0.5: t = t.transpose(Image.FLIP_LEFT_RIGHT)
            out.paste(t, (x + random.randint(-jitter, jitter), y))
    return out

# ---- ground: the picture's grass, then forest texture ----
grass = src.crop((420, 932, 476, 950))
im.paste(tile_fill(grass, (0, 0, W, H), 2).filter(ImageFilter.SMOOTH), (0, 0))
d = ImageDraw.Draw(im)
for _ in range(900):
    x, y = random.randint(0, W - 4), random.randint(1024, H - 4)
    d.line([(x, y), (x, y - 3)], fill=(84, 140, 30)); d.line([(x + 2, y), (x + 3, y - 2)], fill=(160, 205, 60))

forest = src.crop((1250, 905, 1536, 1024))   # dense woods from the south-east corner
forest2 = src.crop((260, 930, 700, 1024))     # pines along the south fence
def forest_band(box):
    x0, y0, x1, y1 = box
    for y in range(y0, y1, 80):
        for x in range(x0 - 40, x1, 200):
            f = forest if random.random() < 0.6 else forest.transpose(Image.FLIP_LEFT_RIGHT)
            im.paste(f, (x + random.randint(-20, 20), y + random.randint(-10, 10)), feather(f.size, 8, 30))

# ---- the original town on top ----
im.paste(base, (0, 0))

# ---- woods around the new district ----
forest_band((0, 1956, W, H))            # southern edge
forest_band((1440, 1024, W, 1960))      # east side
forest_band((0, 1300, 250, 1960))       # south-west
forest_band((0, 1024, 140, 1320))
# soften the seam under the old southern forest
seam = base.crop((0, 984, W, 1024))
im.paste(seam, (0, 1004), feather(seam.size, 6, 8))

# ---- the river keeps flowing south-west and leaves the map ----
river = src.crop((96, 900, 300, 1024))
x = 96
for i, y in enumerate(range(1012, 1330, 112)):
    x -= 70
    im.paste(river, (x, y), feather(river.size, 10, 24))

d = ImageDraw.Draw(im)
# ---- cobblestone streets ----
cob_v = src.crop((596, 444, 634, 520))
cob_h = cob_v.transpose(Image.ROTATE_90)
def road(box, vertical):
    x0, y0, x1, y1 = box
    tile = cob_v if vertical else cob_h
    patch = tile_fill(tile, box, 0, flip=False)
    im.paste(patch, (x0, y0), feather(patch.size, 2, 6))
    dd = ImageDraw.Draw(im)
    dd.rectangle([x0 - 2, y0 - 2, x1 + 1, y1 + 1], outline=(62, 112, 40), width=2)
    dd.rectangle([x0, y0, x1 - 1, y1 - 1], outline=(214, 206, 190), width=2)
    dd.rectangle([x0 + 2, y0 + 2, x1 - 3, y1 - 3], outline=(150, 142, 128), width=1)
roads = [
    (736, 1024, 800, 1280, True),   # avenue from the gate (tx 23-24, ty 32-39)
    (256, 1216, 1440, 1280, False), # High Street (ty 38-39)
    (256, 1504, 1440, 1568, False), # Cottage Row (ty 47-48)
    (256, 1216, 320, 1952, True),   # west lane (tx 8-9)
    (1376, 1216, 1440, 1952, True), # east lane (tx 43-44)
    (256, 1888, 1440, 1952, False), # Garden Lane (ty 59-60)
]
for x0, y0, x1, y1, v in roads: road((x0, y0, x1, y1), v)
# gate dirt runs into the avenue
dirt = src.crop((750, 958, 796, 1018))
im.paste(dirt, (745, 1004), feather(dirt.size, 3, 6))

# ---- buildings copied from the picture, with new jobs on their signs ----
def sign(dr, cx, top, text, size, light=False, minw=0):
    f = ImageFont.truetype(FONT, size)
    tw = dr.textlength(text, font=f)
    w = max(minw, tw + 14); h = size + 7
    if light:
        dr.rounded_rectangle([cx - w / 2 - 2, top - 2, cx + w / 2 + 2, top + h + 2], radius=4, fill=(96, 70, 44))
        dr.rounded_rectangle([cx - w / 2, top, cx + w / 2, top + h], radius=3, fill=(236, 222, 190))
        dr.text((cx - tw / 2, top + 1), text, font=f, fill=(70, 44, 22))
    else:
        dr.rounded_rectangle([cx - w / 2 - 2, top - 2, cx + w / 2 + 2, top + h + 2], radius=3, fill=(84, 52, 24))
        dr.rounded_rectangle([cx - w / 2, top, cx + w / 2, top + h], radius=2, fill=(140, 88, 38))
        dr.line([(cx - w / 2 + 2, top + 1), (cx + w / 2 - 2, top + 1)], fill=(170, 112, 52))
        dr.text((cx - tw / 2 + 1, top + 1), text, font=f, fill=(60, 34, 14))
        dr.text((cx - tw / 2, top), text, font=f, fill=(246, 231, 200))

def building(crop, at, edit=None):
    b = src.crop(crop).copy()
    if edit: edit(b, ImageDraw.Draw(b), crop)
    im.paste(b, at, feather(b.size, 4, 16))

def recolor(b, fn):
    p = b.load()
    for y in range(int(b.height * 0.5)):  # roofs only
        for x in range(b.width):
            p[x, y] = fn(*p[x, y])

# School (from the Clinic)
def school(b, dr, c):
    ox, oy = c[0], c[1]
    dr.ellipse([1116 - ox, 724 - oy, 1152 - ox, 760 - oy], fill=(236, 222, 190), outline=(96, 70, 44), width=2)
    dr.ellipse([1124 - ox, 734 - oy, 1144 - ox, 754 - oy], fill=(214, 48, 40))     # apple
    dr.ellipse([1127 - ox, 737 - oy, 1132 - ox, 742 - oy], fill=(255, 140, 120))
    dr.line([(1134 - ox, 734 - oy), (1135 - ox, 728 - oy)], fill=(90, 56, 24), width=2)
    dr.ellipse([1136 - ox, 727 - oy, 1144 - ox, 733 - oy], fill=(80, 160, 50))
    dr.rounded_rectangle([1090 - ox, 750 - oy, 1186 - ox, 798 - oy], radius=4, fill=(222, 206, 172))
    dr.rectangle([1094 - ox, 754 - oy, 1182 - ox, 794 - oy], fill=(232, 218, 186))
    sign(dr, 1138 - ox, 762 - oy, 'School', 15, light=True, minw=84)
building((1040, 650, 1230, 836), (540, 1030), school)

# Bank (from the Library)
def bank(b, dr, c):
    ox, oy = c[0], c[1]
    dr.rectangle([1068 - ox, 206 - oy, 1122 - ox, 247 - oy], fill=(110, 76, 44))
    for i, (x, y) in enumerate([(1080, 236), (1095, 236), (1110, 236), (1087, 224), (1102, 224), (1095, 212)]):
        dr.ellipse([x - ox - 7, y - oy - 5, x - ox + 7, y - oy + 5], fill=(232, 182, 58), outline=(130, 90, 20))
        dr.line([(x - ox - 3, y - oy - 1), (x - ox + 2, y - oy - 1)], fill=(255, 230, 140))
    dr.rectangle([1048 - ox, 246 - oy, 1142 - ox, 276 - oy], fill=(110, 76, 44))
    sign(dr, 1095 - ox, 250 - oy, 'Bank', 16, minw=80)
building((985, 120, 1235, 336), (820, 1000), bank)

# Bakery (from the Inn)
def bakery(b, dr, c):
    ox, oy = c[0], c[1]
    dr.rectangle([362 - ox, 484 - oy, 406 - ox, 513 - oy], fill=(110, 72, 36))
    dr.ellipse([366 - ox, 488 - oy, 402 - ox, 510 - oy], fill=(212, 150, 70), outline=(120, 70, 24), width=2)
    for k in range(3): dr.line([(374 + k * 8 - ox, 492 - oy), (380 + k * 8 - ox, 504 - oy)], fill=(150, 92, 38), width=2)
    dr.rectangle([344 - ox, 519 - oy, 428 - ox, 546 - oy], fill=(110, 72, 36))
    sign(dr, 386 - ox, 522 - oy, 'Bakery', 15, minw=80)
building((285, 390, 515, 610), (300, 996), bakery)

# Post Office (from the General Store, with a blue awning)
def post(b, dr, c):
    ox, oy = c[0], c[1]
    p = b.load()
    for y in range(282 - oy, 320 - oy):
        for x in range(b.width):
            r, g, bb = p[x, y]
            if r > 170 and g < 120 and bb < 120: p[x, y] = (60, 100, 190)
    dr.rectangle([352 - ox, 246 - oy, 460 - ox, 276 - oy], fill=(110, 72, 36))
    sign(dr, 406 - ox, 250 - oy, 'Post Office', 14, minw=104)
    # envelope on the gable
    dr.rectangle([396 - ox, 214 - oy, 418 - ox, 228 - oy], fill=(250, 244, 228), outline=(96, 70, 44))
    dr.line([(396 - ox, 214 - oy), (407 - ox, 222 - oy), (418 - ox, 214 - oy)], fill=(96, 70, 44))
building((300, 120, 500, 360), (1110, 976), post)

# homes for new residents
def blue_roof(b, dr, c):
    recolor(b, lambda r, g, bb: (int(bb * 0.9), int(g * 0.95), r) if r > g + 40 and r > bb + 40 else (r, g, bb))
def red_roof(b, dr, c):
    recolor(b, lambda r, g, bb: (min(255, int(bb * 1.5)), int(g * 0.6), int(r * 0.7)) if bb > r + 15 and bb > g and bb < 170 else (r, g, bb))
homes = [
    ((190, 680, 360, 870), (330, 1314), None),
    ((860, 680, 990, 850), (520, 1334), None),
    ((490, 40, 610, 200), (680, 1344), blue_roof),
    ((1360, 630, 1510, 790), (830, 1344), None),
    ((860, 680, 990, 850), (1010, 1334), red_roof),
    ((190, 680, 360, 870), (1170, 1314), blue_roof),
]
for crop, at, fx in homes: building(crop, at, fx)

# ---- a few trees and lamps between buildings ----
pine = src.crop((1385, 885, 1440, 975))
for x, y in [(250, 1040), (480, 1080), (1060, 1240 - 160), (1440, 1100), (270, 1400), (1340, 1330)]:
    im.paste(pine, (x, y), feather(pine.size, 6, 20))
d = ImageDraw.Draw(im)
def lamp(x, y):
    d.rectangle([x - 1, y, x + 1, y + 26], fill=(40, 40, 46)); d.rectangle([x - 5, y + 24, x + 5, y + 27], fill=(40, 40, 46))
    d.rectangle([x - 5, y - 9, x + 5, y], fill=(40, 40, 46)); d.rectangle([x - 3, y - 7, x + 3, y - 1], fill=(255, 214, 110))
for x in (330, 560, 700, 840, 1100, 1350): lamp(x, 1188)
for x in (330, 660, 1000, 1350): lamp(x, 1478)
# welcome sign at the avenue
sign(d, 768, 1290, 'South Gotham', 14, minw=120)
d.rectangle([766, 1312, 770, 1330], fill=(84, 52, 24))


# ================= Fishing docks =================
def dock(x0, y0, x1, y1, vertical_planks=True):
    d = ImageDraw.Draw(im)
    d.rectangle([x0 + 3, y1 + 1, x1 + 3, y1 + 5], fill=(20, 60, 90))           # shadow on the water
    d.rectangle([x0, y0, x1, y1], fill=(150, 100, 56))
    for x in range(x0, x1, 6):
        d.line([(x, y0), (x, y1)], fill=(108, 70, 36)); d.line([(x + 1, y0 + 1), (x + 1, y1 - 1)], fill=(180, 128, 74))
    d.line([(x0, y0), (x1, y0)], fill=(196, 146, 90)); d.line([(x0, y1), (x1, y1)], fill=(92, 58, 28))
    for x in (x0 + 2, x1 - 4):
        for y in (y0 - 3, y1 - 2):
            d.rectangle([x, y, x + 4, y + 6], fill=(84, 52, 24)); d.point([(x + 1, y)], fill=(170, 120, 70))
    # a bucket and a resting fishing rod
    d.rectangle([x1 - 22, y0 + 3, x1 - 14, y0 + 11], fill=(120, 120, 130), outline=(70, 70, 80))
    d.line([(x0 + 14, y0 + 6), (x0 - 6, y0 - 14)], fill=(110, 76, 40), width=2)
    d.line([(x0 - 6, y0 - 14), (x0 - 10, y0 + 10)], fill=(230, 230, 230))
dock(162, 197, 252, 219)                     # into the waterfall pond
dirt_p = src.crop((750, 958, 796, 1018))
for y in range(219, 352, dirt_p.height):     # path from the pond dock down to the north road
    im.paste(dirt_p.crop((0, 0, 30, min(dirt_p.height, 352 - y))), (228, y), feather((30, min(dirt_p.height, 352 - y)), 2, 6))
dock(84, 548, 196, 572)                      # into the river beside the west road

# ================= Garden District (south of Cottage Row) =================
d = ImageDraw.Draw(im)
def fence(x0, y0, x1, y1, gaps=()):
    for (ax, ay, bx, by) in [(x0, y0, x1, y0), (x0, y1, x1, y1), (x0, y0, x0, y1), (x1, y0, x1, y1)]:
        if ay == by:
            for x in range(ax, bx + 1, 14):
                if any(g0 <= x <= g1 and gy == ay for g0, g1, gy in gaps): continue
                d.rectangle([x - 2, ay - 9, x + 2, ay + 4], fill=(98, 64, 30)); d.point([(x - 1, ay - 9)], fill=(170, 120, 70))
            for yy in (ay - 6, ay - 1):
                segs = [(ax, bx)]
                for g0, g1, gy in gaps:
                    if gy == ay:
                        segs = [(p, q) for (a, b) in segs for (p, q) in ((a, min(b, g0 - 3)), (max(a, g1 + 3), b)) if q > p]
                for p, q in segs: d.line([(p, yy), (q, yy)], fill=(130, 88, 44), width=2)
        else:
            for y in range(ay, by + 1, 14):
                d.rectangle([ax - 2, y - 9, ax + 2, y + 4], fill=(98, 64, 30))
            d.line([(ax - 1, ay), (ax - 1, by)], fill=(130, 88, 44), width=2)

# --- Community Garden: plots, an event lawn with a stage, lanterns ---
gx0, gy0, gx1, gy1 = 500, 1596, 900, 1874
field = src.crop((1300, 205, 1405, 340))
for (x, y) in [(516, 1614), (622, 1614), (516, 1742), (622, 1742)]:
    im.paste(field.resize((96, 118)), (x, y), feather((96, 118), 2, 6))
d = ImageDraw.Draw(im)
# event lawn
d.rectangle([736, 1608, 890, 1640], fill=(120, 80, 42)); d.rectangle([736, 1608, 890, 1612], fill=(170, 118, 64))   # stage
for x in range(740, 890, 10): d.line([(x, 1613), (x, 1640)], fill=(98, 64, 30))
d.rectangle([736, 1640, 890, 1644], fill=(70, 46, 22))
for x in (740, 886): d.rectangle([x - 2, 1580, x + 2, 1610], fill=(84, 52, 24))
d.line([(740, 1582), (886, 1582)], fill=(84, 52, 24), width=2)
for i, x in enumerate(range(748, 884, 12)):   # bunting over the stage
    c = [(220, 70, 60), (250, 210, 80), (70, 130, 210), (110, 180, 80)][i % 4]
    d.polygon([(x, 1584), (x + 9, 1584), (x + 4, 1593)], fill=c)
bench = src.crop((1458, 455, 1505, 490))
for (x, y) in [(748, 1680), (812, 1680), (748, 1740), (812, 1740), (748, 1800), (812, 1800)]:
    im.paste(bench, (x, y), feather(bench.size, 1, 3))
board = src.crop((1350, 415, 1450, 505))
im.paste(board, (750, 1838 - 90 + 18), feather(board.size, 3, 8)) if False else None
d = ImageDraw.Draw(im)
for (x, y) in [(728, 1660), (896, 1660), (728, 1850), (896, 1850)]:   # lanterns
    d.rectangle([x - 1, y, x + 1, y + 24], fill=(40, 40, 46)); d.rectangle([x - 4, y - 7, x + 4, y], fill=(40, 40, 46)); d.rectangle([x - 3, y - 6, x + 3, y - 1], fill=(255, 214, 110))
for _ in range(40):  # flowers along the paths
    x, y = random.randint(gx0 + 10, gx1 - 10), random.choice([random.randint(1866, 1872), random.randint(1600, 1606)])
    d.point([(x, y), (x + 1, y)], fill=random.choice([(255, 140, 170), (255, 230, 120), (255, 255, 240)]))
fence(gx0, gy0, gx1, gy1, gaps=((680, 740, gy0), (680, 740, gy1)))
sign(d, 700, 1562 + 12, 'Community Garden', 13, minw=150)
d.rectangle([698, 1592, 702, 1598], fill=(84, 52, 24))

# --- Citizens' Market: dirt square with stalls ---
mx0, my0, mx1, my1 = 920, 1596, 1132, 1874
md = tile_fill(src.crop((750, 958, 796, 1018)), (mx0, my0, mx1, my1), 0)
im.paste(md, (mx0, my0), feather(md.size, 6, 20))
red = src.crop((1128, 400, 1256, 525)); blue = src.crop((1012, 482, 1132, 598))
for (piece, x, y) in [(red, 930, 1612), (blue, 1010, 1612 + 4), (blue, 930, 1745), (red, 1004, 1740)]:
    p = piece if piece.width <= 122 else piece.resize((118, 118))
    im.paste(p, (x, y), feather(p.size, 3, 10))
d = ImageDraw.Draw(im)
sign(d, 1026, 1562 + 12, "Citizens' Market", 13, minw=140)
d.rectangle([1024, 1592, 1028, 1598], fill=(84, 52, 24))

# --- more homes: an apartment house and a cottage on Garden Lane ---
def apartments(b, dr, c):
    ox, oy = c[0], c[1]
    dr.rectangle([362 - ox, 484 - oy, 406 - ox, 513 - oy], fill=(110, 72, 36))
    dr.polygon([(384 - ox, 488 - oy), (370 - ox, 499 - oy), (398 - ox, 499 - oy)], fill=(200, 70, 60))   # little house icon
    dr.rectangle([373 - ox, 499 - oy, 395 - ox, 510 - oy], fill=(240, 226, 196))
    dr.rectangle([381 - ox, 503 - oy, 387 - ox, 510 - oy], fill=(110, 72, 36))
    dr.rectangle([340 - ox, 519 - oy, 432 - ox, 546 - oy], fill=(110, 72, 36))
    sign(dr, 386 - ox, 522 - oy, 'Apartments', 14, minw=92)
import sys; sys.path.insert(0, HERE)
from apartments import tall_apartments
apt = tall_apartments(3)
am = Image.new('L', apt.size, 0)
amd = ImageDraw.Draw(am)
amd.polygon([(0, 118), (0, 50), (115, 6), (132, 6), (132, 0), (158, 0), (158, 20), (165, 18), (215, 82), (250, 92), (250, 118)], fill=255)
amd.rectangle([0, 112, apt.width, apt.height], fill=255)
am = am.filter(ImageFilter.GaussianBlur(0.7))
ax, ay = 1126, 1888 - apt.height
sh = am.point(lambda v: int(v * 0.4)).filter(ImageFilter.GaussianBlur(5))
im.paste(Image.new('RGB', apt.size, (20, 40, 10)), (ax + 7, ay + 7), sh)
im.paste(apt, (ax, ay), am)
d = ImageDraw.Draw(im)
building((860, 680, 990, 850), (345, 1718), None)
pine = src.crop((1385, 885, 1440, 975))
for x, y in [(260, 1600), (470, 1610)]:
    im.paste(pine, (x, y), feather(pine.size, 6, 20))
d = ImageDraw.Draw(im)
for x in (330, 700, 1030, 1350): lamp(x, 1862)
d = ImageDraw.Draw(im)
def flower_bed(x, y, w=40):
    d.rounded_rectangle([x, y, x + w, y + 12], radius=5, fill=(58, 112, 34))
    d.rounded_rectangle([x + 1, y + 1, x + w - 1, y + 9], radius=4, fill=(76, 140, 44))
    for k in range(x + 4, x + w - 3, 5):
        c = random.choice([(255, 140, 170), (255, 225, 110), (255, 255, 240), (200, 150, 255), (255, 170, 80)])
        d.rectangle([k, y + 2 + (k % 3), k + 2, y + 4 + (k % 3)], fill=c)
for x in (340, 470, 860, 1000, 1260):       # below High Street buildings
    flower_bed(x, 1290)
for x in (300, 520, 690, 840, 1020, 1180):  # in front of Cottage Row
    flower_bed(x, 1486, 34)
for x in (300, 1180):                        # Garden Lane
    flower_bed(x, 1868, 34)
im.save(os.path.join(HERE, '..', '..', 'public', 'assets', 'town.webp'), 'WEBP', quality=93, method=6)

