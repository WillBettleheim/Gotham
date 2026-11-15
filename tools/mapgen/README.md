# Map generator

Rebuilds `public/assets/town.webp` from the original town picture (`town-original.webp`).

```bash
pip install pillow
python3 tools/mapgen/1_repaint.py   # Police station and Jail painted in the picture's style
python3 tools/mapgen/2_compose.py   # South Gotham, the Garden District, docks and Gotham Heights
```

Everything is built from pieces of the original picture so the style stays consistent.
After changing the layout, update the walkable areas in `public/js/mapdata.js` to match.
