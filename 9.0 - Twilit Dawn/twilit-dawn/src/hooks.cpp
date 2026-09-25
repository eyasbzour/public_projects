// The three codebases share one ModContext and, per hooked function, one trampoline and one
// original-function pointer (mods::HookImpl is keyed by target). The host's uninstall drops every
// callback the context has on the target, and the SDK then clears the shared pointer, so one mod
// switching a feature off would silently remove the other two mods' hooks on that function until
// restart. This HookService proxy tags each callback with the part that registered it and turns an
// uninstall into "drop this part's callbacks, keep the rest".

#include "twilit.hpp"

#include "mods/service.hpp"
#include "mods/svc/hook.h"
#include "mods/svc/log.h"

#include <algorithm>
#include <cstring>
#include <deque>
#include <string>
#include <unordered_map>

namespace {

enum Kind { PRE, POST, REPLACE };

struct Callback {
    void* fn;
    Kind kind;
    void* callback;
    HookOptions options;  // as registered; our thunk gets this record as userdata instead
    int part;
    bool live;
};

struct Install {
    void* fn;
    void* trampoline;
};

const HookService* s_real = nullptr;
HookService s_proxy;
std::deque<Callback> s_callbacks;  // stable addresses: the thunks' userdata
std::unordered_map<void**, Install> s_installs;  // by original-function slot
thread_local int s_part = kNoPart;

const char* part_name(int part) {
    static const char* const kNames[] = {"Twilit Essentials", "Dawnlight", "A Link Between Twilight"};
    return part >= 0 && part < 3 ? kNames[part] : "unknown";
}

HookAction pre_thunk(ModContext* ctx, void* args, void* retval, void* user) {
    const Callback& c = *static_cast<const Callback*>(user);
    const TwilitPartScope scope(c.part);
    return reinterpret_cast<HookPreFn>(c.callback)(ctx, args, retval, c.options.userdata);
}

void post_thunk(ModContext* ctx, void* args, void* retval, void* user) {
    const Callback& c = *static_cast<const Callback*>(user);
    const TwilitPartScope scope(c.part);
    reinterpret_cast<HookPostFn>(c.callback)(ctx, args, retval, c.options.userdata);
}

void replace_thunk(ModContext* ctx, void* args, void* retval, void* user) {
    const Callback& c = *static_cast<const Callback*>(user);
    const TwilitPartScope scope(c.part);
    reinterpret_cast<HookReplaceFn>(c.callback)(ctx, args, retval, c.options.userdata);
}

ModResult add(ModContext* ctx, Callback& c) {
    HookOptions options = c.options;
    options.userdata = &c;
    switch (c.kind) {
    case PRE: return s_real->add_pre(ctx, c.fn, pre_thunk, &options);
    case POST: return s_real->add_post(ctx, c.fn, post_thunk, &options);
    case REPLACE: return s_real->replace(ctx, c.fn, replace_thunk, &options);
    }
    return MOD_INVALID_ARGUMENT;
}

ModResult record(ModContext* ctx, void* fn, Kind kind, void* callback, const HookOptions* options) {
    HookOptions copy = HOOK_OPTIONS_INIT;
    if (options != nullptr) std::memcpy(&copy, options, std::min<size_t>(options->struct_size, sizeof(copy)));
    copy.struct_size = sizeof(copy);
    Callback& c = s_callbacks.emplace_back(Callback{fn, kind, callback, copy, s_part, true});
    const ModResult r = add(ctx, c);
    c.live = r == MOD_OK;
    return r;
}

ModResult proxy_install(ModContext* ctx, void* fn, void* trampoline, void** original) {
    const ModResult r = s_real->install(ctx, fn, trampoline, original);
    if (r == MOD_OK) s_installs[original] = {fn, trampoline};
    return r;
}

ModResult proxy_add_pre(ModContext* ctx, void* fn, HookPreFn callback, const HookOptions* options) {
    return record(ctx, fn, PRE, reinterpret_cast<void*>(callback), options);
}

ModResult proxy_add_post(ModContext* ctx, void* fn, HookPostFn callback, const HookOptions* options) {
    return record(ctx, fn, POST, reinterpret_cast<void*>(callback), options);
}

ModResult proxy_replace(ModContext* ctx, void* fn, HookReplaceFn callback, const HookOptions* options) {
    return record(ctx, fn, REPLACE, reinterpret_cast<void*>(callback), options);
}

// Uninstalls this part's callbacks on fn. When another part still hooks fn, the detour is put
// back with their callbacks (in their original order) and *kept is set: the caller must not clear
// the shared original-function pointer then.
ModResult drop_part_callbacks(ModContext* ctx, void* fn, void** original, bool* kept) {
    *kept = false;
    for (const Callback& c : s_callbacks) *kept = *kept || (c.live && c.fn == fn && c.part != s_part);
    const ModResult r = s_real->uninstall(ctx, fn, original);  // drops every callback we have on fn
    if (r != MOD_OK) {
        *kept = false;
        return r;
    }
    const auto it = s_installs.find(original);
    if (*kept && (it == s_installs.end() || s_real->install(ctx, fn, it->second.trampoline, original) != MOD_OK)) {
        svc_log->error(ctx, "Twilit Dawn: could not restore hooks shared with another mod; restart the game");
        *kept = false;
    }
    for (Callback& c : s_callbacks) {
        if (c.live && c.fn == fn) c.live = *kept && c.part != s_part && add(ctx, c) == MOD_OK;
    }
    if (*kept) {
        svc_log->info(ctx, (std::string("Twilit Dawn: ") + part_name(s_part) +
            " removed its hooks from a function the other mods also hook; theirs were kept").c_str());
    }
    return r;
}

// Fallback for uninstalls that don't go through twilit_hook_uninstall: anything but MOD_OK keeps the
// SDK from clearing the shared original-function pointer.
ModResult proxy_uninstall(ModContext* ctx, void* fn, void** original) {
    bool kept = false;
    const ModResult r = drop_part_callbacks(ctx, fn, original, &kept);
    return kept ? MOD_UNAVAILABLE : r;
}

}  // namespace

TwilitPartScope::TwilitPartScope(int part) : previous_(s_part) { s_part = part; }
TwilitPartScope::~TwilitPartScope() { s_part = previous_; }
int twilit_current_part() { return s_part; }

void twilit_hooks_install() {
    s_real = svc_hook;
    std::memcpy(&s_proxy, s_real, std::min<size_t>(s_real->header.struct_size, sizeof(HookService)));
    s_proxy.install = proxy_install;
    s_proxy.add_pre = proxy_add_pre;
    s_proxy.add_post = proxy_add_post;
    s_proxy.replace = proxy_replace;
    if (SERVICE_HAS(s_real, HookService, uninstall) && s_real->uninstall != nullptr) s_proxy.uninstall = proxy_uninstall;
    svc_hook = &s_proxy;
}

// update.py routes every mods::hook::uninstall<Entry> in the three codebases here.
ModResult twilit_hook_uninstall(const HookService* hooks, void* target, void** original, const HookService** entryHooks) {
    if (hooks == nullptr || s_real == nullptr || target == nullptr || s_proxy.uninstall != proxy_uninstall) {
        return MOD_UNAVAILABLE;
    }
    bool kept = false;
    const ModResult r = drop_part_callbacks(mod_ctx, target, original, &kept);
    if (r == MOD_OK && !kept) {
        *original = nullptr;
        *entryHooks = nullptr;
    }
    return r;
}

void twilit_hooks_uninstall() {
    if (s_real != nullptr) svc_hook = s_real;
}
