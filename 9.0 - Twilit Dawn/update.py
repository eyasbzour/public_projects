"""Keep Twilit Dawn in sync with upstream Twilit Essentials, Dawnlight, A Link Between Twilight and the game.

  python update.py              check GitHub + the game build; rebuild and install if anything changed
  python update.py --launcher   same, but ask before rebuilding (used by play.cmd, via the "Play Twilit" shortcut)
  python update.py --force      rebuild even when nothing changed
  python update.py --regen      only regenerate the source tree from upstream/ (no fetch, no build)

A rebuild fetches the new upstream sources, re-applies every Twilit change (id, defaults, the merge
glue, updater removal), builds the mod and copies the .dusk into data/mods. The installed mod is only
replaced when the build succeeds.
"""
import json
import re
import shutil
import subprocess
import sys
import urllib.request
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
GAME = HERE.parent
UPSTREAM = HERE / 'upstream'
DUSKLIGHT = HERE / 'dusklight'
STATE = HERE / 'built.json'
REPOS = {'essentials': 'F1mmel/dusklight-twilit-essentials', 'dawnlight': 'BeZide93/dawnlight',
         'albw': 'WadeWinningWilson/albt-dusks'}
RELEASES = {'albw': 'WadeWinningWilson/A-Link-Between-Twilight'}  # ALBW publishes releases from its other repo
DUSKLIGHT_REPO = 'https://github.com/TwilitRealm/dusklight.git'
DEPS = {  # name: (repo, ref, folder), the versions Dawnlight's own build pins
    'rmlui': ('https://github.com/mikke89/RmlUi.git', 'f9b8c9e2935d5df2c7dff2c190d3968e99b0c3dc', 'Include'),
    'sdl3': ('https://github.com/libsdl-org/SDL.git', 'release-3.4.10', 'include'),
}
BUILT = HERE / 'twilit-dawn/build/mods/twilit_dawn.dusk'
INSTALLED = GAME / 'data/mods/com.eyas.twilit_dawn.dusk'

# Essentials replaces the title-screen logo with a "Twilit Essentials" one; Twilit Dawn keeps the vanilla logo.
TITLE_LOGO = 'tex1_608x100_0c1c70378fb8cb46_6.png'
# Twilit Dawn's defaults where they differ from upstream Essentials.
ESSENTIALS_DEFAULTS = {
    'generalHumanWarpAnimation': 'true', 'generalSprintFovKick': 'true',
    'visibleEquipmentEnabled': 'true', 'customZButtonEnabled': 'true',
    'quickAccessEnabled': 'true', 'sheathedSpinEnabled': 'true', 'flurryRushEnabled': 'true',
    'staminaSprint': 'true', 'staminaWolfSprint': 'true', 'staminaSwimSprint': 'true',
    'staminaSprintSpeed': '135', 'staminaWolfSprintSpeed': '135', 'staminaSwimSprintSpeed': '135',
    'collectionStarterEquip': 'true', 'collectionShowOrdonHero': 'true',
}
# Essentials owns Z slot, stamina and flurry rush; Dawnlight's updater is gone; migrations already ran.
DAWNLIGHT_DEFAULTS = {
    'z-item-slot': 'false', 'stamina-enabled': 'false', 'check-for-updates': 'false',
    'aim-defaults-v2': 'true', 'hud-layout-migrated-v1': 'true', 'hud-layout-migrated-v2': 'true',
    'hud-combat-meters-migrated-v1': 'true',
}
# A game helper defined at file scope in a .cpp (compat shims mods ship because the game doesn't export them).
GAME_FN_DEF = re.compile(r'^[A-Za-z_][\w \t*&:<>,]*?\b((?:d|f|m|c)[A-Z]\w*_\w+)\s*\((?:[^;\n]*$|[^\n]*\)\s*(?:const\s*)?\{)',
                         re.M)
IMPORT_LINE = re.compile(r'^IMPORT_[A-Z_]*SERVICE[A-Z_]*\((\w+),\s*(\w+)[^\n]*\);[^\n]*\n', re.M)
SOURCE_EXTS = ('.cpp', '.hpp', '.h', '.inc')


class UpdateError(Exception):
    pass


# ---------------------------------------------------------------- helpers

def git(*args, cwd):
    subprocess.run(['git', '-c', 'http.version=HTTP/1.1', '-c', 'advice.detachedHead=false', *args],
                   cwd=cwd, check=True)


def sub1(text, old, new, what):
    if text.count(old) != 1:
        raise UpdateError(f'{what}: expected one match, found {text.count(old)}')
    return text.replace(old, new)


def resub1(pattern, repl, text, what, flags=0):
    text, n = re.subn(pattern, repl, text, count=1, flags=flags)
    if n != 1:
        raise UpdateError(f'{what}: pattern not found')
    return text


def edit(path, fn):
    path.write_text(fn(path.read_text(encoding='utf-8')), encoding='utf-8', newline='')


def copy(src, dst):
    if dst.exists():
        shutil.rmtree(dst) if dst.is_dir() else dst.unlink()
    if src.is_dir():
        shutil.copytree(src, dst, ignore=shutil.ignore_patterns('.git'))
    elif src.exists():
        shutil.copy2(src, dst)
    else:
        dst.mkdir(parents=True)  # e.g. an empty overlay/ that git does not store


def mod_json(path, **fields):
    data = json.loads(path.read_text(encoding='utf-8'))
    data.update(fields)
    text = json.dumps(data, indent=2)
    if path.read_text(encoding='utf-8') != text:
        path.write_text(text, encoding='utf-8')


def sync(src, dst):
    """Mirror src into dst, rewriting only files whose bytes differ (fresh mtimes, so ninja rebuilds
    exactly what changed) and deleting files upstream no longer has."""
    if src.is_file():
        if not dst.is_file() or dst.read_bytes() != src.read_bytes():
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(src, dst)
        return
    dst.mkdir(parents=True, exist_ok=True)
    for extra in [p for p in dst.iterdir() if not (src / p.name).exists()]:
        shutil.rmtree(extra) if extra.is_dir() else extra.unlink()
    for child in src.iterdir():
        sync(child, dst / child.name)


# ---------------------------------------------------------------- versions

def game_rev():
    m = re.search(rb'Revision:\s+([0-9a-f]{40})', (GAME / 'dusklight.exe').read_bytes())
    return m.group(1).decode() if m else None


def latest_tag(repo):
    req = urllib.request.Request(f'https://api.github.com/repos/{repo}/releases/latest',
                                 headers={'User-Agent': 'twilit-updater'})
    try:
        with urllib.request.urlopen(req, timeout=8) as r:
            return json.load(r)['tag_name']
    except Exception:
        return None  # offline or rate limited: keep what we have


def game_running():
    out = subprocess.run(['tasklist', '/FI', 'IMAGENAME eq dusklight.exe'], capture_output=True, text=True)
    return 'dusklight.exe' in out.stdout


# ---------------------------------------------------------------- fetch

def fetch_upstream(name, tag):
    d = UPSTREAM / name
    if not d.exists():
        git('clone', '-q', '--depth', '1', '--branch', tag, f'https://github.com/{REPOS[name]}.git', str(d), cwd=HERE)
        return
    git('fetch', '-q', '--depth', '1', 'origin', 'tag', tag, cwd=d)
    git('checkout', '-q', '--force', tag, cwd=d)


def fetch_dusklight(rev):
    if not (DUSKLIGHT / '.git').exists():
        DUSKLIGHT.mkdir(parents=True, exist_ok=True)
        git('init', '-q', cwd=DUSKLIGHT)
        git('remote', 'add', 'origin', DUSKLIGHT_REPO, cwd=DUSKLIGHT)
    git('fetch', '-q', '--depth', '1', 'origin', rev, cwd=DUSKLIGHT)
    git('checkout', '-q', '--force', 'FETCH_HEAD', cwd=DUSKLIGHT)
    git('submodule', 'update', '-q', '--init', '--depth', '1', 'extern/aurora', cwd=DUSKLIGHT)


def fetch_deps():
    """Header-only copies of RmlUi and SDL3 that Dawnlight's touch-UI code compiles against."""
    for name, (url, ref, sub) in DEPS.items():
        d = HERE / 'deps' / name
        if (d / sub).is_dir():
            continue
        d.mkdir(parents=True, exist_ok=True)
        if not (d / '.git').exists():
            git('init', '-q', cwd=d)
            git('remote', 'add', 'origin', url, cwd=d)
        git('sparse-checkout', 'set', sub, cwd=d)
        git('fetch', '-q', '--depth', '1', '--filter=blob:none', 'origin', ref, cwd=d)
        git('checkout', '-q', '--force', 'FETCH_HEAD', cwd=d)


# ---------------------------------------------------------------- source edits

def seed_essentials(src):
    for key, val in ESSENTIALS_DEFAULTS.items():
        m = re.search(r'(\w+)\.name = "%s";' % re.escape(key), src)
        if not m:
            raise UpdateError(f'Essentials setting {key} not found')
        kind = 'int' if val.isdigit() else 'bool'
        src = resub1(r'(%s\.default_%s = )[^;]+;' % (re.escape(m.group(1)), kind), r'\g<1>%s;' % val,
                     src, f'Essentials default for {key}')
    return src


def seed_dawnlight(src):
    for key, val in DAWNLIGHT_DEFAULTS.items():
        src = resub1(r'(register_bool\("%s", )(true|false),' % re.escape(key), r'\g<1>%s,' % val,
                     src, f'Dawnlight default for {key}')
    return src


def essentials_for_dawn(src):
    src = resub1(r'DEFINE_MOD\(\);\n\n(IMPORT_(OPTIONAL_)?SERVICE\([^\n]*\n)+\nextern "C" MOD_EXPORT const void\* '
                 r'const g_keep_mod_records\[\] = \{\n.*?\n\};\n', '', src, 'Essentials mod definition', re.S)
    for f in ('initialize', 'update', 'shutdown'):
        src = sub1(src, f'MOD_EXPORT ModResult mod_{f}(', f'ModResult essentials_mod_{f}(', f'Essentials mod_{f}')
    return src


def strip_imports(src):
    """Service imports outside a mod's main file move to src/imports.inc (one definition per service in the
    merged DLL); a declaration stays behind, since not every SDK header declares its service variable."""
    return IMPORT_LINE.sub(lambda m: f'extern const {m.group(1)}* {m.group(2)};  // defined in src/imports.inc\n', src)


UNINSTALL_CALL = re.compile(r'\bmods::hook(?:::|_)uninstall<\s*([\w:]+)\s*>\(\s*([\w.>-]*)\s*\)')
UNINSTALL_DECL = ('ModResult twilit_hook_uninstall(const HookService* hooks, void* target, void** original,\n'
                  '    const HookService** entry_hooks);  // Twilit Dawn src/hooks.cpp\n')


def route_uninstalls(src):
    """The merged codebases share one trampoline and original-function pointer per hooked function, and the host's
    uninstall drops all of a context's callbacks on it. Route uninstalls through src/hooks.cpp, which only drops the
    calling part's callbacks."""
    def call(m):
        entry, svc = m.group(1), m.group(2) or 'svc_hook'
        return (f'twilit_hook_uninstall({svc}, {entry}::target, reinterpret_cast<void**>(&{entry}::g_orig), '
                f'&{entry}::hooks)')
    new = UNINSTALL_CALL.sub(call, src)
    return src if new == src else after_includes(new, UNINSTALL_DECL)


def after_includes(src, text):
    """Insert text after the top include block (some files #include again further down, inside namespaces)."""
    at = None
    for m in re.finditer(r'^[^\n]*\n', src, re.M):
        line = m.group(0).strip()
        if line.startswith('#include'):
            at = m.end()
        elif line and not line.startswith(('#', '//', '/*', '*')):
            break
    if at is None:
        raise UpdateError('no top #include block to insert after')
    return src[:at] + text + src[at:]


def albw_clothes_pipeline(src):
    """Dawnlight's Fierce Deity swaps Link's model outside ALBW's clothes pipeline, and ALBW's draw guard then hides
    Link for the whole transform. Let the draw through while the transform is on (not on its model-reload frames)."""
    src = after_includes(src, 'namespace dawnlight {\nbool fierce_deity_active();\nbool fierce_deity_model_reload_active();\n'
                              '}  // namespace dawnlight\n')
    head = 'HookAction on_alink_draw_pre(ModContext*, void* args, void* retval, void*) {\n'
    return sub1(src, head, head + '    if (::dawnlight::fierce_deity_active() && '
                                  '!::dawnlight::fierce_deity_model_reload_active()) {\n'
                                  '        return HOOK_CONTINUE;  // Twilit Dawn: Dawnlight\'s Fierce Deity model\n'
                                  '    }\n', 'ALBW draw guard')


def essentials_flurry(src):
    """During a rush Essentials runs Link's execute ~3x per frame by calling the original function directly, which
    skips Dawnlight's and ALBW's execute hooks, so their per-frame Link logic fell to a third of Link's speed. Run the
    extra ticks through the hook trampoline instead (Essentials' own callbacks already ignore re-entry)."""
    return sub1(src, 'FlurryRushExecuteHook::g_orig(link);',
                'FlurryRushExecuteHook::trampoline(link);  // Twilit Dawn: every mod\'s execute hooks run each tick',
                'Essentials flurry extra ticks')


OUTFIT_HANDOFF_DECL = 'void twilit_albw_outfit_changing();  // Twilit Dawn src/combo.cpp\n'


def albw_outfit(src):
    """Essentials re-forces its custom tunic (Ordon Hero) every frame, so an ALBW outfit change never loaded. Every
    ALBW equip (wardrobe, D-pad quick swap, rental, storage) now takes the custom tunic off first."""
    blocked = ('        dAlbwOutfit_debugLog("equip kind=%d blocked stage", (int)kind);\n'
               '        return false;\n    }\n')
    src = sub1(src, blocked, blocked + '    twilit_albw_outfit_changing();\n', 'ALBW outfit equip')
    return after_includes(src, OUTFIT_HANDOFF_DECL)


def albw_rental(src):
    head = 'void grantClothes(u8 itemNo) {\n'
    src = sub1(src, head, head + '    twilit_albw_outfit_changing();\n', 'ALBW rental clothes')
    return after_includes(src, OUTFIT_HANDOFF_DECL)


def albw_mod_cpp(src):
    src = sub1(strip_imports(src), 'DEFINE_MOD();\n', '', 'ALBW DEFINE_MOD')
    for f in ('initialize', 'update', 'shutdown'):
        src = sub1(src, f'MOD_EXPORT ModResult mod_{f}(', f'ModResult albw_mod_{f}(', f'ALBW mod_{f}')
    return src


def dawnlight_mod_cpp(src):
    src = resub1(r'DEFINE_MOD\(\);\n(IMPORT_SERVICE\([^\n]*\n)+', '', src, 'Dawnlight mod definition')
    src = src.replace('#include "update_service.hpp"\n', '')
    src = re.sub(r'    if \(const ModResult result = dawnlight::init_update_service\(\n.*?\n    \}\n', '', src,
                 flags=re.S)
    src = src.replace('    dawnlight::update_update_service(svc_log, mod_ctx, svc_ui);\n', '')
    src = src.replace('    dawnlight::shutdown_update_service();\n', '')
    if 'update_service(' in src:
        raise UpdateError('Dawnlight mod.cpp still calls its updater')
    for f in ('initialize', 'update', 'shutdown'):
        src = sub1(src, f'MOD_EXPORT ModResult mod_{f}(', f'ModResult dawnlight_mod_{f}(', f'Dawnlight mod_{f}')
    reg = ('    if (const ModResult result = dawnlight::register_config(error); result != MOD_OK) {\n'
           '        return result;\n    }\n')
    src = sub1(src, reg, reg + '    twilit_dawn_resolve_conflicts();\n', 'Dawnlight register_config')
    return sub1(src, 'extern "C" {\n\nModResult dawnlight_mod_initialize',
                'void twilit_dawn_resolve_conflicts();\n\nextern "C" {\n\nModResult dawnlight_mod_initialize',
                'Dawnlight extern "C" block')


def imports_inc(mod_cpps):
    """Union of every service import in the three codebases; required wins over optional."""
    headers = {}
    for h in sorted((DUSKLIGHT / 'sdk/include/mods/svc').glob('*.h')):
        for m in re.finditer(r'MOD_DECLARE_SERVICE\(\s*(\w+)', h.read_text(encoding='utf-8')):
            headers[m.group(1)] = h.name
    imports = {}
    for src in mod_cpps:
        for opt, typ, var in re.findall(r'^IMPORT_(OPTIONAL_)?SERVICE(?:_VERSION)?\((\w+),\s*(\w+)', src, re.M):
            required = imports.get(var, (typ, False))[1] or not opt
            imports[var] = (typ, required)
    snake = lambda t: re.sub(r'(?<!^)(?=[A-Z])', '_', t[:-len('Service')]).lower() + '.h'
    lines = ['// Generated by update.py from the three mods\' service imports. Do not edit.']
    lines += sorted({f'#include "mods/svc/{headers.get(t, snake(t))}"' for t, _ in imports.values()})
    lines += ['', 'DEFINE_MOD();']
    order = sorted(imports, key=lambda v: (not imports[v][1], v))
    lines += [f'IMPORT_{"" if imports[v][1] else "OPTIONAL_"}SERVICE({imports[v][0]}, {v});' for v in order]
    lines += ['', '// MSVC drops unreferenced metadata records without this (same trick as upstream Essentials).',
              'extern "C" MOD_EXPORT const void* const g_keep_mod_records[] = {', '    &mod_meta_header_record,']
    lines += [f'    &mod_meta_import_{v},' for v in order] + ['};', '']
    return '\n'.join(lines)


def albw_renames(ess, albw):
    """Game helpers both Essentials and ALBW define: ALBW's files are compiled with them renamed, so each
    codebase keeps calling its own copy (some of ALBW's differ) and the linker sees no duplicates."""
    def defined(roots):
        return {m.group(1) for root in roots for f in root.rglob('*.cpp')
                for m in GAME_FN_DEF.finditer(f.read_text(encoding='utf-8', errors='replace'))}
    dup = sorted(defined([ess / 'src', ess / 'collection-lib/src']) & defined([albw / 'src']))
    albw_text = '\n'.join(f.read_text(encoding='utf-8', errors='replace') for f in (albw / 'src').rglob('*')
                          if f.suffix in SOURCE_EXTS)
    hooked = set(re.findall(r'DEFINE_HOOK\w*\(\s*&?(\w+)\s*,', albw_text))
    if hooked & set(dup):
        raise UpdateError(f'ALBW hooks a helper it shares with Essentials: {sorted(hooked & set(dup))}')
    return ';'.join(f'{name}=albw_{name}' for name in dup)


def cmake_sources(cmakelists):
    m = re.search(r'SOURCES\n(.*?)\n\s*MOD_JSON', cmakelists, re.S)
    if not m:
        raise UpdateError('could not read the source list from an upstream CMakeLists.txt')
    return m.group(1).split()


DAWN_CMAKE = '''cmake_minimum_required(VERSION 3.26)
project(twilit_dawn CXX)

# Twilit Dawn = Twilit Essentials + Dawnlight in one mod. Generated by update.py.
# Built against the exact Dusklight build it runs on (DUSKLIGHT_DIR = ../dusklight).
include("${CMAKE_CURRENT_SOURCE_DIR}/cmake/FetchDusklight.cmake")
add_subdirectory("${DUSKLIGHT_DIR}/sdk" dusklight-sdk EXCLUDE_FROM_ALL)
include("${CMAKE_CURRENT_SOURCE_DIR}/cmake/FetchCollectionLib.cmake")

# Dawnlight's touch UI compat needs private RmlUi/SDL3 headers (local copies in ../deps).
set(TWILIT_DEPS "${CMAKE_CURRENT_SOURCE_DIR}/../deps")

add_mod(twilit_dawn
    FEATURES game webgpu
    SOURCES
@SOURCES@
    MOD_JSON mod.json
    RES_DIR res
    OVERLAY_DIR overlay
    TEXTURES_DIR textures
)

target_link_libraries(twilit_dawn PRIVATE collection_lib)
target_include_directories(twilit_dawn PRIVATE
    "${DUSKLIGHT_DIR}/src"
    "${CMAKE_CURRENT_SOURCE_DIR}/dawnlight/include"
    "${TWILIT_DEPS}/rmlui/Include"
    "${TWILIT_DEPS}/sdl3/include"
)
target_compile_definitions(twilit_dawn PRIVATE DAWNLIGHT_VERSION="@DAWNLIGHT_VERSION@")

# Game helpers both Essentials and ALBW define: ALBW's files use their own renamed copies.
set_source_files_properties(
@ALBW_SOURCES@
    PROPERTIES COMPILE_DEFINITIONS "@ALBW_RENAMES@")

# Keep mod metadata section records (MSVC /OPT:REF would strip them).
if (MSVC)
    target_link_options(twilit_dawn PRIVATE "/OPT:NOREF")
endif ()
'''


# ---------------------------------------------------------------- generate

def generate(versions):
    ess, dl, albw = UPSTREAM / 'essentials', UPSTREAM / 'dawnlight', UPSTREAM / 'albw'
    ess_ver, dl_ver, albw_ver = versions['essentials'], versions['dawnlight'], versions['albw']

    # Three codebases in one DLL, glued by src/*.cpp (ours, never regenerated). Built in a staging
    # folder first, then synced so unchanged files keep their timestamps.
    final = HERE / 'twilit-dawn'
    out = HERE / '.stage'
    if out.exists():
        shutil.rmtree(out)
    for d in ('essentials', 'dawnlight', 'albw', 'src'):
        (out / d).mkdir(parents=True)
    copy(ess / 'src', out / 'essentials/src')
    copy(ess / 'collection-lib', out / 'essentials/collection-lib')
    for name in ('res', 'textures', 'overlay'):
        copy(ess / name, out / name)
        for other in (dl, albw):  # Essentials wins on clashes, then Dawnlight
            for f in (other / name).rglob('*') if (other / name).is_dir() else ():
                dst = out / name / f.relative_to(other / name)
                if f.is_file() and not dst.exists() and f.name != '.gitkeep':
                    dst.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(f, dst)
    (out / 'textures' / TITLE_LOGO).unlink(missing_ok=True)  # keep the vanilla title-screen logo
    for name in ('src', 'include', 'integration', 'LICENSE.md'):
        copy(dl / name, out / 'dawnlight' / name)
    copy(albw / 'src', out / 'albw/src')
    for root in ('essentials/src', 'essentials/collection-lib/src', 'dawnlight/src', 'albw/src'):
        for f in (out / root).rglob('*'):
            if f.suffix in SOURCE_EXTS and f.name != 'mod.cpp':  # main files get their own edits below
                edit(f, strip_imports)
    edit(out / 'albw/src/mod.cpp', albw_mod_cpp)
    edit(out / 'albw/src/clothes_pipeline.cpp', albw_clothes_pipeline)
    edit(out / 'albw/src/outfit.cpp', albw_outfit)
    edit(out / 'albw/src/rental_shop.cpp', albw_rental)
    edit(out / 'essentials/src/flurry_rush/flurry_rush.cpp', essentials_flurry)
    (out / 'dawnlight/src/update_service.cpp').unlink(missing_ok=True)
    (out / 'cmake').mkdir(exist_ok=True)
    shutil.copy2(ess / 'cmake/FetchDusklight.cmake', out / 'cmake/FetchDusklight.cmake')
    shutil.copy2(ess / 'cmake/FetchCollectionLib.cmake', out / 'cmake/FetchCollectionLib.cmake')
    edit(out / 'cmake/FetchCollectionLib.cmake', lambda s: sub1(
        s, '"${CMAKE_CURRENT_SOURCE_DIR}/collection-lib"', '"${CMAKE_CURRENT_SOURCE_DIR}/essentials/collection-lib"',
        'FetchCollectionLib path'))

    edit(out / 'essentials/src/mod.cpp', lambda s: essentials_for_dawn(seed_essentials(s)))
    edit(out / 'dawnlight/src/mod.cpp', dawnlight_mod_cpp)
    edit(out / 'dawnlight/src/config.cpp', seed_dawnlight)
    routed = 0
    for root in ('essentials/src', 'essentials/collection-lib/src', 'dawnlight/src', 'albw/src'):
        for f in (out / root).rglob('*'):
            if f.suffix in SOURCE_EXTS:
                routed += len(UNINSTALL_CALL.findall(f.read_text(encoding='utf-8', errors='replace')))
                edit(f, route_uninstalls)
    left = [str(f) for root in ('essentials', 'dawnlight', 'albw') for f in (out / root).rglob('*')
            if f.suffix in SOURCE_EXTS
            and re.search(r'\bhook(?:::|_)uninstall<', f.read_text(encoding='utf-8', errors='replace'))]
    if left:
        raise UpdateError('hook uninstall calls update.py could not route: ' + ', '.join(left))
    print(f'  routed {routed} hook uninstall calls through src/hooks.cpp')
    upstream_sources = [f.read_text(encoding='utf-8', errors='replace')
                        for root in (ess / 'src', dl / 'src', albw / 'src') for f in root.rglob('*')
                        if f.suffix in SOURCE_EXTS]
    (out / 'src/imports.inc').write_text(imports_inc(upstream_sources), encoding='utf-8')

    ess_src = cmake_sources((ess / 'CMakeLists.txt').read_text(encoding='utf-8'))
    dl_src = [s for s in cmake_sources((dl / 'CMakeLists.txt').read_text(encoding='utf-8'))
              if s != 'src/update_service.cpp']
    albw_src = cmake_sources((albw / 'CMakeLists.txt').read_text(encoding='utf-8'))
    sources = (['src/combo.cpp', 'src/hooks.cpp', 'src/overlaps.cpp', 'src/settings_hub.cpp']
               + ['essentials/' + s for s in ess_src]
               + ['dawnlight/' + s for s in dl_src]
               + ['albw/' + s for s in albw_src])
    dl_json = json.loads((dl / 'mod.json').read_text(encoding='utf-8'))
    (out / 'CMakeLists.txt').write_text(
        DAWN_CMAKE.replace('@SOURCES@', '\n'.join('        ' + s for s in sources))
                  .replace('@DAWNLIGHT_VERSION@', dl_json['version'])
                  .replace('@ALBW_SOURCES@', '\n'.join('    albw/' + s for s in albw_src))
                  .replace('@ALBW_RENAMES@', albw_renames(ess, albw)), encoding='utf-8')
    for rel in ('essentials', 'dawnlight', 'albw', 'res', 'textures', 'overlay', 'cmake', 'CMakeLists.txt',
                'src/imports.inc'):
        sync(out / rel, final / rel)
    shutil.rmtree(out)
    mod_json(final / 'mod.json',
             description='Twilit Essentials, Dawnlight and A Link Between Twilight in one mod, with one settings '
                         'window. Features more than one of them has are a single choice, so they never run twice. '
                         f'Built from Twilit Essentials {ess_ver}, Dawnlight {dl_ver} and A Link Between Twilight '
                         f'{albw_ver}.')


# ---------------------------------------------------------------- build / install

def build(name):
    log = HERE / f'{name}-build.log'
    with open(log, 'w', encoding='utf-8', errors='replace') as f:
        code = subprocess.run(['cmd', '/c', str(HERE / 'build.cmd'), name], stdout=f, stderr=subprocess.STDOUT).returncode
    if code != 0:
        errors = [l.strip() for l in log.read_text(encoding='utf-8', errors='replace').splitlines()
                  if re.search(r'error [A-Z]+\d+|fatal error|CMake Error|ninja: error', l)]
        raise UpdateError(f'{name} failed to build (see {log.name}):\n  ' + '\n  '.join(errors[:8]))


def install():
    if INSTALLED.exists():  # only replace what switch_setup.py installed; a fresh file would auto-enable
        shutil.copy2(BUILT, INSTALLED)


def report(message):
    """Print, and keep one line per run in update-run.log: the launcher window closes when the game starts."""
    print(message)
    with open(HERE / 'update-run.log', 'a', encoding='utf-8') as log:
        log.write(f'{datetime.now():%Y-%m-%d %H:%M}  {message.strip().splitlines()[0]}\n')


def main():
    args = set(sys.argv[1:])
    state = json.loads(STATE.read_text(encoding='utf-8'))
    if '--regen' in args:
        generate(state)
        print('Regenerated the Twilit Dawn source tree.')
        return

    want = dict(state)
    want['game_rev'] = game_rev() or state['game_rev']
    for name, repo in REPOS.items():
        want[name] = latest_tag(RELEASES.get(name, repo)) or state[name]
    changed = [k for k in want if want[k] != state.get(k)]
    if not changed and '--force' not in args:
        report('Twilit mods are up to date.')
        return
    for k in changed:
        label = {'game_rev': 'Dusklight game build'}.get(k, k.capitalize())
        print(f'  {label}: {state.get(k, "?")[:12]} -> {want[k][:12]}')
    if game_running():
        report('Close Dusklight first, then run this again.')
        return
    if '--launcher' in args and input('Rebuild Twilit Dawn now? It takes about 5 minutes. [Y/n] ').strip().lower().startswith('n'):
        report('Skipped. You will be asked again next launch.')
        return

    try:
        print('Fetching sources...')
        for name in REPOS:
            fetch_upstream(name, want[name])
        if want['game_rev'] != state['game_rev'] or not (DUSKLIGHT / 'sdk').is_dir():
            fetch_dusklight(want['game_rev'])
        fetch_deps()
        generate(want)
        print('Building Twilit Dawn...')
        build('twilit-dawn')
    except (UpdateError, subprocess.CalledProcessError, OSError) as e:
        print(f'\nUpdate failed, your installed mods were not touched.\n{e}\n'
              'An upstream change probably needs a fix in update.py or twilit-dawn/src.')
        report(f'Update failed: {e}')
        if '--launcher' in args:
            input('Press Enter to start the game with your current mods...')
        return

    install()
    STATE.write_text(json.dumps(want, indent=2) + '\n', encoding='utf-8')
    report('Twilit mods updated: ' + ', '.join(f'{k} {want[k][:12]}' for k in changed))


if __name__ == '__main__':
    main()
