# Gotham — an AI town

A cozy 2D town where AI characters live together. Residents run on AI models from different labs: **Claude** (Opus, Sonnet, Haiku), **Gemini**, **GPT**, **DeepSeek**, **Llama** and **Mistral**. They wake up, go to work, wander between the café, library, park, plaza and garden, bump into each other and chat. They also remember their conversations and make friends.

![Gotham](https://img.shields.io/badge/residents-13-ffcf6e) ![models](https://img.shields.io/badge/models-Claude%20·%20Gemini%20·%20GPT%20·%20DeepSeek%20·%20Llama%20·%20Mistral-a78bfa)

## Run it

```bash
npm install
npm start
```

Then open http://localhost:3000.

With no API keys the town runs in **offline mode**, using built-in chatter so you can still watch it live. To have residents really talk through their models, add keys:

```bash
cp .env.example .env   # then fill in the keys you have
npm start
```

You don't need every key. Each resident goes live as soon as its model's key is present; the rest keep using offline chatter. The terminal shows who is live when the server starts.

| Key | Residents | Cost |
|---|---|---|
| `GEMINI_API_KEY` ([Google AI Studio](https://aistudio.google.com/apikey)) | Nova (Gemini) | Free tier |
| `GROQ_API_KEY` ([Groq](https://console.groq.com/keys)) | Lola (Llama), Gus (OpenAI's open GPT-OSS) | Free tier |
| `MISTRAL_API_KEY` ([Mistral](https://console.mistral.ai)) | Mira (Mistral) | Free "Experiment" plan |
| `DEEPSEEK_API_KEY` ([DeepSeek](https://platform.deepseek.com)) | Dex (DeepSeek) | Very cheap, paid |
| `ANTHROPIC_API_KEY` ([Claude](https://platform.claude.com)) | The 8 Claude residents | Paid |
| `OPENAI_API_KEY` (optional) | Gus, using OpenAI directly instead of GPT-OSS | Paid |

Free model names change often, so every model can be overridden in `.env` (see `.env.example`).

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
| Hazel | Claude Haiku 5.5 | Apprentice cartographer |
| Nova | Google Gemini | Photographer and trivia champion |
| Gus | OpenAI GPT | Baker who supplies the café |
| Dex | DeepSeek | Mathematician who plays chess by the fountain |
| Lola | Meta Llama | Knitter and storyteller with a yarn stall in the plaza |
| Mira | Mistral | Chef and kite-flier |

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
server.js            Node server: serves the page; /api/talk + /api/reflect call each resident's model
providers.js         Gemini, GPT, DeepSeek, Llama and Mistral (OpenAI-style chat APIs)
public/js/residents.js  who lives here (personas, schedules, looks), shared by server and browser
public/js/map.js     town layout, A* pathfinding, pre-rendered map art
public/js/sprites.js procedurally drawn characters
public/js/sim.js     daily routines, movement, conversations, memories
public/js/offline.js built-in chatter for offline mode
public/js/main.js    rendering, lighting, camera and sidebar UI
```

Calls use low effort and short replies to keep chatter quick and cheap, and at most 2 conversations run at once in live mode. Add residents by appending to `RESIDENTS` in `public/js/residents.js` (all 13 houses are taken, so add a house in `map.js` too). To add a new model, add it to `MODELS` and to `PROVIDERS` in `providers.js`.
