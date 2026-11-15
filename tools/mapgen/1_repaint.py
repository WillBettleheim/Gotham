import os
HERE = os.path.dirname(os.path.abspath(__file__))
P = lambda name: os.path.join(HERE, name)
from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageChops
import math, random
random.seed(7)
src = Image.open(P('town-original.webp')).convert('RGB')
im = src.copy()
d = ImageDraw.Draw(im)
FONT = '/System/Library/Fonts/Supplemental/Georgia Bold.ttf'

def sign(dr, cx, top, text, size, minw=0):
    f = ImageFont.truetype(FONT, size)
    tw = dr.textlength(text, font=f)
    w = max(minw, tw + 14); h = size + 6
    dr.rounded_rectangle([cx - w / 2 - 2, top - 2, cx + w / 2 + 2, top + h + 2], radius=3, fill=(84, 52, 24))
    dr.rounded_rectangle([cx - w / 2, top, cx + w / 2, top + h], radius=2, fill=(140, 88, 38))
    dr.line([(cx - w / 2 + 2, top + 1), (cx + w / 2 - 2, top + 1)], fill=(170, 112, 52))
    dr.text((cx - tw / 2 + 1, top + 1), text, font=f, fill=(60, 34, 14))
    dr.text((cx - tw / 2, top), text, font=f, fill=(246, 231, 200))

# ================= Police station (was the Blacksmith) =================
d.rectangle([633, 740, 673, 766], fill=(128, 86, 48))
for x in range(633, 674, 6):
    d.line([(x, 740), (x, 766)], fill=(92, 60, 32)); d.line([(x + 1, 740), (x + 1, 766)], fill=(146, 101, 58))
cx, cy = 653, 753
pts = [(cx + (12 if i % 2 == 0 else 5.5) * math.cos(-math.pi / 2 + i * math.pi / 5), cy + (12 if i % 2 == 0 else 5.5) * math.sin(-math.pi / 2 + i * math.pi / 5)) for i in range(10)]
d.polygon([(x + 1, y + 1) for x, y in pts], fill=(70, 45, 15))
d.polygon(pts, fill=(232, 182, 58), outline=(120, 80, 20))
d.ellipse([cx - 4, cy - 4, cx + 4, cy + 4], fill=(48, 74, 140), outline=(30, 45, 90))
d.rectangle([606, 768, 701, 790], fill=(128, 86, 48))
sign(d, 653, 770, 'Police', 15, minw=88)
d.rectangle([615, 799, 644, 836], fill=(52, 34, 20))
d.rectangle([618, 802, 641, 836], fill=(44, 64, 108))
for x in range(620, 642, 4): d.line([(x, 804), (x, 836)], fill=(34, 50, 86))
d.line([(629, 802), (629, 836)], fill=(28, 36, 60), width=2)
d.rectangle([620, 806, 627, 812], fill=(255, 214, 120)); d.rectangle([631, 806, 638, 812], fill=(255, 214, 120))
d.line([(623, 806), (623, 812)], fill=(52, 34, 20)); d.line([(634, 806), (634, 812)], fill=(52, 34, 20))
d.point([(626, 822), (632, 822)], fill=(240, 200, 90))
d.rectangle([627, 793, 632, 798], fill=(60, 120, 230), outline=(25, 40, 80)); d.point([(628, 794)], fill=(200, 225, 255))
im.paste(src.crop((585, 838, 625, 868)), (662, 826))
d = ImageDraw.Draw(im)
d.rectangle([668, 838, 694, 841], fill=(156, 104, 58)); d.rectangle([668, 843, 694, 846], fill=(126, 82, 44))
d.rectangle([670, 846, 672, 852], fill=(84, 54, 28)); d.rectangle([690, 846, 692, 852], fill=(84, 54, 28))

# ================= Jail in the south-east clearing =================
# 1) grass clearing made from the picture's own grass
grass_tile = src.crop((420, 932, 476, 950))
gx0, gy0, gx1, gy1 = 1334, 836, 1512, 1012
ground = Image.new('RGB', (gx1 - gx0, gy1 - gy0))
for y in range(0, ground.height, grass_tile.height - 2):
    for x in range(0, ground.width, grass_tile.width - 4):
        t = grass_tile
        if random.random() < 0.5: t = t.transpose(Image.FLIP_LEFT_RIGHT)
        ground.paste(t, (x + random.randint(-2, 2), y))
ground = ground.filter(ImageFilter.SMOOTH)
mask = Image.new('L', ground.size, 0)
ImageDraw.Draw(mask).rounded_rectangle([6, 6, ground.width - 6, ground.height - 6], radius=34, fill=255)
mask = mask.filter(ImageFilter.GaussianBlur(5))
im.paste(ground, (gx0, gy0), mask)
d = ImageDraw.Draw(im)
# little grass tufts and flowers like the rest of the picture
for _ in range(70):
    x, y = random.randint(gx0 + 14, gx1 - 14), random.randint(gy0 + 14, gy1 - 14)
    d.line([(x, y), (x, y - 3)], fill=(84, 140, 30)); d.line([(x + 2, y), (x + 3, y - 2)], fill=(160, 205, 60))
for _ in range(10):
    x, y = random.randint(gx0 + 20, gx1 - 20), random.randint(gy0 + 60, gy1 - 16)
    c = random.choice([(255, 255, 240), (255, 214, 102), (255, 140, 170)])
    d.point([(x, y), (x + 1, y), (x, y + 1), (x + 1, y + 1)], fill=c)

# 2) dirt path from the east road to the jail door, using the picture's dirt
dirt = src.crop((750, 958, 796, 1018))
def dirt_rect(x0, y0, x1, y1):
    patch = Image.new('RGB', (x1 - x0, y1 - y0))
    for yy in range(0, patch.height, dirt.height):
        for xx in range(0, patch.width, dirt.width):
            patch.paste(dirt, (xx, yy))
    m = Image.new('L', patch.size, 0)
    ImageDraw.Draw(m).rounded_rectangle([1, 1, patch.width - 2, patch.height - 2], radius=8, fill=255)
    m = m.filter(ImageFilter.GaussianBlur(1.5))
    im.paste(patch, (x0, y0), m)
dirt_rect(1346, 880, 1374, 990)
dirt_rect(1346, 962, 1474, 990)
d = ImageDraw.Draw(im)

# 3) the building: the picture's small cottage, rebuilt in stone
hx0, hy0, hx1, hy1 = 358, 752, 480, 896
house = src.crop((hx0, hy0, hx1, hy1)).copy()
hp = house.load()
for y in range(house.height):
    for x in range(house.width):
        r, g, b = hp[x, y]
        ay = y + hy0
        if ay > 815 and r > 170 and g > 140 and b > 95 and r - b < 110 and not (r > 235 and g > 175 and b < 150):
            v = int((0.30 * r + 0.55 * g + 0.15 * b) * 0.72)
            hp[x, y] = (v, v, min(255, v + 6))
hd = ImageDraw.Draw(house)
for y in range(852 - hy0, 886 - hy0, 6):
    off = 0 if (y // 6) % 2 else 5
    for x in range(382 - hx0 + off, 460 - hx0, 10):
        if hp[x, y][0] < 175 and abs(hp[x, y][0] - hp[x, y][2]) < 20:
            hd.line([(x, y), (x + 8, y)], fill=(110, 110, 116))
def bars(x0, y0, x1, y1):
    x0 -= hx0; x1 -= hx0; y0 -= hy0; y1 -= hy0
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            r, g, b = hp[x, y]
            if r > 200 and g > 150: hp[x, y] = (int(r * 0.8), int(g * 0.72), int(b * 0.6))
    for x in range(x0 + 2, x1, 4): hd.line([(x, y0), (x, y1)], fill=(38, 36, 42), width=2)
    hd.line([(x0, (y0 + y1) // 2), (x1, (y0 + y1) // 2)], fill=(38, 36, 42), width=2)
bars(389, 854, 409, 875); bars(430, 854, 449, 875); bars(437, 787, 455, 801)
# heavy iron door between the windows
dx = 419 - hx0
hd.rectangle([dx - 8, 858 - hy0, dx + 8, 890 - hy0], fill=(52, 34, 20))
hd.rectangle([dx - 6, 860 - hy0, dx + 6, 890 - hy0], fill=(74, 77, 88))
for x in range(dx - 5, dx + 6, 3): hd.line([(x, 862 - hy0), (x, 889 - hy0)], fill=(52, 54, 62))
hd.rectangle([dx - 4, 864 - hy0, dx + 4, 870 - hy0], fill=(30, 30, 36))
for x in range(dx - 3, dx + 4, 2): hd.line([(x, 864 - hy0), (x, 870 - hy0)], fill=(120, 120, 130))
hd.point([(dx + 4, 877 - hy0)], fill=(230, 190, 80))
sign(hd, 419 - hx0, 823 - hy0, 'Jail', 12, minw=40)
# silhouette mask: roof triangle, chimney and walls
hm = Image.new('L', house.size, 0)
md = ImageDraw.Draw(hm)
md.polygon([(361 - hx0, 850 - hy0), (418 - hx0, 752 - hy0), (477 - hx0, 850 - hy0)], fill=255)
md.rectangle([369 - hx0, 838 - hy0, 468 - hx0, 893 - hy0], fill=255)
md.rectangle([376 - hx0, 754 - hy0, 403 - hx0, 802 - hy0], fill=255)
hm = hm.filter(ImageFilter.GaussianBlur(0.6))
tx, ty = 1440 - (418 - hx0), 968 - (893 - hy0)
# soft shadow like the picture's buildings
sh = Image.new('L', house.size, 0); sh.paste(hm.point(lambda v: int(v * 0.45)))
sh = sh.filter(ImageFilter.GaussianBlur(4))
dark = Image.new('RGB', house.size, (20, 40, 10))
im.paste(dark, (tx + 6, ty + 6), sh)
im.paste(house, (tx, ty), hm)
d = ImageDraw.Draw(im)
# stone step at the door
d.rectangle([1430, 966, 1450, 970], fill=(170, 165, 150)); d.line([(1430, 970), (1450, 970)], fill=(110, 105, 95))

# 4) fenced exercise yard with iron railings
yx0, yy0, yx1, yy1 = 1474, 962, 1534, 1022
gravel = src.crop((596, 444, 634, 482))
for yy in range(yy0, yy1, gravel.height):
    for xx in range(yx0, yx1, gravel.width):
        im.paste(gravel.crop((0, 0, min(gravel.width, yx1 - xx), min(gravel.height, yy1 - yy))), (xx, yy))
d = ImageDraw.Draw(im)
for x in range(yx0, yx1 + 1, 5):
    d.line([(x, yy0 - 8), (x, yy0 + 2)], fill=(44, 44, 52)); d.point([(x, yy0 - 9)], fill=(140, 140, 150))
for y in range(yy0, yy1, 5):
    d.line([(yx0 - 1, y - 8), (yx0 - 1, y + 2)], fill=(44, 44, 52))
d.line([(yx0, yy0 - 6), (yx1, yy0 - 6)], fill=(60, 60, 70), width=2)
d.line([(yx0 - 2, yy0 - 6), (yx0 - 2, yy1)], fill=(60, 60, 70), width=2)
for x in (yx0, yx1):
    d.rectangle([x - 2, yy0 - 12, x + 2, yy0 + 2], fill=(52, 52, 60)); d.rectangle([x - 3, yy0 - 14, x + 3, yy0 - 12], fill=(90, 90, 100))

im.save(P('stage1.png'))  # intermediate: original picture + Police station + Jail
