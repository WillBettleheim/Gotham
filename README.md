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

## Society: work, laws, jail, communities and elections

Every resident is free to do what they want, and every choice has consequences.

- **Work and money:** everyone has a job, shift hours and a wage. They only get paid for time actually spent at work. Rent (15/day) and meals (8 at the café) cost money. Run out and you go hungry, fall into debt, and your mood drops.
- **Free will:** each morning a resident plans their day: work or skip, and which laws they're willing to break. Live residents decide with their own model; offline residents decide from their personality (diligence, rebelliousness, ambition, generosity) and their situation.
- **Laws (you decide):** in the ⚖️ Laws tab you are the citizens' council. Pass a curfew, quiet hours, mandatory work, a private garden, no stealing, an income tax, or write any custom law. Custom laws are judged by an AI judge reading the residents' conversations (or by banned words when offline). You choose each penalty: a fine or jail time.
- **Crime and punishment:** lawbreakers get caught more often when others are nearby. Caught residents pay the fine; if they can't, they go to jail. Jail time means an escort to the Jail, no wages, a lost vote, and a hit to reputation and mood. Repeat offenders pay 50% more each time.
- **Communities:** Lantern Society (order), Hearth & Harvest (food and fairness), Tinkerers' Union (work and progress) and Free Spirits (freedom and art). They meet up in the evenings, vote as blocs, help broke friends, and unhappy members may follow a friend to another community.
- **Elections:** every two game days, each community nominates a candidate. There's a campaign, a rally in the plaza with speeches, then everyone votes (live residents vote with their own model and say why). The mayor earns a salary from the treasury and proposes a law change that you approve or reject.
- **Gotham Gazette:** every arrest, fine, election and community shake-up is reported. Click an entry or a toast to jump to the resident involved.

## Controls

- Drag to pan, scroll to zoom
- Click a resident (on the map or in the sidebar) to see their money, mood, reputation, today's plan, criminal record, friends and memories, and to follow them
- Space pauses; ½× to 15× changes speed (at 1×, one game minute takes 2 real seconds, so a day lasts about 48 minutes)
- "Reset town" in the sidebar starts Gotham over

## How it works

```
server.js            Node server: serves the page; /api/talk, /api/reflect and /api/think
                     (plans, speeches, votes, mayor proposals, judging) call each resident's model
providers.js         Gemini, GPT, DeepSeek, Llama and Mistral (OpenAI-style chat APIs)
public/js/residents.js  who lives here (personas, schedules, looks), shared by server and browser
public/js/map.js     town layout, A* pathfinding, pre-rendered map art
public/js/sprites.js procedurally drawn characters
public/js/sim.js     daily routines, free-will choices, movement, conversations, memories
public/js/society.js economy, laws, crime, jail, communities, elections, gazette
public/js/offline.js built-in chatter for offline mode
public/js/ui.js      sidebar tabs, resident card, laws council, politics, gazette, toasts
public/js/main.js    rendering, lighting, weather, fireworks and camera
```

Calls use low effort and short replies to keep chatter quick and cheap, and at most 2 conversations run at once in live mode. Add residents by appending to `RESIDENTS` in `public/js/residents.js` (all 13 houses are taken, so add a house in `map.js` too). To add a new model, add it to `MODELS` and to `PROVIDERS` in `providers.js`.
