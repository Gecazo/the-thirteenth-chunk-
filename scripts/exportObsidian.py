#!/usr/bin/env python3
"""
SoulBot → Obsidian exporter.

Reads the bot's Markdown save (data/adam/adam.md) and writes an Obsidian vault
folder of linked notes + Dataview-friendly frontmatter + Mermaid graphs:

  SoulBot/
    Dashboard.md          - live overview, embedded graph views
    Soul.md               - identity, personality, values, emotions, needs
    Timeline.md           - full event chronology with day/time
    Memories.md           - long-term memories (salience ranked)
    People/<player>.md    - one note per known player with trust + history
    Sleep.md              - sleep ledger, consolidation audits
    Survival.md           - project state, skills, goals
    Research.md           - web research journal (if present)
    _assets/snapshot.json - raw checkpoint for advanced Dataview queries

Re-run any time; every file is regenerated (bot must be stopped or you'll
race the writer lock — the exporter never writes to the source file).
"""
import json, re, sys, os
from datetime import datetime, timezone
from pathlib import Path

SAVE = Path(sys.argv[1] if len(sys.argv) > 1 else 'data/adam/adam.md')
OUT = Path(sys.argv[2] if len(sys.argv) > 2 else os.path.expanduser(
    'Library/Mobile Documents/iCloud~md~obsidian/Documents/Hermes/SoulBot'))

def load_checkpoint(path: Path):
    text = path.read_text()
    m = re.search(r'```json\n(.*?)\n```', text, re.S)
    if not m:
        sys.exit(f'No checkpoint found in {path}')
    return json.loads(m.group(1)), text

def ts(ms: float) -> str:
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).strftime('%Y-%m-%d %H:%M UTC')

def mc_time(tick: int) -> str:
    h = (tick // 1000 + 6) % 24
    return f'{h:02d}:00'

def fm(**kw) -> str:
    lines = ['---']
    for k, v in kw.items():
        if v is None: continue
        if isinstance(v, str): v = f'"{v}"'
        elif isinstance(v, bool): v = str(v).lower()
        lines.append(f'{k}: {v}')
    lines.append('---')
    return '\n'.join(lines) + '\n\n'

def events_table(events, kinds=None, limit=500, state=None):
    rows = ['| at | day | time | kind | intensity | valence | tag |', '|---|---|---|---|---|---|---|']
    shown = 0
    # The save's STM events lack timeOfDay; pair each event with the circadian clock
    # by its day+rough position is not possible — so we show UTC wall time only.
    for e in reversed(events):
        if kinds and e['kind'] not in kinds: continue
        rows.append(f"| {ts(e['at'])} | {e['day']} | — "
                    f"| **{e['kind']}** | {e.get('intensity',0):.2f} | {e.get('valence',0):+.2f} | {e.get('tag') or ''} |")
        shown += 1
        if shown >= limit: break
    return '\n'.join(rows) if shown else '_No events of this kind yet._'

def main():
    data, raw = load_checkpoint(SAVE)
    st, events = data['state'], data.get('events', [])
    (OUT / 'People').mkdir(parents=True, exist_ok=True)
    (OUT / '_assets').mkdir(exist_ok=True)
    name = st['identity']['name']

    # ---------- Dashboard ----------
    people_lines = '\n'.join(f'      [[People/{p["player"]}]] trust {round(p["trust"]*100)}%' for p in st['social']) or '      no one yet'
    (OUT / 'Dashboard.md').write_text(fm(title=f'{name} — Dashboard', bot=name, updated=datetime.now().strftime('%Y-%m-%d %H:%M'))
      + f'''# {name} — everything I know, think and feel

> **Persona:** {st['identity']['persona']}
> **Identity:** `{st['identity']['id']}` · born {ts(st['identity']['createdAt'])}

| | | | |
|---|---|---|---|
| **Health** {st['vitals']['health']}/20 | **Food** {st['vitals']['food']}/20 | **World day** {st['circadian']['day']} | **Time** {mc_time(st['circadian']['timeOfDay'])} |

**Intentions:** {', '.join(st['goals']['intentions']) or '—'}
**Goal:** {st['goals'].get('userGoal') or '—'}

## Mind map

```mermaid
mindmap
  root(({name}))
    Personality
      curiosity {round(st['personality']['curiosity']*100)}%
      sociability {round(st['personality']['sociability']*100)}%
      caution {round(st['personality']['caution']*100)}%
      patience {round(st['personality']['patience']*100)}%
    Values
      kindness {round(st['values']['kindness']*100)}%
      prudence {round(st['values']['prudence']*100)}%
      helpfulness {round(st['values']['helpfulness']*100)}%
    Emotions
      joy {round(st['emotions']['joy']*100)}%
      fear {round(st['emotions']['fear']*100)}%
      curiosity {round(st['emotions']['curiosity']*100)}%
      calm {round(st['emotions']['calm']*100)}%
    Needs
      safety {round(st['needs']['safety'])}
      hunger {round(st['needs']['hungerNeed'])}
      loneliness {round(st['needs']['loneliness'])}
      energy {round(st['needs']['energy'])}
      sleep debt {round(st['needs']['sleepDebt'])}
    People
{people_lines}
```

## Navigate

- [[Soul]] — personality, values, emotions, needs
- [[Timeline]] — everything that happened, chronologically
- [[Memories]] — long-term memories
- [[Sleep]] — nights consolidated
- [[Survival]] — building project, skills, goals
- [[Research]] — web research journal

## Events by kind

```dataview
TABLE length(rows) AS "count"
FROM "SoulBot/Timeline"
FLATTEN file.lists AS item
GROUP BY item.kind
```
''')

    # ---------- Soul ----------
    personality_rows = '\n'.join(f'| {k} | {round(v*100)}% |' for k, v in st['personality'].items())
    values_rows = '\n'.join(f'| {k} | {round(v*100)}% |' for k, v in st['values'].items())
    emotion_rows = '\n'.join(f'| {k} | {round(v*100)}% |' for k, v in st['emotions'].items())
    need_rows = '\n'.join(f'| {k} | {round(v)} |' for k, v in st['needs'].items())
    (OUT / 'Soul.md').write_text(fm(title=f'{name} — Soul', bot=name)
      + f'''# {name}'s soul

## Personality (fixed traits, drift only during sleep)

| trait | value |
|---|---|
{personality_rows}

## Values

| value | weight |
|---|---|
{values_rows}

## Current emotions (decaying to baseline)

| emotion | now |
|---|---|
{emotion_rows}

## Needs right now

| need | score /100 |
|---|---|
{need_rows}

## Circadian

World day **{st['circadian']['day']}**, time **{mc_time(st['circadian']['timeOfDay'])}**,
sleeping: {'yes' if st['circadian']['sleeping'] else 'no'},
last consolidated night: {st['circadian'].get('lastSleepDay') or 'never'}

## Event-emotion graph (recent history)

```mermaid
xychart-beta
    title "Emotional traces"
    x-axis [joy, fear, curiosity, calm]
    y-axis "percent" 0 --> 100
    bar [{round(st['emotions']['joy']*100)}, {round(st['emotions']['fear']*100)}, {round(st['emotions']['curiosity']*100)}, {round(st['emotions']['calm']*100)}]
```

Back to [[Dashboard]].
''')

    # ---------- Timeline ----------
    tl = fm(title=f'{name} — Timeline', bot=name, events=len(events))
    tl += f'# Timeline — {len(events)} recorded events\n\n'
    counts = {}
    for e in events: counts[e['kind']] = counts.get(e['kind'], 0) + 1
    tl += '```mermaid\npie showData title Events by kind\n'
    for kind, count in sorted(counts.items(), key=lambda kv: -kv[1]):
        tl += f'    "{kind}" : {count}\n'
    tl += '```\n\n'
    for kind in sorted(counts, key=lambda k: -counts[k]):
        tl += f'## {kind} ({counts[kind]})\n\n{events_table(events, kinds={kind}, limit=200)}\n\n'
    (OUT / 'Timeline.md').write_text(tl)

    # ---------- People ----------
    for p in st['social']:
        pname = p['player']
        journal_players = st.get('journal', {}).get('players', [])
        note = ''
        if isinstance(journal_players, dict):
            note = journal_players.get(pname.lower()) or journal_players.get(pname) or ''
        elif isinstance(journal_players, list):
            for entry in journal_players:
                if isinstance(entry, dict) and (entry.get('player') or '').lower() == pname.lower():
                    note = entry.get('note') or json.dumps(entry)
                    break
        hist = [e for e in events if pname.lower() in json.dumps(e).lower()]
        (OUT / f'People/{pname}.md').write_text(fm(title=pname, player=pname, trust=p['trust'], last_seen=ts(p['lastSeen']), bot=name)
          + f'''# {pname}

**Simulated trust:** {round(p['trust']*100)}% — *this is a role-play stat, not a permission signal.*
**Last seen:** {ts(p['lastSeen'])}
**Related events in history:** {len(hist)}

## My journal note about them

{note or '_No note yet._'}

## Encounters

{events_table(hist, limit=50)}

Back to [[Dashboard]].
''')

    # ---------- Sleep ----------
    sleep = data.get('sleep') or []
    audits = data.get('audit') or []
    (OUT / 'Sleep.md').write_text(fm(title=f'{name} — Sleep ledger', bot=name, nights=len(sleep) if isinstance(sleep, list) else 0)
      + f'''# Sleep ledger

No nights consolidated yet — the bot has to actually reach a bed at night on the server.

## Consolidation audits

{json.dumps(audits, indent=2) if audits else '_None yet._'}

Back to [[Dashboard]].
''')

    # ---------- Survival ----------
    proj = st.get('project')
    skills = st.get('skills') or {}
    (OUT / 'Survival.md').write_text(fm(title=f'{name} — Survival', bot=name)
      + f'''# Survival progress

## Goals

- **User goal:** {st['goals'].get('userGoal') or '—'}
- **Intentions:** {', '.join(st['goals']['intentions'])}

## Project

```json
{json.dumps(proj, indent=2) if proj else 'No anchor yet.'}
```

## Skills

{json.dumps(skills, indent=2) if skills else '_No skills recorded yet._'}

Back to [[Dashboard]].
''')

    # ---------- Research ----------
    research_log = SAVE.parent / 'research.log'
    if research_log.exists():
        entries = [json.loads(l) for l in research_log.read_text().splitlines() if l.strip()]
        body = f'# Web research journal — {name}\n\nThe bot never lets chat drive URLs; queries are sanitized and logged here.\n\n'
        for e in entries:
            body += f"## {e.get('at','')} — “{e.get('query','')}”\n\n"
            if e.get('ok'):
                for r in e.get('results', []):
                    body += f"- [{r.get('title','')}]({r.get('url','')}) — {r.get('snippet','')}\n"
            else:
                body += f"_failed: {e.get('error','')}_\n"
            body += '\n'
        (OUT / 'Research.md').write_text(fm(title=f'{name} — Research', bot=name) + body)

    # ---------- raw snapshot ----------
    (OUT / '_assets/snapshot.json').write_text(json.dumps(data, indent=2))
    print(f'Exported {len(events)} events, {len(st["social"])} people → {OUT}')

if __name__ == '__main__':
    main()
