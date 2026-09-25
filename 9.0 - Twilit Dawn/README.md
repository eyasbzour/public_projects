# Twilit Dawn

A single [Dusklight](https://github.com/TwilitRealm/dusklight) mod (the Twilight Princess PC port) built from three community mods:

- [Twilit Essentials](https://github.com/F1mmel/dusklight-twilit-essentials) by Fimmel
- [Dawnlight](https://github.com/BeZide93/dawnlight) by BeZide93
- [A Link Between Twilight](https://github.com/WadeWinningWilson/albt-dusks) by WadeWinningWilson

Running the three side by side works badly. They hook the same parts of the game, draw over each other's HUD, ship their own versions of the same features and fight over the same buttons. Twilit Dawn compiles all three into one mod and sorts that out.

## What you get

All three mods' settings sit in one window, grouped by topic (Combat, HUD, Items, Difficulty and so on). Open it from Twilit Dawn in the in-game menu bar, or go to Mods, then Twilit Dawn, then Open Twilit Dawn Settings.

When more than one mod has the same feature, a single setting at the top of that tab picks which one runs, so two versions never run at once:

| Choice | Options |
|---|---|
| Z item slot | Essentials, Dawnlight, ALBW, ALBW with D-pad quick swap, or off |
| Stamina & sprint | Essentials, Dawnlight, or ALBW's meter |
| Flurry rush | Essentials, Dawnlight, or ALBW |
| Shield style | The game's own, Dawnlight's RT guard while locked on, or ALBW's parry and bash, with or without holding RT to guard |
| Gliding | Dawnlight's glide or ALBW's Deku Leaf |
| Enemy difficulty | Dawnlight's hard mode or ALBW's Devil Trigger |
| Boss fights | Dawnlight's boss hard mode or ALBW's boss refinement |
| Enemy and boss HP bars | Essentials or ALBW |

Some settings stay in their own mod's tab but can't be on together, because they need the same button or multiply each other. Turning one on switches the other off, and the setting's help text says what it will switch off:

- RT outside lock-on is Dawnlight's R jump and Revali's Gale, or ALBW's hold-RT guard and Deku Leaf launch.
- D-pad Left is Midna (with any Z item slot) or ALBW's End-Game Transform.
- ALBW's D-pad quick swap and Essentials' Quick Access or bottle wheel can't share D-pad Up, Right or Down.
- ALBW's meter charges for arrows, so it and Dawnlight's arrow modes don't run together.
- Dawnlight's enemy HP scale and ALBW's HP multipliers would compound (up to 12 times the health).
- Dawnlight's "no invincibility frames" and ALBW's harder damage settings would stack.
- Dawnlight's HUD layouts and ALBW's LoP HUD move the same buttons.
- Essentials' bottle wheel empties ALBW's soulbound potion.
- Essentials' Ordon Hero Collection page and ALBW's extended status page both use the D-pad.

Dawnlight Mode and Dawnlight's Progression switch on many Dawnlight features without changing their own switches, so they count as Dawnlight's side in all of the above.

Some problems only show up once the three share one mod, and Twilit Dawn fixes those too:

- When one mod removed its hooks (Essentials does this when you turn off its flurry rush, Dawnlight when you leave its Boss Rush), the game dropped the other two mods' hooks on the same functions until a restart. Now only the mod that asked loses its hooks.
- Dawnlight's Fierce Deity no longer makes Link invisible under ALBW's outfit system.
- Picking an ALBW outfit (wardrobe, D-pad quick swap or the Postman) takes off Essentials' Ordon Hero tunic, so the outfit actually shows. Picking Ordon Hero in the Collection still puts it back on.
- During an Essentials flurry rush, Dawnlight's and ALBW's Link logic keeps pace with Link instead of running at a third of his speed.

The title screen keeps the vanilla logo instead of Essentials' custom one.

`play.cmd` checks for new releases of the three mods and of the game before it starts Dusklight, and rebuilds Twilit Dawn when something changed. Each run adds a line to `update-run.log`, so a failed update doesn't go unnoticed.

## What's in this repository

This repository holds only the code that joins the three mods together, plus the build scripts. It includes none of the three mods' code: the build downloads each one from its official repository.

| File | Purpose |
|---|---|
| `update.py` | Downloads the three mods, applies the edits that let them live in one mod, and builds it |
| `switch_setup.py` | Installs Twilit Dawn and switches off separate copies of the three mods |
| `play.cmd` | Checks for updates, then starts the game |
| `build.cmd` | Compiles the mod with Visual Studio |
| `twilit-dawn/src/combo.cpp` | Starts, updates and stops the three mods as one |
| `twilit-dawn/src/hooks.cpp` | Keeps one mod's hook removal from removing the others' hooks |
| `twilit-dawn/src/overlaps.cpp` | The shared-feature choices and the settings that can't be on together |
| `twilit-dawn/src/settings_hub.cpp` | Builds the single settings window |

## Requirements

- Windows (x64) and Dusklight. Twilit Dawn was built and tested on Dusklight v2.0.1, and the build targets whatever version you have installed.
- [Python](https://www.python.org/) 3.10 or newer and [Git](https://git-scm.com/)
- [Visual Studio 2022](https://visualstudio.microsoft.com/) or its Build Tools, with the "Desktop development with C++" workload (it includes CMake and Ninja)
- Your own copy of the game, set up in Dusklight as usual

## Setup

1. Copy this folder into your Dusklight folder, next to `dusklight.exe`. Keep the path short (something like `C:\Games\Dusklight\Twilit Dawn`): the build creates deep folders and Windows limits paths to 260 characters.
2. In this folder, run:
   ```
   python update.py --force
   ```
   The first build downloads a few hundred MB and takes 10 to 20 minutes. Later updates are much faster.
3. Close Dusklight and run:
   ```
   python switch_setup.py dawn
   ```
   This installs Twilit Dawn, turns off any separate copies of Essentials, Dawnlight or A Link Between Twilight, backs up `data/config.json` once, and copies your existing A Link Between Twilight settings over.
4. Start the game with `play.cmd`. A shortcut to it works too.

To go back to plain Twilit Essentials, run `python switch_setup.py stock`.

Use `switch_setup.py` rather than the in-game Mods window to turn Twilit Dawn or the separate mods on and off, so two copies of the same mod never load together.

## Known limits

- Dawnlight reads its Z item slot setting when the game starts, so switching to or away from Dawnlight's slot takes effect after a restart.
- If you put on the Ordon Hero tunic while wearing ALBW's Sumo outfit, the tunic covers it. The Sumo outfit comes back when you take the tunic off.

## When an update fails

If one of the three mods changes code that Twilit Dawn's edits depend on, the rebuild stops with an error and your installed mod stays as it was. The game still starts. `update-run.log` and the build log in this folder show what broke, and the fix is usually small, in `update.py` or `twilit-dawn/src`.

## Credits

All gameplay features belong to the authors of Twilit Essentials, Dawnlight and A Link Between Twilight. Twilit Dawn only combines them, and it isn't affiliated with those authors, Twilit Realm or Nintendo.
