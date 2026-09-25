"""Pick which mod setup Dusklight loads. Run with the game closed.

  python switch_setup.py dawn    Twilit Dawn: Essentials + Dawnlight + A Link Between Twilight in one mod
  python switch_setup.py stock   back to the original Twilit Essentials alone

Copies the built Twilit Dawn into data/mods, backs up data/config.json once, sets each mod's
"enabled" flag so no feature is loaded twice, and carries your stock A Link Between Twilight
settings and shop progress over to Twilit Dawn the first time.
"""
import json
import shutil
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
GAME = HERE.parent
CONFIG = GAME / 'data' / 'config.json'
MODS = GAME / 'data' / 'mods'
BUILT = HERE / 'twilit-dawn/build/mods/twilit_dawn.dusk'
DAWN = 'com.eyas.twilit_dawn'
RETIRED = 'com.eyas.twilit_essentials_albw'  # replaced by Twilit Dawn

SETUPS = {
    'dawn': {DAWN},
    'ultimate': {DAWN},  # old name for the same setup
    'stock': {'com.dusklight.twilit_essentials'},
}
MANAGED = {DAWN, RETIRED, 'com.dusklight.twilit_essentials', 'dev.bezide.dawnlight', 'dev.albt.albw'}


def escaped(mod_id):
    return mod_id.replace('_', '__').replace('.', '_')


def key(mod_id, name):
    return 'mod.%s.%s' % (escaped(mod_id), name)


def main():
    if len(sys.argv) != 2 or sys.argv[1] not in SETUPS:
        sys.exit(__doc__)
    on = SETUPS[sys.argv[1]]

    if BUILT.exists():
        shutil.copy2(BUILT, MODS / (DAWN + '.dusk'))
    elif DAWN in on:
        sys.exit('Twilit Dawn is not built yet: %s' % BUILT)
    (MODS / (RETIRED + '.dusk')).unlink(missing_ok=True)

    backup = CONFIG.with_name('config.before-eyas-mods.json')
    if not backup.exists():
        shutil.copy2(CONFIG, backup)

    cfg = json.loads(CONFIG.read_text(encoding='utf-8'))
    albw = 'mod.%s.' % escaped('dev.albt.albw')
    for k, v in list(cfg.items()):
        name = k[len(albw):]
        if k.startswith(albw) and name != 'enabled':
            cfg.setdefault(key(DAWN, name), v)
    for mod_id in MANAGED:
        cfg[key(mod_id, 'enabled')] = mod_id in on
    CONFIG.write_text(json.dumps(cfg, indent=4, sort_keys=True) + '\n', encoding='utf-8')
    print('Enabled:', ', '.join(sorted(on)))


if __name__ == '__main__':
    main()
