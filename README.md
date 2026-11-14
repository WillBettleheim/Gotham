# Gotham — an AI town

A cozy 2D town where AI characters live together. Each resident runs on a different Claude model (**Opus 5.5**, **Sonnet 5.5**, **Haiku 5.5**). They wake up, go to work, wander between the café, library, park, plaza and garden, bump into each other and chat. They also remember their conversations and make friends.

![Gotham](https://img.shields.io/badge/residents-8-ffcf6e) ![models](https://img.shields.io/badge/models-Opus%20·%20Sonnet%20·%20Haiku-a78bfa)

## Run it

```bash
npm install
npm start
```

Then open http://localhost:3000.

With no API key the town runs in **offline mode**, using built-in chatter so you can still watch it live. To have the residents really talk through Claude, add a key:

```bash
cp .env.example .env   # then put your key in .env
npm start
```

## What's in town

| Resident | Model | Role |
|---|---|---|
| Ophelia | Claude Opus 5.5 | Librarian and amateur philosopher |
| Orion | Claude Opus 5.5 | Inventor (night owl) |
| Sonny | Claude Sonnet 5.5 | Owner of The Warm Byte Café |
| Sage | Claude Sonnet 5.5 | Painter |
| Selene | Claude Sonnet 5.5 | Town organizer at Town Hall |
| Hana | Claude Haiku 5.5 | Gardener |
| Hugo | Claude Haiku 5.5 | Mail carrier |
| Hazel | Claude Haiku 5.5 | Apprentice cartographer, the newest resident |

- **Daily life:** each resident has a sleep schedule, work hours and favorite places.
- **Conversations:** when two neighbors meet, they chat for a few turns. Every line comes from the speaker's own model, in character, aware of the time, place, town news and what they remember about each other.
- **Memory and friendships:** after a chat, each resident writes a one-line memory about the other. These are saved in your browser.
- **Town news:** post an announcement from the sidebar and residents will bring it up.
- **Day and night:** street lamps, glowing windows, chimney smoke, ducks on the pond and fireflies at night.

## Controls

- Drag to pan, scroll to zoom
- Click a resident (on the map or in the sidebar) to see their personality, friends and memories, and to follow them
- Space pauses; 1× / 2× / 5× changes speed (1 real second = 1 game minute at 1×)

## How it works

```
server.js            Node server: serves the page, and /api/talk + /api/reflect call Claude
public/js/residents.js  who lives here (personas, schedules, looks), shared by server and browser
public/js/map.js     town layout, A* pathfinding, pre-rendered map art
public/js/sprites.js procedurally drawn characters
public/js/sim.js     daily routines, movement, conversations, memories
public/js/offline.js built-in chatter for offline mode
public/js/main.js    rendering, lighting, camera and sidebar UI
```

Calls use low effort and short replies to keep chatter quick and cheap, and at most 2 conversations run at once in live mode. Add residents by appending to `RESIDENTS` in `public/js/residents.js` (there are 9 houses, so one is free).
