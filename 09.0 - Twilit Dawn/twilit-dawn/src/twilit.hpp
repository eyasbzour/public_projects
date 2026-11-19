#pragma once
// Twilit Dawn glue shared by combo.cpp, overlaps.cpp and settings_hub.cpp.

#include "mods/api.h"
#include "mods/svc/config.h"
#include "mods/svc/ui.h"

#include <cstddef>

// ---- hooks.cpp: which of the three is running, so one's hook uninstall can't remove the others' hooks
constexpr int kNoPart = -1;  // parts: 0 Essentials, 1 Dawnlight, 2 ALBW (combo.cpp kParts order)
class TwilitPartScope {
public:
    explicit TwilitPartScope(int part);
    ~TwilitPartScope();
    TwilitPartScope(const TwilitPartScope&) = delete;
    TwilitPartScope& operator=(const TwilitPartScope&) = delete;

private:
    int previous_;
};
int twilit_current_part();
void twilit_hooks_install();  // before any init: routes hook registration through a proxy
void twilit_hooks_uninstall();

// ---- overlaps.cpp: one owner per feature across Essentials, Dawnlight and ALBW
void twilit_config_install();         // before any init: records every config var by name
void twilit_config_uninstall();
void twilit_dawn_resolve_conflicts(); // Dawnlight's init, before its hooks install
void twilit_overlaps_init();          // after all three init: settle + subscribe

// Shared features as one selector each ("Twilit Essentials" / "Dawnlight" / "A Link Between Twilight" / "Off").
constexpr size_t kSharedMaxOptions = 6;
size_t shared_count();
const char* shared_name(size_t i);
const char* shared_topic(size_t i);  // settings-window tab it belongs on
const char* shared_help(size_t i);
size_t shared_options(size_t i, const char* (&labels)[kSharedMaxOptions]);
size_t shared_get(size_t i);
void shared_set(size_t i, size_t option);
bool shared_hides(ConfigVarHandle var);  // the per-mod toggles a selector replaces
const char* shared_note(ConfigVarHandle var);  // what else a setting switches off, or nullptr

// ---- settings_hub.cpp: one settings window, menu tab and Mods panel for everything
void settings_hub_install();                // before any init: routes UI calls through a proxy
void settings_hub_begin(const char* source); // name the codebase about to initialize
void settings_hub_init();                   // after all three init
void settings_hub_shutdown();
