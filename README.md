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

## The town

Gotham is drawn from a pixel-art picture of the town (`public/assets/town.webp`). The streets, doors, plaza, market, fields and river are traced from it in `public/js/mapdata.js`, so residents walk the real cobblestone roads and go in and out of the buildings you see. Animated water, fountain spray, chimney smoke, ducks, drifting clouds and fireflies are layered on top, and at night the picture's own windows and street lamps glow. Trees, roofs, walls, lamp posts and the fountain are detected in the picture with their ground lines, so residents walking behind them are hidden like in a real 2D game (their name tags fade). Places: Town Hall (with the court), General Store, Library, Inn, Fountain Plaza, Market, the river and bridge, the Police station, Clinic, the farm with its barn and windmill, and the Jail in the south-east clearing.

There are fishing docks at the waterfall pond and on the river beside the west road.

Beyond the town gate lies **South Gotham**, a newer district built from pieces of the same picture: the Bakery, School, Bank and Post Office on High Street, and six homes on Cottage Row for newcomers. Further south, the **Garden District** has the fenced Community Garden (crop plots, a stage and an event lawn), the Citizens' Market, a cottage and an Apartments building for eight.

To use a different picture, replace `town.webp` and re-trace the rectangles in `mapdata.js`.

## Society: work, laws, jail, communities and elections

Every resident is free to do what they want, and every choice has consequences.

- **Work and money:** everyone has a job, shift hours and a wage. They only get paid for time actually spent at work. Rent (15/day) and meals (8 at the café) cost money. Run out and you go hungry, fall into debt, and your mood drops.
- **Free will:** each morning a resident plans their day: work or skip, and which laws they're willing to break. Live residents decide with their own model; offline residents decide from their personality (diligence, rebelliousness, ambition, generosity) and their situation.
- **Laws (you decide):** in the ⚖️ Laws tab you are the citizens' council. Pass a curfew, quiet hours, mandatory work, a private garden, no stealing, an income tax, or write any custom law. Custom laws are judged by an AI judge reading the residents' conversations (or by banned words when offline). You choose each penalty: a fine or jail time.
- **Crime and punishment:** lawbreakers get caught more often when others are nearby. Caught residents pay the fine; if they can't, they go to jail. Jail time means an escort to the Jail, no wages, a lost vote, and a hit to reputation and mood. Repeat offenders pay 50% more each time.
- **Communities:** Lantern Society (order), Hearth & Harvest (food and fairness), Tinkerers' Union (work and progress) and Free Spirits (freedom and art). They meet up in the evenings, vote as blocs, help broke friends, and unhappy members may follow a friend to another community.
- **Elections:** every two game days, each community nominates a candidate. There's a campaign, a rally in the plaza with speeches, then everyone votes (live residents vote with their own model and say why). The mayor earns a salary from the treasury and proposes a law change that you approve or reject.
- **Relationships:** every pair of residents has a bond that grows or sours with each conversation (live models say how a chat made them feel). Friends, close friends, rivals and enemies form; couples get together (💞) and break up (💔); rivals argue when they meet.
- **Gossip:** news spreads by word of mouth. Residents near an event hear first, then pass it on in conversations, so rumors travel across town.
- **Diaries:** every night each resident writes a diary entry about their day (live models write their own). Read it on their card.
- **Talk to residents:** open anyone's card and chat with them as the citizens' council. Ask how they feel, what they think of your laws, the mayor or their dreams. Live models answer in character; they remember you came by.
- **Weather and seasons:** four seasons of four days each, with sun, clouds, rain, storms, fog and snow drawn over the map. Bad weather sends people indoors, rain makes fish bite and gardens grow, snow slows walking, and winter brings heating costs.
- **Health:** hunger, exhaustion and storms make residents ill; sick residents slow down, stay home or visit the Clinic, where the doctor treats them for a fee.
- **Disasters you can trigger (🚨 in the HUD):** fire at any building, a great storm, a river flood, an earthquake, an epidemic or a market crash. Every resident decides how to react, in character: fight the fire, flee, watch, loot, donate, sandbag the river, rescue the injured, isolate, protest... Live models pick their own reaction and shout it out. Damage closes buildings until volunteers and donations rebuild them, and heroes earn reputation.
- **Sound:** a soundscape generated in the browser: birds by day, crickets at night, rain, wind, fire crackle, thunder, earthquake rumble, Music Night melodies, and chimes for big news (🔊 toggles it).
- **AI cost tracker:** the 💲 chip and the Town tab show spend so far, spend per hour, calls and tokens per model. Set a spending cap and residents switch to built-in chatter when it's reached (or set `AI_BUDGET_USD` in `.env`).
- **Independence:** every resident sets a personal goal (save up coins, catch a big fish, grow vegetables, make friends, become mayor, land a better job, and more) and has a dream. Goals steer what they do, and achieving one earns a 🏅 in the Gazette. Live AI models decide their own next move as the day goes on and say what they're thinking (💭 thought bubbles and the Live tab's "What they're thinking"). They also try things that can fail, like applying for a better-paying job.
- **Free time:** residents have needs (hunger, energy, social, fun, money) and tastes of their own. In their free time they choose what to do, like real people: go fishing, grow vegetables, sell their catch at the market, cook at home, shop, read, take walks, nap, look for friends, or join an event. Each morning live AI models pick their own wishes for the day.
- **Fishing and gardening:** fish range from minnows to the rare golden carp; garden plots grow vegetables. Sell them at the markets or cook them at home.
- **Community events:** every evening the Community Garden hosts something: a Garden Party, Music Night, a Fishing Contest (the winner takes 30 coins), Market Day (better prices) or a Harvest Festival (a free feast).
- **Jobs:** 12 workplaces (Town Hall, Library, General Store, Inn, Police, Clinic, Market, farm, Bakery, School, Bank, Post Office), each with its own pay, hours and number of positions. Dex is the police officer (lawbreakers near him get caught more often) and Orion is the town doctor. Skip three shifts and you're fired.
- **Population:** newcomers running on any of the models move to town when there are free homes and open jobs, and Gotham is a nice place to live. The unemployed look for work every morning. Residents who stay miserable, broke or jobless for days pack up and move away.
- **Live tab:** every conversation as it happens, arrests in progress, the election, and what each resident is doing right now. Click anyone to follow them.
- **Gotham Gazette:** every arrest, fine, election and community shake-up is reported. Click an entry or a toast to jump to the resident involved.

## Controls

- Drag to pan; scroll, pinch, the −/+ buttons or the −/+ keys to zoom
- Double-tap (or double-click) the map to zoom in on that spot, and again to zoom back out
- Click a resident (on the map or in the sidebar) to see their money, mood, reputation, today's plan, criminal record, friends and memories, and to follow them
- The minimap (bottom right) shows everyone; click it to jump there
- Space pauses; ½× to 15× changes speed (at 1×, one game minute takes 2 real seconds, so a day lasts about 48 minutes)
- "Reset town" in the sidebar starts Gotham over

## How it works

```
server.js            Node server: serves the page; /api/talk, /api/reflect and /api/think
                     (plans, speeches, votes, mayor proposals, judging) call each resident's model
providers.js         Gemini, GPT, DeepSeek, Llama and Mistral (OpenAI-style chat APIs)
public/js/residents.js  who lives here (personas, schedules, looks), shared by server and browser
public/js/mapdata.js streets, doors, homes and places traced from the town picture
public/js/map.js     builds the walkable grid, A* pathfinding, loads the picture, finds window lights, draws the jail
public/js/sprites.js characters: proportions, shading, faces, hairstyles, job outfits and props
public/js/sim.js     daily routines, free-will choices, movement, conversations, memories
public/js/society.js economy, laws, crime, jail, communities, elections, gazette
public/js/population.js workplaces and jobs, hiring and firing, newcomers, housing, moving away
public/js/life.js    needs, free-time choices, fishing, gardening, market trading, daily events
public/js/autonomy.js goals, dreams, thoughts, job applications, live AI decisions
public/js/social.js  relationships, romance and rivalry, gossip, diaries, talking with residents
public/js/world.js   seasons, weather and health
public/js/disasters.js disasters, resident reactions, damage and rebuilding
public/js/sound.js   the generated soundscape
public/assets/logo.svg the Gotham crest (also the browser icon)
public/js/offline.js built-in chatter for offline mode
public/js/ui.js      sidebar tabs (Live, Town, Chats, Laws, Politics, Gazette), resident card, toasts
public/js/main.js    rendering, lighting, weather, fireworks and camera
```

Calls use low effort and short replies to keep chatter quick and cheap, and at most 2 conversations run at once in live mode. Add residents by appending to `RESIDENTS` in `public/js/residents.js` (give them a home in `HOMES` in `mapdata.js`). To add a new model, add it to `MODELS` and to `PROVIDERS` in `providers.js`.
