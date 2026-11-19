// One settings window for Twilit Dawn. Upstream Essentials, Dawnlight and ALBW each register a menu
// tab and/or a Mods panel that opens their own settings window. Twilit Dawn gives all three a proxied
// UiService that collects those instead, then shows every tab in a single window, grouped by topic,
// behind one "Twilit Dawn" menu tab and one Mods-panel button. No upstream UI code is patched.

#include "twilit.hpp"

#include "mods/service.hpp"
#include "mods/svc/log.h"

#include <algorithm>
#include <cctype>
#include <cstdint>
#include <cstring>
#include <iterator>
#include <string>
#include <unordered_map>
#include <vector>

namespace {

constexpr const char* kEssentials = "Twilit Essentials";
constexpr const char* kDawnlight = "Dawnlight";
constexpr const char* kAlbw = "A Link Between Twilight";

// Where each mod's tabs go, in tab order. Tabs not listed here (added in a later upstream version)
// get their own tab, titled "<mod>: <tab>", at the end.
struct Place {
    const char* source;
    const char* title;
    const char* topic;
};
const Place kPlaces[] = {
    {kEssentials, "General", "General"},
    {kDawnlight, "General", "General"},
    {kEssentials, "Quality of Life", "Quality of Life"},
    {kAlbw, "Quality of Life", "Quality of Life"},
    {kEssentials, "Combat", "Combat"},
    {kAlbw, "Combat", "Combat"},
    {kDawnlight, "Aiming", "Aiming"},
    {kDawnlight, "Gameplay", "Gameplay"},
    {kDawnlight, "Deferred", "Gameplay"},
    {kEssentials, "Controls", "Controls"},
    {kDawnlight, "Controls", "Controls"},
    {kDawnlight, "HUD", "HUD"},
    {kAlbw, "HUD", "HUD"},
    {kEssentials, "Quick Access", "Items"},
    {kAlbw, "Items & Outfits", "Items"},
    {kEssentials, "Visuals", "Visuals"},
    {kDawnlight, "Models", "Visuals"},
    {kDawnlight, "Hard Mode", "Difficulty"},
    {kAlbw, "Difficulty & Economy", "Difficulty"},
    {kAlbw, "Progression & Story", "Progression"},
    {kEssentials, "Menus", "Menus"},
    {kEssentials, "BossRush", "Boss Rush"},
    {kEssentials, "Customization", "Customization"},
};

struct Part {
    const char* source;
    UiTabBuildFn build;
    UiPanelUpdateFn update;
    void* user;
};
struct Topic {
    std::string title;
    std::vector<Part> parts;
};
struct Closer {
    UiWindowClosedFn fn;
    void* user;
};
struct Source {
    const char* name;
    UiPressedFn open = nullptr;  // from its menu tab, or the "...settings" button in its Mods panel
    void* user = nullptr;
    UiModsPanelDesc panel{};
};

// Handed back to the mods in place of their own windows, menu tabs and a pane to dry-build into.
constexpr UiWindowHandle kTheirWindow = 0x7D1D'0000'0000'0001ull;
constexpr UiMenuTabHandle kTheirMenuTab = 0x7D1D'0000'0000'0002ull;
constexpr UiElementHandle kDryPane = 0x7D1D'0000'0000'0003ull;

const UiService* s_real = nullptr;
UiService s_proxy;
std::vector<Source> s_sources;
const char* s_current = nullptr;    // codebase currently initializing
std::vector<Topic> s_topics;
std::vector<Closer> s_closers;
std::string s_rcss;
const char* s_capturing = nullptr;  // source whose window is being collected
Source* s_dryBuilding = nullptr;    // source whose Mods panel is being searched for its settings button
UiWindowHandle s_window = 0;
UiMenuTabHandle s_menuTab = 0;

Source& current_source() {
    for (Source& s : s_sources) {
        if (s.name == s_current) return s;
    }
    return s_sources.emplace_back(Source{s_current});
}

Topic& topic(const std::string& title) {
    for (Topic& t : s_topics) {
        if (t.title == title) return t;
    }
    return s_topics.emplace_back(Topic{title, {}});
}

void add_part(const char* source, const char* title, UiTabBuildFn build, UiPanelUpdateFn update, void* user) {
    std::string where = std::string(source) + ": " + title;
    for (const Place& p : kPlaces) {
        if (std::strcmp(p.source, source) == 0 && std::strcmp(p.title, title) == 0) where = p.topic;
    }
    topic(where).parts.push_back({source, build, update, user});
}

void get_shared(ModContext*, void* user, UiControlValue* out) {
    out->int_value = static_cast<int64_t>(shared_get(reinterpret_cast<uintptr_t>(user)));
}

void set_shared(ModContext*, void* user, const UiControlValue* value) {
    shared_set(reinterpret_cast<uintptr_t>(user), static_cast<size_t>(value->int_value));
}

// Features several mods implement: one selector each, above the mods' own settings.
void add_shared_selectors(ModContext* ctx, UiElementHandle left, const std::string& topic) {
    static const char* labels[32][kSharedMaxOptions];
    bool first = true;
    for (size_t i = 0; i < shared_count() && i < std::size(labels); ++i) {
        if (topic != shared_topic(i)) continue;
        if (first) s_real->pane_add_section(ctx, left, "Shared Features (one mod at a time)");
        first = false;
        UiControlDesc c = UI_CONTROL_DESC_INIT;
        c.kind = UI_CONTROL_SELECT;
        c.label = shared_name(i);
        c.help_rml = shared_help(i);
        c.options = labels[i];
        c.option_count = shared_options(i, labels[i]);
        c.binding = UI_BINDING_CALLBACKS;
        c.get = get_shared;
        c.set = set_shared;
        c.user_data = reinterpret_cast<void*>(i);
        s_real->pane_add_control(ctx, left, &c, nullptr);
    }
}

ModResult build_topic(ModContext* ctx, UiWindowHandle, UiElementHandle left, UiElementHandle right, void* user,
    ModError* error) {
    const Topic& t = *static_cast<const Topic*>(user);
    add_shared_selectors(ctx, left, t.title);
    bool mixed = false;
    for (const Part& part : t.parts) mixed = mixed || part.source != t.parts.front().source;
    const char* heading = nullptr;
    for (const Part& part : t.parts) {
        if (mixed && part.source != heading) s_real->pane_add_section(ctx, left, heading = part.source);
        if (const ModResult r = part.build(ctx, kTheirWindow, left, right, part.user, error); r != MOD_OK) return r;
    }
    return MOD_OK;
}

ModResult update_topic(ModContext* ctx, void* user, ModError* error) {
    for (const Part& part : static_cast<const Topic*>(user)->parts) {
        if (part.update == nullptr) continue;
        if (const ModResult r = part.update(ctx, part.user, error); r != MOD_OK) return r;
    }
    return MOD_OK;
}

void close_theirs(ModContext* ctx) {
    for (const Closer& c : s_closers) c.fn(ctx, kTheirWindow, c.user);
}

void on_closed(ModContext* ctx, UiWindowHandle, void*) {
    s_window = 0;
    close_theirs(ctx);
}

// Ask each mod to open its settings window; proxy_window_push files the tabs under topics.
void collect(ModContext* ctx) {
    s_topics.clear();
    s_closers.clear();
    s_rcss.clear();
    for (const Source& src : s_sources) {
        if (src.open == nullptr) continue;
        s_capturing = src.name;
        src.open(ctx, src.user);
    }
    s_capturing = nullptr;
    auto rank = [](const Topic& t) {
        for (size_t i = 0; i < std::size(kPlaces); ++i) {
            if (t.title == kPlaces[i].topic) return i;
        }
        return std::size(kPlaces);
    };
    std::stable_sort(s_topics.begin(), s_topics.end(),
        [&](const Topic& a, const Topic& b) { return rank(a) < rank(b); });
}

void open_settings(ModContext* ctx, void*) {
    if (s_window != 0 || s_capturing != nullptr) return;
    collect(ctx);  // s_topics must not change while the window is open (tabs point into it)
    std::vector<UiTabDesc> tabs;
    for (Topic& t : s_topics) {
        UiTabDesc tab = UI_TAB_DESC_INIT;
        tab.title = t.title.c_str();
        tab.build = build_topic;
        tab.update = update_topic;
        tab.user_data = &t;
        tabs.push_back(tab);
    }
    UiWindowDesc desc = UI_WINDOW_DESC_INIT;
    desc.tabs = tabs.data();
    desc.tab_count = tabs.size();
    desc.rcss = s_rcss.empty() ? nullptr : s_rcss.c_str();
    desc.on_closed = on_closed;
    s_real->window_push(ctx, &desc, &s_window);
}

bool mentions_settings(const char* label) {
    std::string lower = label ? label : "";
    std::transform(lower.begin(), lower.end(), lower.begin(), [](unsigned char c) { return std::tolower(c); });
    return lower.find("settings") != std::string::npos;
}

// ---- proxied UiService entries

ModResult proxy_window_push(ModContext* ctx, const UiWindowDesc* desc, UiWindowHandle* out) {
    if (s_capturing != nullptr) {
        for (size_t i = 0; i < desc->tab_count; ++i) {
            const UiTabDesc& tab = desc->tabs[i];
            add_part(s_capturing, tab.title, tab.build, tab.update, tab.user_data);
        }
        if (desc->on_closed) s_closers.push_back({desc->on_closed, desc->user_data});
        if (desc->rcss) s_rcss += desc->rcss;
    } else {
        open_settings(ctx, nullptr);  // a mod opened its own window: show the combined one instead
    }
    if (out) *out = kTheirWindow;
    return MOD_OK;
}

ModResult proxy_window_close(ModContext* ctx, UiWindowHandle window) {
    if (window != kTheirWindow) return s_real->window_close(ctx, window);
    return s_window ? s_real->window_close(ctx, s_window) : MOD_OK;
}

ModResult proxy_register_menu_tab(ModContext* ctx, const UiMenuTabDesc* desc, UiMenuTabHandle* out) {
    if (s_current == nullptr) return s_real->register_menu_tab(ctx, desc, out);
    Source& src = current_source();
    src.open = desc->on_selected;
    src.user = desc->user_data;
    if (out) *out = kTheirMenuTab;
    return MOD_OK;
}

ModResult proxy_unregister_menu_tab(ModContext* ctx, UiMenuTabHandle tab) {
    return tab == kTheirMenuTab ? MOD_OK : s_real->unregister_menu_tab(ctx, tab);
}

ModResult proxy_register_mods_panel(ModContext*, const UiModsPanelDesc* desc) {
    if (s_current != nullptr && desc != nullptr) current_source().panel = *desc;
    return MOD_OK;  // replaced by the Twilit Dawn panel
}

ModResult proxy_pane_add_control(ModContext* ctx, UiElementHandle pane, const UiControlDesc* desc, UiElementHandle* out) {
    if (out) *out = 0;
    if (pane == kDryPane) {
        if (s_dryBuilding && !s_dryBuilding->open && desc && desc->kind == UI_CONTROL_BUTTON &&
            mentions_settings(desc->label)) {
            s_dryBuilding->open = desc->on_pressed;
            s_dryBuilding->user = desc->user_data;
        }
        return MOD_OK;
    }
    if (desc != nullptr && desc->binding == UI_BINDING_CONFIG_VAR) {
        if (shared_hides(desc->config_var)) return MOD_OK;  // replaced by a shared-feature selector
        if (const char* note = shared_note(desc->config_var)) {
            static std::unordered_map<ConfigVarHandle, std::string> help;
            std::string& text = help[desc->config_var];
            text = desc->help_rml && *desc->help_rml ? std::string(desc->help_rml) + "<br/><br/>" + note : note;
            UiControlDesc c = *desc;
            c.help_rml = text.c_str();
            return s_real->pane_add_control(ctx, pane, &c, out);
        }
    }
    return s_real->pane_add_control(ctx, pane, desc, out);
}

ModResult proxy_pane_add_section(ModContext* ctx, UiElementHandle pane, const char* title) {
    return pane == kDryPane ? MOD_OK : s_real->pane_add_section(ctx, pane, title);
}

ModResult proxy_pane_add_text(ModContext* ctx, UiElementHandle pane, const char* text, UiElementHandle* out) {
    if (pane == kDryPane) {
        if (out) *out = 0;
        return MOD_OK;
    }
    return s_real->pane_add_text(ctx, pane, text, out);
}

ModResult proxy_pane_add_rml(ModContext* ctx, UiElementHandle pane, const char* rml, UiElementHandle* out) {
    if (pane == kDryPane) {
        if (out) *out = 0;
        return MOD_OK;
    }
    return s_real->pane_add_rml(ctx, pane, rml, out);
}

ModResult proxy_pane_add_progress(ModContext* ctx, UiElementHandle pane, float value, UiElementHandle* out) {
    if (pane == kDryPane) {
        if (out) *out = 0;
        return MOD_OK;
    }
    return s_real->pane_add_progress(ctx, pane, value, out);
}

ModResult proxy_pane_add_group(ModContext* ctx, UiElementHandle group, UiElementHandle target, const UiGroupDesc* desc,
    UiElementHandle* out) {
    if (group == kDryPane) {
        if (out) *out = 0;
        return MOD_OK;
    }
    return s_real->pane_add_group(ctx, group, target, desc, out);
}

// ---- Twilit Dawn's own entry points

ModResult build_panel(ModContext* ctx, UiElementHandle panel, void*, ModError*) {
    s_real->pane_add_section(ctx, panel, "Twilit Dawn");
    s_real->pane_add_text(ctx, panel,
        "Twilit Essentials, Dawnlight and A Link Between Twilight in one mod. All their settings are in one "
        "window, grouped by topic. Features more than one of them has (Z slot, stamina, flurry rush and more) "
        "are a single choice at the top of their tab, so they never run twice.",
        nullptr);
    UiControlDesc c = UI_CONTROL_DESC_INIT;
    c.kind = UI_CONTROL_BUTTON;
    c.label = "Open Twilit Dawn Settings";
    c.on_pressed = open_settings;
    return s_real->pane_add_control(ctx, panel, &c, nullptr);
}

}  // namespace

void settings_hub_install() {
    s_real = svc_ui;
    s_sources.clear();
    s_current = nullptr;
    s_window = 0;
    std::memcpy(&s_proxy, s_real, std::min<size_t>(s_real->header.struct_size, sizeof(UiService)));
    s_proxy.window_push = proxy_window_push;
    s_proxy.window_close = proxy_window_close;
    s_proxy.register_menu_tab = proxy_register_menu_tab;
    s_proxy.unregister_menu_tab = proxy_unregister_menu_tab;
    s_proxy.register_mods_panel = proxy_register_mods_panel;
    s_proxy.pane_add_control = proxy_pane_add_control;
    s_proxy.pane_add_section = proxy_pane_add_section;
    s_proxy.pane_add_text = proxy_pane_add_text;
    s_proxy.pane_add_rml = proxy_pane_add_rml;
    s_proxy.pane_add_progress = proxy_pane_add_progress;
    s_proxy.pane_add_group = proxy_pane_add_group;
    svc_ui = &s_proxy;
}

void settings_hub_begin(const char* source) {
    s_current = source;
}

void settings_hub_init() {
    s_current = nullptr;
    // Mods without a menu tab (ALBW) open their window from a Mods-panel button: find it.
    for (Source& src : s_sources) {
        if (src.open != nullptr || src.panel.build == nullptr) continue;
        s_dryBuilding = &src;
        src.panel.build(mod_ctx, kDryPane, src.panel.user_data, nullptr);
    }
    s_dryBuilding = nullptr;

    // Self-check: collect once without showing anything and log the combined layout.
    collect(mod_ctx);
    close_theirs(mod_ctx);
    std::string layout = "settings window:";
    for (const Topic& t : s_topics) {
        layout += " " + t.title + "(";
        for (size_t i = 0; i < t.parts.size(); ++i) layout += std::string(i ? "+" : "") + t.parts[i].source;
        layout += ")";
    }
    for (const Source& src : s_sources) {
        if (src.open == nullptr) layout += std::string(" [no settings window found for ") + src.name + "]";
    }
    svc_log->info(mod_ctx, layout.c_str());

    UiModsPanelDesc panel = UI_MODS_PANEL_DESC_INIT;
    panel.build = build_panel;
    s_real->register_mods_panel(mod_ctx, &panel);
    UiMenuTabDesc tab = UI_MENU_TAB_DESC_INIT;
    tab.label = "Twilit Dawn";
    tab.on_selected = open_settings;
    s_real->register_menu_tab(mod_ctx, &tab, &s_menuTab);
}

void settings_hub_shutdown() {
    if (s_menuTab != 0) s_real->unregister_menu_tab(mod_ctx, s_menuTab);
    s_menuTab = 0;
    if (s_real != nullptr) svc_ui = s_real;
}
