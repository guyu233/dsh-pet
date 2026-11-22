/*
 * dsh-pet — macOS native floating pet renderer.
 *
 * Borderless, always-on-top, non-activating NSWindow. Reads state lines from
 * stdin and draws Petdex spritesheet frames. NSImage decodes WebP/PNG natively
 * on macOS 11+. Zero dependencies beyond AppKit.
 */

#import <AppKit/AppKit.h>
#import <Foundation/Foundation.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <unistd.h>
#include <errno.h>

// Petdex canonical animation table, ported from sprite.zig.
// Each row = { frame count, per-frame durations in ms }.
typedef struct { NSInteger count; NSInteger durs[8]; } StateDef;
static const StateDef STATES[9] = {
  { 6, { 280,110,110,140,140,320,0,0 } },   // idle (irregular blink)
  { 8, { 120,120,120,120,120,120,120,220 } },// running-right
  { 8, { 120,120,120,120,120,120,120,220 } },// running-left
  { 4, { 140,140,140,280,0,0,0,0 } },       // waving
  { 5, { 140,140,140,140,280,0,0,0 } },     // jumping
  { 8, { 140,140,140,140,140,140,140,240 } },// failed
  { 6, { 150,150,150,150,150,260,0,0 } },   // waiting
  { 6, { 120,120,120,120,120,220,0,0 } },   // running
  { 6, { 150,150,150,150,150,280,0,0 } },   // review
};
static NSInteger rowForState(const char *name) {
  static const char *names[9] = {
    "idle","running-right","running-left","waving","jumping",
    "failed","waiting","running","review"
  };
  if (!name) return -1;
  for (NSInteger i = 0; i < 9; i++) if (strcasecmp(name, names[i]) == 0) return i;
  return -1;
}
#define TICK_MS 20

@interface PetView : NSView
@property (nonatomic, strong) NSImage *atlas;
@property (nonatomic, assign) NSInteger row;
@property (nonatomic, assign) NSInteger frame;
@property (nonatomic, assign) NSInteger frameElapsed;
@property (nonatomic, assign) CGFloat scale;
@end

@implementation PetView

- (BOOL)isFlipped { return YES; }

- (void)drawRect:(NSRect)dirty {
  if (!self.atlas) return;
  CGSize size = self.atlas.size;
  CGFloat fw = size.width / 8.0;
  CGFloat fh = size.height / 9.0;
  if (fw <= 0 || fh <= 0) return;
  NSInteger count = STATES[self.row].count;
  if (self.frame >= count) self.frame = 0;

  NSRect src = NSMakeRect(self.frame * fw, self.row * fh, fw, fh);
  NSRect dst = NSMakeRect(0, 0, fw * self.scale, fh * self.scale);
  [self.atlas drawInRect:dst fromRect:src operation:NSCompositingOperationSourceOver fraction:1.0];
}

@end

@interface AppDelegate : NSObject <NSApplicationDelegate>
@property (nonatomic, strong) NSWindow *window;
@property (nonatomic, strong) PetView *petView;
@property (nonatomic, assign) pid_t parentPid;
@property (nonatomic, assign) NSTimeInterval interval;
@property (nonatomic, strong) NSTimer *timer;
@property (nonatomic, strong) NSTimer *watchdog;
@end

@implementation AppDelegate

- (void)setStateLine:(NSString *)line {
  NSInteger row = rowForState([line UTF8String]);
  if (row >= 0) {
    self.petView.row = row;
    self.petView.frame = 0;
    self.petView.frameElapsed = 0;
    [self.petView setNeedsDisplay:YES];
  }
}

- (void)readStdin {
  char buf[64];
  while (fgets(buf, sizeof(buf), stdin)) {
    char *line = strtok(buf, "\r\n");
    while (line) {
      // Copy before dispatch: the stack buffer is reused by the next fgets.
      NSString *copy = [NSString stringWithUTF8String:line];
      dispatch_async(dispatch_get_main_queue(), ^{
        [self setStateLine:copy];
      });
      line = strtok(NULL, "\r\n");
    }
  }
}

- (void)tick:(NSTimer *)timer {
  const StateDef *def = &STATES[self.petView.row];
  NSInteger dur = def->durs[self.petView.frame];
  if (dur <= 0) dur = 120;
  self.petView.frameElapsed += TICK_MS;
  if (self.petView.frameElapsed >= dur) {
    self.petView.frameElapsed = 0;
    self.petView.frame = (self.petView.frame + 1) % def->count;
    [self.petView setNeedsDisplay:YES];
  }
}

- (void)watchdogTick:(NSTimer *)timer {
  if (self.parentPid > 0) {
    int ret = kill(self.parentPid, 0);
    if (ret != 0 && errno == ESRCH) {
      dispatch_async(dispatch_get_main_queue(), ^{ [NSApp terminate:nil]; });
    }
  }
}

- (void)applicationDidFinishLaunching:(NSNotification *)note {
  (void)note;
  NSString *petDir = nil;
  CGFloat scale = 1.0;
  CGFloat opacity = 0.85;
  int intervalMs = 120;

  for (int i = 1; i < [[NSProcessInfo processInfo].arguments count]; i++) {
    NSString *arg = [[NSProcessInfo processInfo].arguments objectAtIndex:i];
    if ([arg isEqualToString:@"--pet-dir"] && i + 1 < [[NSProcessInfo processInfo].arguments count]) {
      petDir = [[NSProcessInfo processInfo].arguments objectAtIndex:++i];
    } else if ([arg isEqualToString:@"--scale"] && i + 1 < [[NSProcessInfo processInfo].arguments count]) {
      scale = MAX(0.5, MIN(3.0, [[[NSProcessInfo processInfo].arguments objectAtIndex:++i] doubleValue] / 100.0));
    } else if ([arg isEqualToString:@"--opacity"] && i + 1 < [[NSProcessInfo processInfo].arguments count]) {
      opacity = MAX(0.2, MIN(1.0, [[[NSProcessInfo processInfo].arguments objectAtIndex:++i] doubleValue] / 100.0));
    }
  }

  const char *ppid = getenv("DSH_PET_PARENT_PID");
  if (ppid) self.parentPid = (pid_t)atoi(ppid);

  NSString *sheet = [petDir stringByAppendingPathComponent:@"spritesheet.webp"];
  if (![[NSFileManager defaultManager] fileExistsAtPath:sheet]) {
    sheet = [petDir stringByAppendingPathComponent:@"spritesheet.png"];
  }

  NSImage *atlas = [[NSImage alloc] initWithContentsOfFile:sheet];
  if (!atlas) {
    NSAlert *alert = [[NSAlert alloc] init];
    alert.messageText = @"dsh-pet";
    alert.informativeText = @"Could not decode the pet spritesheet.";
    [alert runModal];
    [NSApp terminate:nil];
    return;
  }

  CGSize size = atlas.size;
  CGFloat w = (size.width / 8.0) * scale;
  CGFloat h = (size.height / 9.0) * scale;

  self.petView = [[PetView alloc] initWithFrame:NSMakeRect(0, 0, w, h)];
  self.petView.atlas = atlas;
  self.petView.scale = scale;

  self.window = [[NSWindow alloc] initWithContentRect:NSMakeRect(60, 60, w, h)
      styleMask:NSWindowStyleMaskBorderless
      backing:NSBackingStoreBuffered defer:NO];
  self.window.contentView = self.petView;
  self.window.level = kCGFloatingWindowLevel;
  self.window.opaque = NO;
  self.window.alphaValue = opacity;
  self.window.collectionBehavior = NSWindowCollectionBehaviorCanJoinAllSpaces | NSWindowCollectionBehaviorStationary;
  self.window.ignoresMouseEvents = YES;
  [self.window makeKeyAndOrderFront:nil];
  [NSApp activateIgnoringOtherApps:NO];

  (void)intervalMs; // preserved arg for CLI compatibility; timing uses the state table
  self.interval = TICK_MS / 1000.0;
  self.timer = [NSTimer scheduledTimerWithTimeInterval:self.interval
      target:self selector:@selector(tick:) userInfo:nil repeats:YES];
  self.watchdog = [NSTimer scheduledTimerWithTimeInterval:0.2
      target:self selector:@selector(watchdogTick:) userInfo:nil repeats:YES];

  dispatch_async(dispatch_get_global_queue(DISPATCH_QUEUE_PRIORITY_LOW, 0), ^{
    [self readStdin];
  });
}

- (BOOL)applicationShouldTerminateAfterLastWindowClosed:(NSApplication *)sender {
  (void)sender;
  return YES;
}
@end

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    NSApplication *app = [NSApplication sharedApplication];
    AppDelegate *delegate = [[AppDelegate alloc] init];
    app.delegate = delegate;
    [app setActivationPolicy:NSApplicationActivationPolicyAccessory];
    [app run];
  }
  return 0;
}
