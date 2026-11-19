// Features and controls that Essentials, Dawnlight and A Link Between Twilight each claim are kept to
// one owner: turning one on switches the conflicting ones off, and the settings window shows one
// selector per shared feature. Settings are found by name through a ConfigService proxy that
// records every var the three codebases register, so no upstream code has to expose its handles.

#include "twilit.hpp"

#include "mods/service.hpp"
#include "mods/svc/config.h"
#include "mods/svc/log.h"

#include <algorithm>
#include <cstring>
#include <deque>
#include <iterator>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>

namespace {

// ---- config proxy: name -> handle for every var registered by any codebase

struct Var {
    ConfigVarHandle handle;
    ConfigVarType type;
};

const ConfigService* s_realConfig = nullptr;
ConfigService s_configProxy;
std::unordered_map<std::string, Var> s_vars;

ModResult proxy_register_var(ModContext* ctx, const ConfigVarDesc* desc, ConfigVarHandle* out) {
    const ModResult r = s_realConfig->register_var(ctx, desc, out);
    if (r == MOD_OK && desc != nullptr && desc->name != nullptr && out != nullptr) {
        s_vars[desc->name] = {*out, desc->type};
    } else if (r == MOD_CONFLICT && desc != nullptr && desc->name != nullptr) {
        svc_log->error(ctx, (std::string("config name used by two of the merged mods: ") + desc->name).c_str());
    }
    return r;
}

// Config callbacks run as the part that subscribed, so a hook uninstall inside one is attributed to it.
struct Subscription {
    ConfigChangedFn callback;
    void* user;
    int part;
};
std::deque<Subscription> s_subscriptions;

void subscription_thunk(ModContext* ctx, ConfigVarHandle v, const ConfigVarValue* value, const ConfigVarValue* old,
    void* user) {
    const Subscription& sub = *static_cast<const Subscription*>(user);
    const TwilitPartScope scope(sub.part);
    sub.callback(ctx, v, value, old, sub.user);
}

ModResult proxy_subscribe(ModContext* ctx, ConfigVarHandle v, ConfigChangedFn callback, void* user,
    ConfigSubscriptionHandle* out) {
    if (callback == nullptr) return s_realConfig->subscribe(ctx, v, callback, user, out);
    Subscription& sub = s_subscriptions.emplace_back(Subscription{callback, user, twilit_current_part()});
    return s_realConfig->subscribe(ctx, v, subscription_thunk, &sub, out);
}

const Var* find(const char* name) {
    if (name == nullptr) return nullptr;
    const auto it = s_vars.find(name);
    return it == s_vars.end() ? nullptr : &it->second;
}

ConfigVarHandle var(const char* name) {
    const Var* v = find(name);
    return v ? v->handle : 0;
}

// Bools read as 0/1.
int64_t get(const char* name) {
    const Var* v = find(name);
    if (v == nullptr) return 0;
    if (v->type == CONFIG_VAR_INT) {
        int64_t value = 0;
        return svc_config->get_int(mod_ctx, v->handle, &value) == MOD_OK ? value : 0;
    }
    bool value = false;
    return v->type == CONFIG_VAR_BOOL && svc_config->get_bool(mod_ctx, v->handle, &value) == MOD_OK && value;
}

void set(const char* name, int64_t value) {
    const Var* v = find(name);
    if (v == nullptr || get(name) == value) return;
    if (v->type == CONFIG_VAR_INT) svc_config->set_int(mod_ctx, v->handle, value);
    if (v->type == CONFIG_VAR_BOOL) svc_config->set_bool(mod_ctx, v->handle, value != 0);
}

// ---- groups: sides that can't be on together

constexpr const char* kEss = "Twilit Essentials";
constexpr const char* kDawn = "Dawnlight";
constexpr const char* kAlbw = "A Link Between Twilight";

bool nonzero(int64_t value) { return value != 0; }

// Essentials' button choices D-Pad Up, Down and Right: where ALBW's D-pad quick swap lives.
bool on_quick_swap_dpad(int64_t button) { return button == 7 || button == 8 || button == 10; }

// A var that counts as on at on_at or above (turning it off sets on_at - 1), and only while its
// gate var passes gate_on.
struct Member {
    const char* name = nullptr;
    int64_t on_at = 1;
    const char* gate = nullptr;
    bool (*gate_on)(int64_t) = nonzero;
    constexpr Member() = default;
    constexpr Member(const char* n, int64_t at = 1, const char* g = nullptr, bool (*g_on)(int64_t) = nonzero)
        : name(n), on_at(at), gate(g), gate_on(g_on) {}
};

bool is_on(const Member& m) {
    return m.name != nullptr && get(m.name) >= m.on_at && (m.gate == nullptr || m.gate_on(get(m.gate)));
}

void turn_off(const Member& m) {
    if (is_on(m)) set(m.name, m.on_at - 1);
}

// members[0] is what a selector switches on (and hides from that mod's own tab); the rest stay
// visible but still count as that side being on.
struct Side {
    const char* label;
    Member members[5];
};

constexpr size_t kSides = 4;

struct Group {
    const char* name;
    const char* topic;  // settings-window tab of its selector; nullptr: a rule with no selector
    const char* help;
    int owner;          // side that wins when several are on at startup
    Side sides[kSides];
};

const Group kGroups[] = {
    // Selector: the "Z item slot" choice below.
    {"Z item slot", nullptr, nullptr, 0, {{kEss, {"customZButtonEnabled"}}, {kDawn, {"z-item-slot"}},
        {kAlbw, {"extra_item_slot_mode"}}}},
    // Every Z item slot moves Midna to D-pad Left, where ALBW's End-Game Transform also sits.
    {"D-pad Left", nullptr, nullptr, 0,
        {{"Z item slot", {"customZButtonEnabled", "z-item-slot", "extra_item_slot_mode"}},
            {"End-Game Transform", {"end_game_transform"}}}},
    // ALBW's quick swap takes D-pad Up, Right and Down.
    {"D-pad quick swap", nullptr, nullptr, 0,
        {{kEss, {{"quickAccessEnabled", 1, "controlsQuickAccessButton", on_quick_swap_dpad},
                    {"bottlesQuickAccessEnabled", 1, "controlsBottlesButton", on_quick_swap_dpad}}},
            {kAlbw, {{"extra_item_slot_mode", 2}}}}},
    // Outside lock-on, RT is Dawnlight's jump or ALBW's guard and Deku Leaf launch. Dawnlight Mode and
    // Progression switch R jump and Revali's Gale on without saving them.
    {"RT", nullptr, nullptr, 0,
        {{kDawn, {"r-jump", "revalis-gale", "dawnlight-mode", "progression-system"}},
            {kAlbw, {"manual_shield", "deku_leaf"}}}},
    // Selector: the "Shield style" choice below. Dawnlight's manual shielding refuses ALBW's bash
    // start and then retries it, so each bash would spend two ALBW charges.
    {"Manual shielding", nullptr, nullptr, 0, {{kDawn, {"manual-shielding", "dawnlight-mode"}},
        {kAlbw, {"manual_shield", "shield_parry"}}}},
    // ALBW's meter charges for arrows and blocks the ammo writes Dawnlight's arrow modes rely on.
    {"Bow", nullptr, nullptr, 0, {{kDawn, {"arrow-modes", "dawnlight-mode"}}, {kAlbw, {"meter"}}}},
    // A quick-drink from Essentials' bottle wheel, then Dawnlight's item-integrity fix, empties
    // ALBW's soulbound bottle.
    {"Bottles", nullptr, nullptr, 0, {{kEss, {"bottlesQuickAccessEnabled"}}, {kAlbw, {"soulbound_potion"}}}},
    // Both use the D-pad on the Collection screen.
    {"Collection page", nullptr, nullptr, 0, {{kEss, {"collectionShowOrdonHero"}}, {kAlbw, {"ext_status_page"}}}},
    // ALBW's LoP HUD hides and re-anchors the buttons Dawnlight's layouts move.
    {"HUD layout", nullptr, nullptr, 0, {{kDawn, {"hud-layout"}}, {kAlbw, {"lop_hud_mode"}}}},
    // Both scale the same enemies' health, and the multipliers compound (up to 12x).
    {"Enemy HP", nullptr, nullptr, 0,
        {{kDawn, {{"hp-scale-percent", 101}, "dawnlight-mode"}},
            {kAlbw, {{"hp_normal", 2}, {"hp_midboss", 2}, {"hp_boss", 2}, {"hp_final", 2}, {"region_hp", 1, "region_mult"}}}}},
    // Losing invincibility frames and ALBW's harder damage (2x/4x incoming, region damage) multiply.
    {"Damage to Link", nullptr, nullptr, 0,
        {{kDawn, {"remove-normal-hit-invulnerability", "dawnlight-mode"}},
            {kAlbw, {{"incoming_damage_scale", 2}, "region_damage"}}}},
    {"Stamina & sprint", "Gameplay",
        "Whose stamina bar and sprint you use. Essentials has per-action costs and separate human, wolf and swim sprint "
        "(set them in Quality of Life). ALBW's meter also powers Focused Arts and the Deku Leaf glide, and charges for "
        "arrows, so it turns off Dawnlight's arrow modes.",
        0, {{kEss, {"staminaSprint", "staminaWolfSprint", "staminaSwimSprint", "staminaEnabled"}},
            {kDawn, {"stamina-enabled", "sprint", "dawnlight-mode", "progression-system"}}, {kAlbw, {"meter"}}}},
    {"Flurry rush", "Combat", "Whose flurry rush triggers after a perfect dodge. Essentials' version can be tuned below. ALBW's only "
        "works once you buy it at the Postman's rental shop.",
        0, {{kEss, {"flurryRushEnabled"}}, {kDawn, {"flurry-rush", "dawnlight-mode"}}, {kAlbw, {"flurry_rush"}}}},
    {"Gliding", "Gameplay", "Dawnlight's glide (Revali's Gale is its sub-option) or ALBW's Deku Leaf glide. Both use the "
        "jump buttons.",
        0, {{kDawn, {"glide", "revalis-gale", "dawnlight-mode", "progression-system"}}, {kAlbw, {"deku_leaf"}}}},
    {"Enemy difficulty", "Difficulty", "Dawnlight's enemy hard mode or ALBW's Devil Trigger. Both change how the same "
        "enemies fight.",
        0, {{kDawn, {"enemy-hard-mode", "dawnlight-mode"}}, {kAlbw, {"devil_trigger"}}}},
    {"Boss fights", "Difficulty", "Dawnlight's boss hard mode makes bosses faster and adds hazards. ALBW's boss "
        "refinement reworks several boss fights. Both change Fyrus and Diababa and don't stack well, so only one can be on.",
        0, {{kDawn, {"bossrush-hardmode-hazards", "dawnlight-mode"}}, {kAlbw, {"boss_refinement"}}}},
    {"Enemy HP bars", "HUD", "Health bars over regular enemies.", 0, {{kEss, {"hpBarsEnabled"}}, {kAlbw, {"enemy_hp_bars"}}}},
    {"Boss HP bars", "HUD", "A name and health bar for bosses.", 0, {{kEss, {"bossBarEnabled"}}, {kAlbw, {"boss_hp_bars"}}}},
};

bool present(const Side& s) { return s.label != nullptr && var(s.members[0].name) != 0; }

bool is_on(const Side& s) {
    return std::any_of(std::begin(s.members), std::end(s.members), [](const Member& m) { return is_on(m); });
}

void turn_off(const Side& s) {
    for (const Member& m : s.members) turn_off(m);
}

bool mentions(const Side& s, ConfigVarHandle v) {
    return v != 0 && std::any_of(std::begin(s.members), std::end(s.members),
        [v](const Member& m) { return var(m.name) == v || var(m.gate) == v; });
}

void keep_only(const Group& g, size_t keep) {
    for (size_t s = 0; s < std::size(g.sides); ++s) {
        if (s != keep) turn_off(g.sides[s]);
    }
}

void settle(const Group& g) {
    size_t count = 0, first = 0;
    for (size_t s = 0; s < std::size(g.sides); ++s) {
        if (is_on(g.sides[s]) && count++ == 0) first = s;
    }
    if (count > 1) keep_only(g, is_on(g.sides[g.owner]) ? g.owner : first);
}

// v was just turned on or changed: whatever it belongs to wins over what it conflicts with.
void claim(ConfigVarHandle v) {
    for (const Group& g : kGroups) {
        for (size_t s = 0; s < std::size(g.sides); ++s) {
            if (mentions(g.sides[s], v) && is_on(g.sides[s])) keep_only(g, s);
        }
    }
}

void on_member_changed(ModContext*, ConfigVarHandle changed, const ConfigVarValue* value, const ConfigVarValue*, void*) {
    if (value == nullptr) return;
    if (value->type == CONFIG_VAR_BOOL ? value->bool_value : value->type == CONFIG_VAR_INT && value->int_value != 0) {
        claim(changed);
    }
}

// Selector options: the sides that exist, then Off (index size).
size_t options(const Group& g, size_t (&sides)[kSides + 1]) {
    size_t n = 0;
    for (size_t s = 0; s < std::size(g.sides); ++s) {
        if (present(g.sides[s])) sides[n++] = s;
    }
    sides[n++] = std::size(g.sides);
    return n;
}

// ---- presets: choices that set several vars at once, so one setting can't silently change how
// another behaves (ALBW's parry setting alone turns the shield bash into a charge-based move)

struct Value {
    const char* name;
    int64_t value;
};
struct Choice {
    const char* label;
    Value values[4];
};
struct Preset {
    const char* name;
    const char* topic;
    const char* help;
    Choice choices[kSharedMaxOptions];
};

const Preset kPresets[] = {
    {"Z item slot", "Items",
        "Which mod puts a third item on Z. With any of them, calling Midna moves to D-pad Left.<br/><br/>"
        "<b>ALBW + D-pad quick swap</b> also takes D-pad Up (next sword), Right (next shield) and Down (next outfit), "
        "and LB opens the item wheel. With ALBW's wolf arts bought, wolf D-pad Up howls and Right sends Midna's hand. "
        "Essentials' Quick Access and bottle wheel turn off while they sit on one of those D-pad buttons.<br/><br/>"
        "ALBW's End-Game Transform also uses D-pad Left, so picking any slot turns it off.<br/><br/>"
        "Dawnlight reads its setting when the game starts: switching to or away from Dawnlight's slot takes effect "
        "after a restart.",
        {{"Twilit Essentials", {{"customZButtonEnabled", 1}, {"z-item-slot", 0}, {"extra_item_slot_mode", 0}}},
            {"Dawnlight", {{"customZButtonEnabled", 0}, {"z-item-slot", 1}, {"extra_item_slot_mode", 0}}},
            {"A Link Between Twilight", {{"customZButtonEnabled", 0}, {"z-item-slot", 0}, {"extra_item_slot_mode", 1}}},
            {"ALBW + D-pad quick swap", {{"customZButtonEnabled", 0}, {"z-item-slot", 0}, {"extra_item_slot_mode", 2}}},
            {"Off (Z calls Midna)", {{"customZButtonEnabled", 0}, {"z-item-slot", 0}, {"extra_item_slot_mode", 0}}}}},
    {"Shield style", "Combat",
        "<b>Classic</b>: the game's own guard (up while you lock on) and bash (RT while locked on).<br/>"
        "<b>Classic, RT guards while locked on</b> (Dawnlight): while locked on, the shield is only up while you hold "
        "RT. Press B while guarding to bash.<br/>"
        "<b>ALBW parry &amp; bash</b>: raising the shield right as a hit lands is a perfect guard and earns a bash "
        "charge. Hold RT and press B to bash; with no charges the bash is refused. This works with or without the "
        "ALBW meter.<br/>"
        "<b>ALBW parry &amp; bash, hold RT to guard</b>: the same, and holding RT raises the shield without locking "
        "on. RT can't jump at the same time, so Dawnlight's R jump and Revali's Gale turn off.<br/><br/>"
        "Both ALBW styles turn off Dawnlight Mode, which forces Dawnlight's manual shielding and would make each bash "
        "cost two charges. In every style, when Essentials' stamina is in use and its bar is empty, the bash is "
        "refused like any other hidden skill.",
        {{"Classic", {{"shield_parry", 0}, {"manual-shielding", 0}, {"manual_shield", 0}}},
            {"Classic, RT guards while locked on", {{"shield_parry", 0}, {"manual-shielding", 1}, {"manual_shield", 0}}},
            {"ALBW parry & bash", {{"shield_parry", 1}, {"manual-shielding", 0}, {"manual_shield", 0}}},
            {"ALBW parry & bash, hold RT to guard", {{"shield_parry", 1}, {"manual-shielding", 0}, {"manual_shield", 1}}}}},
};

size_t choice_count(const Preset& p) {
    size_t n = 0;
    while (n < std::size(p.choices) && p.choices[n].label != nullptr) ++n;
    return n;
}

size_t preset_get(const Preset& p) {
    size_t best = 0;
    int bestMatches = -1;
    for (size_t k = 0; k < choice_count(p); ++k) {
        int matches = 0;
        for (const Value& v : p.choices[k].values) {
            if (v.name != nullptr && get(v.name) == v.value) ++matches;
        }
        if (matches > bestMatches) {
            best = k;
            bestMatches = matches;
        }
    }
    return best;
}

void preset_set(const Preset& p, size_t option) {
    if (option >= choice_count(p)) return;
    const Choice& c = p.choices[option];
    for (const Value& v : c.values) {
        if (v.name != nullptr && v.value == 0) set(v.name, 0);  // offs first, so nothing claims against them
    }
    for (const Value& v : c.values) {
        if (v.name == nullptr || v.value == 0) continue;
        set(v.name, v.value);
        claim(var(v.name));
    }
}

// ---- notes added to the help of settings that stay in their mod's tab

// Hand-written notes for settings a rule above can switch off, or that switch other things off.
struct Note {
    const char* name;
    const char* text;
};
const Note kNotes[] = {
    {"r-jump", "RT is also ALBW's hold-RT guard (Shield style in Combat) and Deku Leaf launch, so turning this on "
        "switches those off."},
    {"revalis-gale", "RT is also ALBW's hold-RT guard (Shield style in Combat) and Deku Leaf launch, so turning this "
        "on switches those off."},
    {"end_game_transform", "Uses D-pad Left, where every Z item slot puts Midna. Turning this on turns the Z item slot "
        "off (Midna goes back to Z), and picking a Z item slot turns this off."},
    {"quickAccessEnabled", "ALBW's D-pad quick swap (Z item slot in Items) uses D-pad Up, Right and Down. While Quick "
        "Access is on one of those, the two can't both be on."},
    {"controlsQuickAccessButton", "ALBW's D-pad quick swap (Z item slot in Items) uses D-pad Up, Right and Down. "
        "Moving Quick Access onto one of those switches quick swap off."},
    {"bottlesQuickAccessEnabled", "ALBW's D-pad quick swap (Z item slot in Items) uses D-pad Up, Right and Down. "
        "While the bottle wheel is on one of those, the two can't both be on. Quick-drinking also empties ALBW's "
        "soulbound potion, so turning this on switches that off."},
    {"soulbound_potion", "Quick-drinking from Essentials' bottle wheel empties this bottle, so turning this on "
        "switches the bottle wheel off."},
    {"arrow-modes", "ALBW's meter also charges for arrows and blocks the ammo changes arrow modes need, so turning this "
        "on switches the ALBW meter off (Stamina & sprint in Gameplay)."},
    {"collectionShowOrdonHero", "Its Collection page uses the D-pad, and so does ALBW's extended status page, so "
        "turning this on switches that off. While Link wears the Ordon Hero tunic, ALBW's outfits and caps don't "
        "show."},
    {"ext_status_page", "Opens with the D-pad on the Collection screen, where Essentials' Ordon Hero page also lives, "
        "so turning this on switches that off."},
    {"hud-layout", "ALBW's LoP HUD hides and moves the same buttons, so any layout other than GameCube turns the LoP "
        "HUD off."},
    {"lop_hud_mode", "Dawnlight's HUD layouts move the same buttons, so turning this on sets Dawnlight's layout back "
        "to GameCube."},
    {"hp-scale-percent", "ALBW's enemy HP multipliers would multiply on top of this, so raising it above 100% sets "
        "them back to 1x."},
    {"hp_normal", "Dawnlight's enemy HP scale would multiply on top of this, so raising it above 1x sets Dawnlight's "
        "back to 100% and turns Dawnlight Mode off."},
    {"hp_midboss", "Dawnlight's enemy HP scale would multiply on top of this, so raising it above 1x sets Dawnlight's "
        "back to 100% and turns Dawnlight Mode off."},
    {"hp_boss", "Dawnlight's enemy HP scale would multiply on top of this, so raising it above 1x sets Dawnlight's "
        "back to 100% and turns Dawnlight Mode off."},
    {"hp_final", "Dawnlight's enemy HP scale would multiply on top of this, so raising it above 1x sets Dawnlight's "
        "back to 100% and turns Dawnlight Mode off."},
    {"remove-normal-hit-invulnerability", "ALBW's harder damage settings (Incoming damage at 2x or 4x, Region damage) "
        "would stack with losing invincibility frames, so turning this on sets them back to 1x and off."},
    {"incoming_damage_scale", "Dawnlight's no-invincibility-frames option would stack with this, so 2x or 4x turns "
        "it off (and Dawnlight Mode, which forces it). 0.5x works with both."},
    {"region_damage", "Dawnlight's no-invincibility-frames option would stack with this, so turning this on turns it "
        "off (and Dawnlight Mode, which forces it)."},
    {"region_hp", "Dawnlight's enemy HP scale would multiply on top of this, so while region multipliers are on, this "
        "sets Dawnlight's back to 100% and turns Dawnlight Mode off."},
    {"controlsBottlesButton", "ALBW's D-pad quick swap (Z item slot in Items) uses D-pad Up, Right and Down. Moving "
        "the bottle wheel onto one of those switches quick swap off. On L, holding it also stops L from locking on."},
    {"dawnlight-mode", "Dawnlight Mode runs Dawnlight's own stamina, sprint, flurry rush, manual shielding, R jump, "
        "arrow modes, hard modes and 300% enemy HP, whatever their switches say. It also switches off ALBW's hold-RT "
        "guard, Deku Leaf, parry &amp; bash, meter, enemy HP multipliers and harder damage settings."},
    {"progression-system", "Progression runs Dawnlight's sprint, glide and Revali's Gale as you unlock them, whatever "
        "their switches say. It also switches off ALBW's hold-RT guard and Deku Leaf."},
};

}  // namespace

void twilit_config_install() {
    s_vars.clear();
    s_realConfig = svc_config;
    std::memcpy(&s_configProxy, s_realConfig,
        std::min<size_t>(s_realConfig->header.struct_size, sizeof(ConfigService)));
    s_configProxy.register_var = proxy_register_var;
    s_configProxy.subscribe = proxy_subscribe;
    svc_config = &s_configProxy;
}

void twilit_config_uninstall() {
    if (s_realConfig != nullptr) svc_config = s_realConfig;
}

// Dawnlight's init, before it installs its hooks: Essentials and Dawnlight vars exist, ALBW's not yet.
void twilit_dawn_resolve_conflicts() {
    for (const Group& g : kGroups) settle(g);
}

// After all three have initialized.
void twilit_overlaps_init() {
    std::unordered_set<ConfigVarHandle> watched;
    for (const Group& g : kGroups) {
        settle(g);
        for (const Side& s : g.sides) {
            for (const Member& m : s.members) {
                for (const ConfigVarHandle v : {var(m.name), var(m.gate)}) {
                    if (v != 0 && watched.insert(v).second) {
                        svc_config->subscribe(mod_ctx, v, on_member_changed, nullptr, nullptr);
                    }
                }
            }
        }
    }
}

// ---- selectors: the groups that have a tab, then the presets

namespace {

struct Selector {
    const Group* group;
    const Preset* preset;
};

const std::vector<Selector>& selectors() {
    static const std::vector<Selector> list = [] {
        std::vector<Selector> out;
        for (const Preset& p : kPresets) out.push_back({nullptr, &p});
        for (const Group& g : kGroups) {
            if (g.topic != nullptr) out.push_back({&g, nullptr});
        }
        return out;
    }();
    return list;
}

void group_set(const Group& g, size_t option) {
    size_t sides[kSides + 1];
    const size_t n = options(g, sides);
    if (option >= n) return;
    if (sides[option] == std::size(g.sides)) {
        for (const Side& s : g.sides) turn_off(s);
        return;
    }
    const Member& first = g.sides[sides[option]].members[0];
    if (!is_on(g.sides[sides[option]])) set(first.name, first.on_at);
    claim(var(first.name));
}

}  // namespace

size_t shared_count() { return selectors().size(); }

const char* shared_name(size_t i) {
    const Selector& s = selectors()[i];
    return s.group ? s.group->name : s.preset->name;
}

const char* shared_topic(size_t i) {
    const Selector& s = selectors()[i];
    return s.group ? s.group->topic : s.preset->topic;
}

const char* shared_help(size_t i) {
    const Selector& s = selectors()[i];
    return s.group ? s.group->help : s.preset->help;
}

size_t shared_options(size_t i, const char* (&labels)[kSharedMaxOptions]) {
    const Selector& s = selectors()[i];
    if (s.preset) {
        const size_t n = choice_count(*s.preset);
        for (size_t k = 0; k < n; ++k) labels[k] = s.preset->choices[k].label;
        return n;
    }
    size_t sides[kSides + 1];
    const size_t n = options(*s.group, sides);
    for (size_t k = 0; k < n; ++k) labels[k] = sides[k] == std::size(s.group->sides) ? "Off" : s.group->sides[sides[k]].label;
    return n;
}

size_t shared_get(size_t i) {
    const Selector& s = selectors()[i];
    if (s.preset) return preset_get(*s.preset);
    size_t sides[kSides + 1];
    const size_t n = options(*s.group, sides);
    for (size_t k = 0; k + 1 < n; ++k) {
        if (is_on(s.group->sides[sides[k]])) return k;
    }
    return n - 1;
}

void shared_set(size_t i, size_t option) {
    const Selector& s = selectors()[i];
    if (s.preset) return preset_set(*s.preset, option);
    group_set(*s.group, option);
}

bool shared_hides(ConfigVarHandle v) {
    if (v == 0) return false;
    for (const Group& g : kGroups) {
        if (g.topic == nullptr) continue;
        for (const Side& s : g.sides) {
            if (var(s.members[0].name) == v) return true;
        }
    }
    for (const Preset& p : kPresets) {
        for (const Choice& c : p.choices) {
            for (const Value& value : c.values) {
                if (value.name != nullptr && var(value.name) == v) return true;
            }
        }
    }
    return false;
}

const char* shared_note(ConfigVarHandle v) {
    static std::unordered_map<ConfigVarHandle, std::string> cache;
    if (v == 0 || shared_hides(v)) return nullptr;
    if (const auto it = cache.find(v); it != cache.end()) return it->second.empty() ? nullptr : it->second.c_str();
    std::string note;
    for (const Note& n : kNotes) {
        if (var(n.name) == v) note = n.text;
    }
    std::string features;
    for (const Group& g : kGroups) {
        if (g.topic == nullptr) continue;
        for (const Side& s : g.sides) {
            if (std::none_of(std::begin(s.members) + 1, std::end(s.members), [v](const Member& m) { return var(m.name) == v; })) {
                continue;
            }
            features += (features.empty() ? "" : ", ") + std::string(g.name) + " (" + g.topic + ")";
        }
    }
    if (!features.empty()) {
        note += (note.empty() ? "" : " ") + std::string("Turning this on switches off the other mods' version of: ") +
            features + ".";
    }
    return (cache[v] = note).empty() ? nullptr : cache[v].c_str();
}
