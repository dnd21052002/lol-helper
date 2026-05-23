/**
 * lol-overlay.dylib
 *
 * Injected into LeagueofLegends game process.
 * Hooks Metal's presentDrawable: on MTLCommandBuffer to render
 * an overlay (spell cooldowns, jungle timers) on every frame.
 *
 * Data is read from a shared memory segment written by the Electron app.
 *
 * Build: see Makefile
 */

#import <Foundation/Foundation.h>
#import <Metal/Metal.h>
#import <QuartzCore/QuartzCore.h>
#import <CoreGraphics/CoreGraphics.h>
#import <CoreText/CoreText.h>
#import <objc/runtime.h>
#import <objc/message.h>
#import <sys/mman.h>
#import <sys/stat.h>
#import <fcntl.h>
#import <stdio.h>
#import <string.h>
#import <math.h>
#import <unistd.h>

#include "lol-memreader.h"

/* lol-discovery.m exports this — runs background offset hunter when
 * LOL_MEMREAD_DISCOVER is set in the environment. */
extern void discovery_start(void);

// ─── Shared Memory Layout ────────────────────────────────────────────────────
// Electron app writes this struct to /tmp/lol-overlay-shm
// Overlay dylib reads it every frame

#define SHM_NAME        "/lol-overlay-data"
#define SHM_SIZE        4096
#define MAX_ENEMIES     5
#define MAX_TIMERS      3
#define MAX_COOLDOWNS   10

typedef struct {
    char  summonerName[64];
    char  championName[32];
    char  spellD[32];
    char  spellF[32];
    float cdDRemaining;   // seconds remaining, 0 = ready
    float cdFRemaining;
    int   level;
    int   isDead;
} OverlayEnemy;

typedef struct {
    char  label[32];
    float remaining;      // seconds remaining, 0 = alive/unknown
} OverlayTimer;

typedef struct {
    int          version;       // bump to signal update
    int          isGameActive;
    float        gameTime;
    int          enemyCount;
    OverlayEnemy enemies[MAX_ENEMIES];
    int          timerCount;
    OverlayTimer timers[MAX_TIMERS];
    char         myChampion[32];
} OverlaySharedData;

// ─── Globals ─────────────────────────────────────────────────────────────────

static OverlaySharedData *g_sharedData = NULL;
static int                g_shmFd      = -1;

// Metal resources for overlay rendering
static id<MTLDevice>             g_device       = nil;
static id<MTLCommandQueue>       g_cmdQueue     = nil;
static id<MTLRenderPipelineState> g_pipeline    = nil;
static id<MTLTexture>            g_overlayTex   = nil;
static CGSize                    g_lastTexSize  = {0, 0};

// Original IMPs for presentDrawable: variants
static IMP original_presentDrawable        = NULL;  // presentDrawable:
static IMP original_presentDrawableOptions = NULL;  // presentDrawable:options:
static IMP original_presentDrawableAtTime  = NULL;  // presentDrawable:atTime:
static IMP original_presentDrawableAfter   = NULL;  // presentDrawable:afterMinimumDuration:

// CAMetalDrawable.present hooks (Riot's renderer calls these directly).
static IMP original_CAMetalDrawable_present       = NULL;  // -present
static IMP original_CAMetalDrawable_presentAtTime = NULL;  // -presentAtTime:
static IMP original_CAMetalDrawable_presentAfter  = NULL;  // -presentAfterMinimumDuration:

// ─── Shared Memory ───────────────────────────────────────────────────────────

static void open_shared_memory(void) {
    g_shmFd = shm_open(SHM_NAME, O_RDONLY, 0644);
    if (g_shmFd < 0) {
        fprintf(stderr, "[lol-overlay] shm_open failed — Electron app not running?\n");
        return;
    }
    g_sharedData = (OverlaySharedData *)mmap(
        NULL, SHM_SIZE, PROT_READ, MAP_SHARED, g_shmFd, 0
    );
    if (g_sharedData == MAP_FAILED) {
        fprintf(stderr, "[lol-overlay] mmap failed\n");
        g_sharedData = NULL;
        close(g_shmFd);
        g_shmFd = -1;
        return;
    }
    fprintf(stderr, "[lol-overlay] Shared memory opened OK\n");
}

// ─── Overlay Texture Rendering (CPU → CGContext → MTLTexture) ────────────────

static void ensure_overlay_texture(id<MTLDevice> device, CGSize size) {
    if (g_overlayTex &&
        g_lastTexSize.width  == size.width &&
        g_lastTexSize.height == size.height) {
        return;
    }

    // Match drawable pixel format (BGRA8Unorm) so blit shader produces
    // correct colors without channel swap.
    MTLTextureDescriptor *desc = [MTLTextureDescriptor
        texture2DDescriptorWithPixelFormat:MTLPixelFormatBGRA8Unorm
        width:(NSUInteger)size.width
        height:(NSUInteger)size.height
        mipmapped:NO];
    desc.usage = MTLTextureUsageShaderRead;
    desc.storageMode = MTLStorageModeShared;

    g_overlayTex   = [device newTextureWithDescriptor:desc];
    g_lastTexSize  = size;
}

static void draw_overlay_to_texture(CGSize size) {
    if (!g_overlayTex) return;

    size_t width  = (size_t)size.width;
    size_t height = (size_t)size.height;

    // Allocate pixel buffer
    size_t bytesPerRow = width * 4;
    uint8_t *pixels = (uint8_t *)calloc(height, bytesPerRow);
    if (!pixels) return;

    CGColorSpaceRef cs = CGColorSpaceCreateDeviceRGB();
    // BGRA byte order (little-endian) + premultiplied alpha-first → matches
    // MTLPixelFormatBGRA8Unorm on Apple Silicon.
    CGContextRef ctx = CGBitmapContextCreate(
        pixels, width, height, 8, bytesPerRow, cs,
        (CGBitmapInfo)kCGImageAlphaPremultipliedFirst | kCGBitmapByteOrder32Little
    );
    CGColorSpaceRelease(cs);
    if (!ctx) { free(pixels); return; }

    // Scale panel + fonts to drawable height. Reference design at 1080p logical.
    // Drawable height in pixels: typically 1080–2160 on common monitors,
    // 1600 on M-series 13" retina. Use scale = height / 900 so on a 1800px-tall
    // drawable, fonts are 2× the reference 11pt = 22pt.
    float scale = (float)height / 900.0f;
    if (scale < 1.0f) scale = 1.0f;

    // ── Draw overlay panel ──────────────────────────────────────────────────

    float panelW = 260.0f * scale;
    float panelH = 400.0f * scale;
    float panelX = (float)width - panelW - 10.0f * scale;
    float panelY = ((float)height - panelH) / 2.0f;

    // Background rect
    CGContextSetRGBFillColor(ctx, 0.06f, 0.07f, 0.09f, 0.88f);
    CGContextSetRGBStrokeColor(ctx, 0.2f, 0.5f, 0.9f, 0.7f);
    CGContextSetLineWidth(ctx, 1.5f * scale);
    CGRect panelRect = CGRectMake(panelX, panelY, panelW, panelH);
    CGContextFillRect(ctx, panelRect);
    CGContextStrokeRect(ctx, panelRect);

    // Header
    CGContextSetRGBFillColor(ctx, 0.2f, 0.5f, 0.9f, 1.0f);
    CGContextFillRect(ctx, CGRectMake(panelX, panelY + panelH - 28.0f * scale,
                                       panelW, 28.0f * scale));

    // Draw text helper using CoreText (no AppKit dependency)
    // CGBitmapContext is bottom-up by default → matches CoreText, no CTM flip
    // needed. y is measured from the BOTTOM (consistent with panelRect coords).
    void (^drawText)(NSString *, CGFloat, CGFloat, CGFloat, CGFloat, CGFloat) =
    ^(NSString *text, CGFloat x, CGFloat y, CGFloat fontSize, CGFloat r, CGFloat g_) {
        CTFontRef font = CTFontCreateWithName(CFSTR("Helvetica-Bold"),
                                              fontSize * scale, NULL);
        CGColorRef color = CGColorCreateGenericRGB(r, g_, 1.0, 1.0);

        CFStringRef keys[]   = { kCTFontAttributeName, kCTForegroundColorAttributeName };
        CFTypeRef   values[] = { font, color };
        CFDictionaryRef attrs = CFDictionaryCreate(
            NULL,
            (const void **)keys, (const void **)values, 2,
            &kCFTypeDictionaryKeyCallBacks,
            &kCFTypeDictionaryValueCallBacks
        );

        CFAttributedStringRef attrStr = CFAttributedStringCreate(
            NULL, (__bridge CFStringRef)text, attrs
        );
        CTLineRef line = CTLineCreateWithAttributedString(attrStr);

        CGContextSetTextPosition(ctx, x, y);
        CTLineDraw(line, ctx);

        CFRelease(line);
        CFRelease(attrStr);
        CFRelease(attrs);
        CGColorRelease(color);
        CFRelease(font);
    };

    // Header title
    drawText(@"⚔ LoL Helper", panelX + 8.0f * scale,
             panelY + panelH - 22.0f * scale, 13.0f, 1.0f, 1.0f);

    // Game time
    if (g_sharedData && g_sharedData->isGameActive) {
        int totalSec = (int)g_sharedData->gameTime;
        int m = totalSec / 60, s = totalSec % 60;
        NSString *timeStr = [NSString stringWithFormat:@"%d:%02d", m, s];
        drawText(timeStr, panelX + panelW - 50.0f * scale,
                 panelY + panelH - 22.0f * scale, 13.0f, 0.8f, 0.9f);
    }

    float rowY = panelY + panelH - 50.0f * scale;

    // Enemy spells section
    drawText(@"ENEMY SPELLS", panelX + 8.0f * scale, rowY, 10.0f, 0.5f, 0.7f);
    rowY -= 18.0f * scale;

    if (g_sharedData && g_sharedData->isGameActive) {
        for (int i = 0; i < g_sharedData->enemyCount && i < MAX_ENEMIES; i++) {
            OverlayEnemy *e = &g_sharedData->enemies[i];

            // Champion name
            NSString *champName = [NSString stringWithUTF8String:e->championName];
            if (e->isDead) champName = [champName stringByAppendingString:@" ✝"];
            drawText(champName, panelX + 8.0f * scale, rowY, 11.0f, 0.9f, 0.9f);

            // Spell D
            NSString *dStr;
            if (e->cdDRemaining > 0) {
                dStr = [NSString stringWithFormat:@"D:%.0fs", e->cdDRemaining];
                drawText(dStr, panelX + 130.0f * scale, rowY, 11.0f, 1.0f, 0.3f);
            } else {
                dStr = @"D:RDY";
                drawText(dStr, panelX + 130.0f * scale, rowY, 11.0f, 0.3f, 1.0f);
            }

            // Spell F
            NSString *fStr;
            if (e->cdFRemaining > 0) {
                fStr = [NSString stringWithFormat:@"F:%.0fs", e->cdFRemaining];
                drawText(fStr, panelX + 185.0f * scale, rowY, 11.0f, 1.0f, 0.3f);
            } else {
                fStr = @"F:RDY";
                drawText(fStr, panelX + 185.0f * scale, rowY, 11.0f, 0.3f, 1.0f);
            }

            rowY -= 16.0f * scale;
        }
    } else {
        drawText(@"Waiting for game...", panelX + 8.0f * scale, rowY,
                 11.0f, 0.6f, 0.6f);
        rowY -= 16.0f * scale;
    }

    // Jungle timers section
    rowY -= 8.0f * scale;
    drawText(@"OBJECTIVES", panelX + 8.0f * scale, rowY, 10.0f, 0.5f, 0.7f);
    rowY -= 18.0f * scale;

    if (g_sharedData && g_sharedData->isGameActive) {
        for (int i = 0; i < g_sharedData->timerCount && i < MAX_TIMERS; i++) {
            OverlayTimer *t = &g_sharedData->timers[i];
            NSString *label = [NSString stringWithUTF8String:t->label];
            NSString *timerStr;
            if (t->remaining > 0) {
                int m2 = (int)t->remaining / 60, s2 = (int)t->remaining % 60;
                timerStr = [NSString stringWithFormat:@"%@  %d:%02d", label, m2, s2];
                drawText(timerStr, panelX + 8.0f * scale, rowY,
                         11.0f, 1.0f, 0.6f);
            } else {
                timerStr = [NSString stringWithFormat:@"%@  —", label];
                drawText(timerStr, panelX + 8.0f * scale, rowY,
                         11.0f, 0.6f, 0.8f);
            }
            rowY -= 16.0f * scale;
        }
    }

    CGContextRelease(ctx);

    // Upload pixels to MTLTexture
    MTLRegion region = MTLRegionMake2D(0, 0, width, height);
    [g_overlayTex replaceRegion:region
                    mipmapLevel:0
                      withBytes:pixels
                    bytesPerRow:bytesPerRow];
    free(pixels);
}

// ─── Metal Blit Overlay onto Drawable ────────────────────────────────────────

static id<MTLRenderPipelineState> make_blit_pipeline(id<MTLDevice> device) {
    NSString *src = @
        "#include <metal_stdlib>\n"
        "using namespace metal;\n"
        "struct V { float4 pos [[position]]; float2 uv; };\n"
        "vertex V vert(uint vid [[vertex_id]]) {\n"
        "  float2 pos[] = {float2(-1,-1),float2(3,-1),float2(-1,3)};\n"
        "  float2 uv[]  = {float2(0,1), float2(2,1), float2(0,-1)};\n"
        "  V o; o.pos = float4(pos[vid],0,1); o.uv = uv[vid]; return o;\n"
        "}\n"
        "fragment float4 frag(V in [[stage_in]], texture2d<float> tex [[texture(0)]]) {\n"
        "  constexpr sampler s(filter::linear);\n"
        "  return tex.sample(s, in.uv);\n"
        "}\n";

    NSError *err = nil;
    id<MTLLibrary> lib = [device newLibraryWithSource:src options:nil error:&err];
    if (!lib) {
        fprintf(stderr, "[lol-overlay] shader compile error: %s\n",
                err.localizedDescription.UTF8String);
        return nil;
    }

    MTLRenderPipelineDescriptor *desc = [[MTLRenderPipelineDescriptor alloc] init];
    desc.vertexFunction   = [lib newFunctionWithName:@"vert"];
    desc.fragmentFunction = [lib newFunctionWithName:@"frag"];
    desc.colorAttachments[0].pixelFormat          = MTLPixelFormatBGRA8Unorm;
    desc.colorAttachments[0].blendingEnabled      = YES;
    desc.colorAttachments[0].sourceRGBBlendFactor = MTLBlendFactorSourceAlpha;
    desc.colorAttachments[0].destinationRGBBlendFactor = MTLBlendFactorOneMinusSourceAlpha;
    desc.colorAttachments[0].sourceAlphaBlendFactor    = MTLBlendFactorOne;
    desc.colorAttachments[0].destinationAlphaBlendFactor = MTLBlendFactorOneMinusSourceAlpha;

    return [device newRenderPipelineStateWithDescriptor:desc error:&err];
}

// ─── Hook: MTLCommandBuffer presentDrawable: variants ───────────────────────

static int g_presentHookFireCount = 0;

static void render_overlay_into_drawable(id<MTLDrawable> drawable) {
    @try {
        id<CAMetalDrawable> metalDrawable = (id<CAMetalDrawable>)drawable;
        id<MTLTexture> frameTex = metalDrawable.texture;
        if (!frameTex) return;

        /* Pull live cooldowns from game memory (no-op until offsets are
         * configured). Writes into the same g_sharedData struct that the
         * Electron writer uses, so the rest of the renderer doesn't care
         * which side filled it in. Gated by sentinel file because game
         * process does not inherit shell env vars. */
        if (g_sharedData &&
            access("/tmp/lol-overlay.memread", F_OK) == 0 &&
            memreader_is_armed()) {
            MemReaderEnemy mem[MAX_ENEMIES];
            int n = memreader_update(mem, MAX_ENEMIES);
            if (n > 0) {
                g_sharedData->isGameActive = 1;
                g_sharedData->enemyCount   = n;
                for (int i = 0; i < n; i++) {
                    OverlayEnemy *dst = &g_sharedData->enemies[i];
                    /* Only overwrite fields the reader produced; keep names
                     * from Electron when memreader can't decode them. */
                    if (mem[i].championName[0])
                        strncpy(dst->championName, mem[i].championName,
                                sizeof dst->championName - 1);
                    if (mem[i].summonerName[0])
                        strncpy(dst->summonerName, mem[i].summonerName,
                                sizeof dst->summonerName - 1);
                    if (mem[i].spellD[0])
                        strncpy(dst->spellD, mem[i].spellD,
                                sizeof dst->spellD - 1);
                    if (mem[i].spellF[0])
                        strncpy(dst->spellF, mem[i].spellF,
                                sizeof dst->spellF - 1);
                    if (isfinite(mem[i].cdDRemaining))
                        dst->cdDRemaining = mem[i].cdDRemaining;
                    if (isfinite(mem[i].cdFRemaining))
                        dst->cdFRemaining = mem[i].cdFRemaining;
                    dst->level  = mem[i].level;
                    dst->isDead = mem[i].isDead ? 1 : 0;
                }
            }
        }

        // Lazy-capture device + queue from the drawable's texture.
        if (!g_device) {
            g_device = frameTex.device;
            if (g_device) {
                g_cmdQueue = [g_device newCommandQueue];
                fprintf(stderr, "[lol-overlay] Captured device via drawable: %s\n",
                        [g_device.name UTF8String]);
            }
        }
        if (!g_device || !g_cmdQueue) return;

        CGSize texSize = CGSizeMake(frameTex.width, frameTex.height);
        ensure_overlay_texture(g_device, texSize);
        draw_overlay_to_texture(texSize);

        if (!g_pipeline) {
            g_pipeline = make_blit_pipeline(g_device);
        }

        if (g_pipeline && g_overlayTex) {
            id<MTLCommandBuffer> blitCmd = [g_cmdQueue commandBuffer];

            MTLRenderPassDescriptor *rpd = [[MTLRenderPassDescriptor alloc] init];
            rpd.colorAttachments[0].texture     = frameTex;
            rpd.colorAttachments[0].loadAction  = MTLLoadActionLoad;
            rpd.colorAttachments[0].storeAction = MTLStoreActionStore;

            id<MTLRenderCommandEncoder> enc = [blitCmd renderCommandEncoderWithDescriptor:rpd];
            [enc setRenderPipelineState:g_pipeline];
            [enc setFragmentTexture:g_overlayTex atIndex:0];
            [enc drawPrimitives:MTLPrimitiveTypeTriangle vertexStart:0 vertexCount:3];
            [enc endEncoding];
            [blitCmd commit];
            [blitCmd waitUntilCompleted];
        }

        if ((++g_presentHookFireCount % 300) == 1) {
            fprintf(stderr, "[lol-overlay] present hook fires=%d size=%.0fx%.0f\n",
                    g_presentHookFireCount, texSize.width, texSize.height);
        }
    } @catch (NSException *ex) {
        fprintf(stderr, "[lol-overlay] exception in present hook: %s\n",
                ex.reason.UTF8String);
    }
}

static void hooked_presentDrawable(id self, SEL _cmd, id<MTLDrawable> drawable) {
    render_overlay_into_drawable(drawable);
    ((void (*)(id, SEL, id))original_presentDrawable)(self, _cmd, drawable);
}

static void hooked_presentDrawableOptions(id self, SEL _cmd,
                                          id<MTLDrawable> drawable,
                                          NSUInteger opts) {
    render_overlay_into_drawable(drawable);
    ((void (*)(id, SEL, id, NSUInteger))original_presentDrawableOptions)(
        self, _cmd, drawable, opts);
}

static void hooked_presentDrawableAtTime(id self, SEL _cmd,
                                         id<MTLDrawable> drawable,
                                         CFTimeInterval t) {
    render_overlay_into_drawable(drawable);
    ((void (*)(id, SEL, id, CFTimeInterval))original_presentDrawableAtTime)(
        self, _cmd, drawable, t);
}

static void hooked_presentDrawableAfter(id self, SEL _cmd,
                                        id<MTLDrawable> drawable,
                                        CFTimeInterval dur) {
    render_overlay_into_drawable(drawable);
    ((void (*)(id, SEL, id, CFTimeInterval))original_presentDrawableAfter)(
        self, _cmd, drawable, dur);
}

// CAMetalDrawable conforms to MTLDrawable, but on macOS Riot's renderer calls
// `[drawable present]` directly without going through a command buffer.
// Render overlay into self (the drawable), then call original present.
static void hooked_CAMetalDrawable_present(id self, SEL _cmd) {
    render_overlay_into_drawable((id<MTLDrawable>)self);
    ((void (*)(id, SEL))original_CAMetalDrawable_present)(self, _cmd);
}

static void hooked_CAMetalDrawable_presentAtTime(id self, SEL _cmd,
                                                 CFTimeInterval t) {
    render_overlay_into_drawable((id<MTLDrawable>)self);
    ((void (*)(id, SEL, CFTimeInterval))original_CAMetalDrawable_presentAtTime)(
        self, _cmd, t);
}

static void hooked_CAMetalDrawable_presentAfter(id self, SEL _cmd,
                                                CFTimeInterval dur) {
    render_overlay_into_drawable((id<MTLDrawable>)self);
    ((void (*)(id, SEL, CFTimeInterval))original_CAMetalDrawable_presentAfter)(
        self, _cmd, dur);
}

// ─── Hook MTLCommandQueue to capture device ──────────────────────────────────

static IMP original_commandBuffer = NULL;

static id hooked_commandBuffer(id self, SEL _cmd) {
    // Capture device on first call
    if (!g_device) {
        @try {
            g_device   = [self performSelector:@selector(device)];
            g_cmdQueue = [g_device newCommandQueue];
            fprintf(stderr, "[lol-overlay] Captured MTLDevice: %s\n",
                    [g_device.name UTF8String]);
        } @catch (...) {}
    }
    return ((id (*)(id, SEL))original_commandBuffer)(self, _cmd);
}

// ─── Constructor ─────────────────────────────────────────────────────────────

// Redirect stderr/stdout to log file because the game has no controlling
// terminal — fprintf(stderr) goes nowhere otherwise.
static void redirect_logs_to_file(void) {
    const char *path = "/tmp/lol-overlay.log";
    FILE *f = freopen(path, "a", stderr);
    if (f) {
        setvbuf(stderr, NULL, _IOLBF, 0);
    }
    freopen(path, "a", stdout);
    setvbuf(stdout, NULL, _IOLBF, 0);
}

__attribute__((constructor))
static void lol_overlay_init(void) {
    redirect_logs_to_file();
    fprintf(stderr, "\n========================================\n");
    fprintf(stderr, "[lol-overlay] Loaded into game pid=%d\n", getpid());

    // Open shared memory from Electron app
    open_shared_memory();

    // Initialize in-process memory reader (no-op until offsets configured).
    // Set LOL_MEMREAD=1 to enable per-frame reads, LOL_MEMREAD_DISCOVER=1
    // to spawn the offset-hunter background thread.
    memreader_init();
    discovery_start();

    // Hook MTLCommandBuffer present* variants. The concrete class name
    // varies (typically `_MTLCommandBuffer`); selector also varies — Riot's
    // engine on macOS calls `presentDrawable:options:` per sample(1) trace.
    int classCount = objc_getClassList(NULL, 0);
    Class *classes = (Class *)malloc(sizeof(Class) * (size_t)classCount);
    objc_getClassList(classes, classCount);

    int hookedCmdBuf = 0, hookedQueue = 0, hookedDrawable = 0;

    for (int i = 0; i < classCount; i++) {
        Class cls = classes[i];
        const char *name = class_getName(cls);
        if (!name) continue;

        if (strstr(name, "MTLCommandBuffer") && !strstr(name, "Debug")) {
            // Hook every present* variant if the class implements it.
            struct {
                SEL sel;
                IMP repl;
                IMP *orig;
                const char *label;
            } variants[] = {
                { @selector(presentDrawable:),
                  (IMP)hooked_presentDrawable,
                  &original_presentDrawable, "presentDrawable:" },
                { @selector(presentDrawable:options:),
                  (IMP)hooked_presentDrawableOptions,
                  &original_presentDrawableOptions, "presentDrawable:options:" },
                { @selector(presentDrawable:atTime:),
                  (IMP)hooked_presentDrawableAtTime,
                  &original_presentDrawableAtTime, "presentDrawable:atTime:" },
                { @selector(presentDrawable:afterMinimumDuration:),
                  (IMP)hooked_presentDrawableAfter,
                  &original_presentDrawableAfter,
                  "presentDrawable:afterMinimumDuration:" },
            };
            for (size_t v = 0; v < sizeof(variants)/sizeof(variants[0]); v++) {
                Method m = class_getInstanceMethod(cls, variants[v].sel);
                if (m && *variants[v].orig == NULL) {
                    *variants[v].orig = method_getImplementation(m);
                    method_setImplementation(m, variants[v].repl);
                    fprintf(stderr, "[lol-overlay] Hooked %s on %s\n",
                            variants[v].label, name);
                    hookedCmdBuf++;
                }
            }
        }

        // Hook the concrete CAMetalDrawable class — Riot's renderer calls
        // `[drawable present]` directly. Class name on macOS 26 is typically
        // `CAMetalDrawable` (concrete) and confirms via the `present` selector.
        if (strstr(name, "CAMetalDrawable") && !strstr(name, "Debug")) {
            struct {
                SEL sel;
                IMP repl;
                IMP *orig;
                const char *label;
            } dvariants[] = {
                { @selector(present),
                  (IMP)hooked_CAMetalDrawable_present,
                  &original_CAMetalDrawable_present, "-present" },
                { @selector(presentAtTime:),
                  (IMP)hooked_CAMetalDrawable_presentAtTime,
                  &original_CAMetalDrawable_presentAtTime, "-presentAtTime:" },
                { @selector(presentAfterMinimumDuration:),
                  (IMP)hooked_CAMetalDrawable_presentAfter,
                  &original_CAMetalDrawable_presentAfter,
                  "-presentAfterMinimumDuration:" },
            };
            for (size_t v = 0; v < sizeof(dvariants)/sizeof(dvariants[0]); v++) {
                Method m = class_getInstanceMethod(cls, dvariants[v].sel);
                if (m && *dvariants[v].orig == NULL) {
                    *dvariants[v].orig = method_getImplementation(m);
                    method_setImplementation(m, dvariants[v].repl);
                    fprintf(stderr, "[lol-overlay] Hooked %s on %s\n",
                            dvariants[v].label, name);
                    hookedDrawable++;
                }
            }
        }

        // Hook MTLCommandQueue.commandBuffer to capture the device handle.
        if (strstr(name, "MTLCommandQueue") && !strstr(name, "Debug")) {
            Method m = class_getInstanceMethod(cls, @selector(commandBuffer));
            if (m && !original_commandBuffer) {
                original_commandBuffer = method_getImplementation(m);
                method_setImplementation(m, (IMP)hooked_commandBuffer);
                fprintf(stderr, "[lol-overlay] Hooked commandBuffer on %s\n", name);
                hookedQueue++;
            }
        }
    }

    free(classes);
    fprintf(stderr,
            "[lol-overlay] Init complete (cmdbuf=%d queue=%d drawable=%d)\n",
            hookedCmdBuf, hookedQueue, hookedDrawable);
}

__attribute__((destructor))
static void lol_overlay_fini(void) {
    if (g_sharedData) munmap(g_sharedData, SHM_SIZE);
    if (g_shmFd >= 0) close(g_shmFd);
    fprintf(stderr, "[lol-overlay] Unloaded\n");
}
