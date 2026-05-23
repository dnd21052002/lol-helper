# Makefile — lol-overlay native components
# Builds:
#   build/lol-overlay.dylib   — injected into LeagueofLegends, draws overlay
#   build/lol-injector        — Mach injector (signed with cs.debugger)
#   build/lol-watcher         — process watcher, calls injector on game start
#
# Universal binaries (arm64 + x86_64) for the dylib; injector/watcher are
# arm64 only since the watcher targets Apple Silicon and the injector's
# thread-state code is arm64-specific.

CC      = clang
CFLAGS_UNIVERSAL = -Wall -Wextra -Os -arch arm64 -arch x86_64 -fno-objc-arc
CFLAGS_ARM64     = -Wall -Wextra -Os -arch arm64 -fno-objc-arc
LDFLAGS_DYLIB = -dynamiclib \
                -framework Foundation \
                -framework Metal \
                -framework QuartzCore \
                -framework CoreGraphics \
                -framework CoreText
LDFLAGS_TOOL  = -framework Foundation

BUILD_DIR  = build
CERT_NAME ?= lol-injector-cert
ENTITLEMENTS = entitlements.plist

DYLIB     = $(BUILD_DIR)/lol-overlay.dylib
INJECTOR  = $(BUILD_DIR)/lol-injector
WATCHER   = $(BUILD_DIR)/lol-watcher

DYLIB_SRCS = lol-overlay.m lol-memreader.m lol-discovery.m
DYLIB_HDRS = lol-memreader.h

all: $(DYLIB) $(INJECTOR) $(WATCHER)
	@echo ""
	@echo "Build OK."
	@echo "  Next: make sign      # codesign injector with cs.debugger entitlement"
	@echo "  Then: make run       # start watcher (will call injector when game starts)"

$(BUILD_DIR):
	mkdir -p $(BUILD_DIR)

$(DYLIB): $(DYLIB_SRCS) $(DYLIB_HDRS) | $(BUILD_DIR)
	$(CC) $(CFLAGS_UNIVERSAL) $(LDFLAGS_DYLIB) -o $@ $(DYLIB_SRCS)
	@echo "Built: $@"

$(INJECTOR): lol-injector.c | $(BUILD_DIR)
	$(CC) $(CFLAGS_ARM64) -o $@ $<
	@echo "Built: $@ (UNSIGNED — run 'make sign')"

$(WATCHER): lol-watcher.m | $(BUILD_DIR)
	$(CC) $(CFLAGS_ARM64) $(LDFLAGS_TOOL) -o $@ $<
	@echo "Built: $@"

# ── Codesign ────────────────────────────────────────────────────────────────
# Requires a self-signed code-signing cert in the login keychain named
# $(CERT_NAME). See setup-cert.md for one-time setup steps.
sign: $(INJECTOR)
	@echo "Signing $(INJECTOR) with cert '$(CERT_NAME)' + entitlements"
	codesign --force --options runtime \
	         --entitlements $(ENTITLEMENTS) \
	         --sign "$(CERT_NAME)" \
	         $(INJECTOR)
	@echo "Verifying signature:"
	codesign -d --entitlements - $(INJECTOR) 2>&1 | head -20
	@echo ""
	@echo "Sign OK. Run: make run"

# Ad-hoc sign fallback (may not grant cs.debugger on macOS 26)
sign-adhoc: $(INJECTOR)
	codesign --force --options runtime \
	         --entitlements $(ENTITLEMENTS) \
	         --sign - \
	         $(INJECTOR)
	codesign -d --entitlements - $(INJECTOR) 2>&1 | head -20

# ── Run ─────────────────────────────────────────────────────────────────────
run: $(WATCHER) $(INJECTOR) $(DYLIB)
	$(WATCHER) $(abspath $(INJECTOR)) $(abspath $(DYLIB))

# ── House-keeping ───────────────────────────────────────────────────────────
clean:
	rm -rf $(BUILD_DIR)

.PHONY: all sign sign-adhoc run clean
