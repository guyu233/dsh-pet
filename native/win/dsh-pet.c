/*
 * dsh-pet — Windows native floating pet renderer.
 *
 * Reads Petdex spritesheet frames from stdin state lines and draws them in a
 * borderless, always-on-top, layered window. No WebView, no Node, no runtime
 * dependencies beyond Win32 + WIC (WebP decoding is built into WIC on
 * Windows 10 1809+).
 *
 * Protocol (stdin, one line per event):
 *   idle|running-right|running-left|waving|jumping|failed|waiting|running|review
 *
 * Exit conditions:
 *   - parent process (DSH_PET_PARENT_PID) exits
 *   - WM_CLOSE / WM_DESTROY
 */

#define UNICODE
#define _UNICODE
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#include <wincodec.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define FRAME_W 192
#define FRAME_H 208
#define COLS 8
#define ROWS 9
#define DEFAULT_TIMER_MS 120

/* Petdex state rows (v1/v2 share the first nine rows). */
static const char *STATE_NAMES[ROWS] = {
  "idle", "running-right", "running-left", "waving", "jumping",
  "failed", "waiting", "running", "review"
};

typedef struct {
  HWND hwnd;
  HBITMAP atlas;          /* full spritesheet DIB, 32bpp BGRA */
  HBITMAP scaled;         /* one scaled frame DIB */
  BYTE *atlasBits;
  BYTE *scaledBits;
  int atlasW, atlasH;
  int frameW, frameH;     /* scaled frame size */
  int scalePct;
  int opacityPct;
  int row;
  int frame;
  UINT timerMs;
  wchar_t petDir[MAX_PATH];
  DWORD parentPid;
  HANDLE parentHandle;
  HANDLE stdinThread;
  volatile LONG quitting;
} PetCtx;

static PetCtx g;

static int rowForState(const char *name) {
  if (!name) return 0;
  for (int i = 0; i < ROWS; i++) {
    if (_stricmp(name, STATE_NAMES[i]) == 0) return i;
  }
  return 0;
}

static void fail(const wchar_t *msg) {
  MessageBoxW(NULL, msg, L"dsh-pet", MB_ICONERROR);
  ExitProcess(1);
}

/* Decode pet.json spriteVersionNumber to pick 9 vs 11 rows. We only render
 * the first nine rows, so both versions share this loader. */
static int loadAtlas(const wchar_t *dir) {
  wchar_t path[MAX_PATH];
  swprintf_s(path, MAX_PATH, L"%s\\spritesheet.webp", dir);
  if (GetFileAttributesW(path) == INVALID_FILE_ATTRIBUTES) {
    swprintf_s(path, MAX_PATH, L"%s\\spritesheet.png", dir);
  }

  HRESULT hr = CoInitializeEx(NULL, COINIT_APARTMENTTHREADED);
  if (FAILED(hr) && hr != RPC_E_CHANGED_MODE) return 0;

  IWICImagingFactory *factory = NULL;
  hr = CoCreateInstance(&CLSID_WICImagingFactory, NULL, CLSCTX_INPROC_SERVER,
                        &IID_IWICImagingFactory, (void **)&factory);
  if (FAILED(hr)) return 0;

  IWICBitmapDecoder *decoder = NULL;
  hr = factory->lpVtbl->CreateDecoderFromFilename(factory, path, NULL,
        GENERIC_READ, WICDecodeMetadataCacheOnLoad, &decoder);
  if (FAILED(hr)) { factory->lpVtbl->Release(factory); return 0; }

  IWICBitmapFrameDecode *frame = NULL;
  decoder->lpVtbl->GetFrame(decoder, 0, &frame);

  WICPixelFormatGUID pf;
  frame->lpVtbl->GetPixelFormat(frame, &pf);
  IWICBitmapSource *source = (IWICBitmapSource *)frame;
  IWICFormatConverter *conv = NULL;
  if (!IsEqualGUID(&pf, &GUID_WICPixelFormat32bppPBGRA)) {
    factory->lpVtbl->CreateFormatConverter(factory, &conv);
    conv->lpVtbl->Initialize(conv, (IWICBitmapSource *)frame,
        &GUID_WICPixelFormat32bppPBGRA, WICBitmapDitherTypeNone, NULL, 0.0,
        WICBitmapPaletteTypeCustom);
    source = (IWICBitmapSource *)conv;
  }

  UINT w = 0, h = 0;
  source->lpVtbl->GetSize(source, &w, &h);
  g.atlasW = (int)w;
  g.atlasH = (int)h;

  BITMAPINFO bi;
  ZeroMemory(&bi, sizeof(bi));
  bi.bmiHeader.biSize = sizeof(BITMAPINFOHEADER);
  bi.bmiHeader.biWidth = w;
  bi.bmiHeader.biHeight = -(int)h;   /* top-down */
  bi.bmiHeader.biPlanes = 1;
  bi.bmiHeader.biBitCount = 32;
  bi.bmiHeader.biCompression = BI_RGB;

  HDC dc = GetDC(NULL);
  g.atlas = CreateDIBSection(dc, &bi, DIB_RGB_COLORS, (void **)&g.atlasBits, NULL, 0);
  ReleaseDC(NULL, dc);
  if (!g.atlas) return 0;

  UINT stride = w * 4;
  source->lpVtbl->CopyPixels(source, NULL, stride, stride * h, g.atlasBits);

  if (conv) conv->lpVtbl->Release(conv);
  frame->lpVtbl->Release(frame);
  decoder->lpVtbl->Release(decoder);
  factory->lpVtbl->Release(factory);
  return 1;
}

static void makeScaledBitmap(void) {
  g.frameW = FRAME_W * g.scalePct / 100;
  g.frameH = FRAME_H * g.scalePct / 100;
  if (g.frameW < 1) g.frameW = 1;
  if (g.frameH < 1) g.frameH = 1;

  if (g.scaled) DeleteObject(g.scaled);
  BITMAPINFO bi;
  ZeroMemory(&bi, sizeof(bi));
  bi.bmiHeader.biSize = sizeof(BITMAPINFOHEADER);
  bi.bmiHeader.biWidth = g.frameW;
  bi.bmiHeader.biHeight = -g.frameH;
  bi.bmiHeader.biPlanes = 1;
  bi.bmiHeader.biBitCount = 32;
  bi.bmiHeader.biCompression = BI_RGB;
  HDC dc = GetDC(NULL);
  g.scaled = CreateDIBSection(dc, &bi, DIB_RGB_COLORS, (void **)&g.scaledBits, NULL, 0);
  ReleaseDC(NULL, dc);
}

static void drawFrame(void) {
  if (!g.atlas || !g.scaled) return;

  int fw = g.atlasW / COLS;
  int fh = g.atlasH / ROWS;
  if (fw <= 0 || fh <= 0) return;
  if (g.frame >= COLS) g.frame = 0;

  HDC screen = GetDC(NULL);
  HDC src = CreateCompatibleDC(screen);
  HDC dst = CreateCompatibleDC(screen);
  HGDIOBJ oldSrc = SelectObject(src, g.atlas);
  HGDIOBJ oldDst = SelectObject(dst, g.scaled);

  int sx = g.frame * fw;
  int sy = g.row * fh;
  StretchBlt(dst, 0, 0, g.frameW, g.frameH,
             src, sx, sy, fw, fh, SRCCOPY);

  BLENDFUNCTION bf;
  bf.BlendOp = AC_SRC_OVER;
  bf.BlendFlags = 0;
  bf.SourceConstantAlpha = (BYTE)(g.opacityPct * 255 / 100);
  bf.AlphaFormat = AC_SRC_ALPHA;

  POINT ptSrc = { 0, 0 };
  SIZE sz = { g.frameW, g.frameH };
  UpdateLayeredWindow(g.hwnd, screen, NULL, &sz, dst, &ptSrc,
                      0, &bf, ULW_ALPHA);

  SelectObject(src, oldSrc);
  SelectObject(dst, oldDst);
  DeleteDC(src);
  DeleteDC(dst);
  ReleaseDC(NULL, screen);
}

static LRESULT CALLBACK wndProc(HWND hwnd, UINT msg, WPARAM wp, LPARAM lp) {
  switch (msg) {
    case WM_TIMER:
      g.frame = (g.frame + 1) % COLS;
      drawFrame();
      return 0;
    case WM_DESTROY:
      InterlockedExchange(&g.quitting, 1);
      PostQuitMessage(0);
      return 0;
    case WM_CLOSE:
      DestroyWindow(hwnd);
      return 0;
    default:
      return DefWindowProcW(hwnd, msg, wp, lp);
  }
}

/* Read state lines from stdin. Spawned with stdin:'pipe' by the Host. */
static DWORD WINAPI stdinThread(LPVOID unused) {
  (void)unused;
  char buf[64];
  HANDLE h = GetStdHandle(STD_INPUT_HANDLE);
  while (!g.quitting) {
    DWORD read = 0;
    if (!ReadFile(h, buf, sizeof(buf) - 1, &read, NULL) || read == 0) break;
    buf[read] = 0;
    char *line = strtok(buf, "\r\n");
    while (line && !g.quitting) {
      int row = rowForState(line);
      g.row = row;
      g.frame = 0;
      drawFrame();
      line = strtok(NULL, "\r\n");
    }
  }
  return 0;
}

static int parentAlive(void) {
  if (!g.parentHandle || g.parentHandle == INVALID_HANDLE_VALUE) return 1;
  return WaitForSingleObject(g.parentHandle, 0) != WAIT_OBJECT_0;
}

static void parseArgs(int argc, wchar_t **argv) {
  for (int i = 1; i < argc - 1; i++) {
    if (wcscmp(argv[i], L"--pet-dir") == 0) {
      wcsncpy_s(g.petDir, MAX_PATH, argv[i + 1], _TRUNCATE);
    } else if (wcscmp(argv[i], L"--scale") == 0) {
      g.scalePct = _wtoi(argv[i + 1]);
      if (g.scalePct < 50) g.scalePct = 50;
      if (g.scalePct > 300) g.scalePct = 300;
    } else if (wcscmp(argv[i], L"--opacity") == 0) {
      g.opacityPct = _wtoi(argv[i + 1]);
      if (g.opacityPct < 20) g.opacityPct = 20;
      if (g.opacityPct > 100) g.opacityPct = 100;
    }
  }
  const wchar_t *ppid = _wgetenv(L"DSH_PET_PARENT_PID");
  if (ppid) g.parentPid = (DWORD)_wtoui64(ppid, NULL, 10);
}

int WINAPI wWinMain(HINSTANCE hInst, HINSTANCE hPrev, PWSTR cmd, int nCmdShow) {
  (void)hPrev; (void)cmd; (void)nCmdShow;
  parseArgs(__argc, __wargv);
  if (!g.petDir[0]) fail(L"Missing --pet-dir");

  if (!loadAtlas(g.petDir)) fail(L"Could not decode the pet spritesheet (WebP/PNG).");

  WNDCLASSW wc;
  ZeroMemory(&wc, sizeof(wc));
  wc.lpfnWndProc = wndProc;
  wc.hInstance = hInst;
  wc.lpszClassName = L"DshPetWindow";
  if (!RegisterClassW(&wc) && GetLastError() != ERROR_CLASS_ALREADY_EXISTS) {
    fail(L"Could not register window class");
  }

  makeScaledBitmap();

  g.hwnd = CreateWindowExW(
    WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_TOOLWINDOW,
    L"DshPetWindow", L"dsh-pet", WS_POPUP,
    0, 0, g.frameW, g.frameH, NULL, NULL, hInst, NULL);
  if (!g.hwnd) fail(L"Could not create pet window");

  SetWindowPos(g.hwnd, HWND_TOPMOST, 0, 0, g.frameW, g.frameH,
               SWP_NOMOVE | SWP_NOACTIVATE);
  ShowWindow(g.hwnd, SW_SHOWNOACTIVATE);
  drawFrame();

  g.stdinThread = CreateThread(NULL, 0, stdinThread, NULL, 0, NULL);
  SetTimer(g.hwnd, 1, g.timerMs ? g.timerMs : DEFAULT_TIMER_MS, NULL);

  if (g.parentPid) {
    g.parentHandle = OpenProcess(SYNCHRONIZE, FALSE, g.parentPid);
  }

  MSG msg;
  while (!g.quitting) {
    if (PeekMessageW(&msg, NULL, 0, 0, PM_REMOVE)) {
      TranslateMessage(&msg);
      DispatchMessageW(&msg);
    } else {
      if (!parentAlive()) {
        PostQuitMessage(0);
        break;
      }
      Sleep(200);   /* idle: parent liveness check only, ~0 CPU */
    }
  }

  KillTimer(g.hwnd, 1);
  if (g.stdinThread) CloseHandle(g.stdinThread);
  if (g.parentHandle && g.parentHandle != INVALID_HANDLE_VALUE) CloseHandle(g.parentHandle);
  if (g.atlas) DeleteObject(g.atlas);
  if (g.scaled) DeleteObject(g.scaled);
  CoUninitialize();
  return 0;
}
