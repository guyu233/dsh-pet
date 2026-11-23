//! dsh-pet native renderer — Rust port of the petdex Windows layer.
//! Integrates: WIC atlas decode, petdex state machine + frame timing,
//! layered-window rendering, drag physics, right-click menu layout,
//! bubble layout. Bubble windows and menu window painting are added in 5c.

mod win32;
mod wic;
mod ui;
mod windowproc;

use win32::*;
use std::ffi::c_void;
use std::sync::atomic::{AtomicI32, Ordering};

// Use the library modules (same code, compiled into this binary).
use dsh_pet_native::core::{PetAnimationEngine, PetState, BubbleEntry, SessionStatus};
use dsh_pet_native::physics::PetPhysics;
use dsh_pet_native::menu::{build_default_menu_entries, compute_menu_layout, PopupMenuEntry, CMD_SHUFFLE_PET, CMD_OPEN_SETTINGS};
use dsh_pet_native::bubble::{compute_bubble_placement, BubbleContent};
use crate::ui::LayeredSurface;
use crate::windowproc::{BubbleView, MenuCtx, menu_wndproc, bubble_wndproc, show_menu, show_bubble, bubble_size};

const TIMER_ID: UINT = 1;
const TICK_MS: u32 = 20;
const FRAME_W: i32 = 192;
const FRAME_H: i32 = 208;
const COLS: i32 = 8;
const ROWS: i32 = 9;
static QUITTING: AtomicI32 = AtomicI32::new(0);

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64).unwrap_or(0)
}

struct RenderTarget {
    hdc: HDC,
    bitmap: HBITMAP,
    bits: *mut u8,
    width: i32,
    height: i32,
}

impl RenderTarget {
    unsafe fn new(width: i32, height: i32) -> Option<Self> {
        let mut bmi = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: width, biHeight: -height, biPlanes: 1,
                biBitCount: 32, biCompression: BI_RGB,
                biSizeImage: 0, biXPelsPerMeter: 0, biYPelsPerMeter: 0,
                biClrUsed: 0, biClrImportant: 0,
            },
            bmiColors: [0],
        };
        let screen = GetDC(null_mut());
        let mut bits: *mut c_void = null_mut();
        let bitmap = CreateDIBSection(screen, &mut bmi, DIB_RGB_COLORS,
            &mut bits, null_mut(), 0);
        ReleaseDC(null_mut(), screen);
        if bitmap.is_null() { return None }
        let hdc = CreateCompatibleDC(null_mut());
        Some(Self { hdc, bitmap, bits: bits as *mut u8, width, height })
    }

    unsafe fn destroy(&self) { SelectObject(self.hdc, std::ptr::null_mut()); DeleteObject(self.bitmap); DeleteDC(self.hdc); }
}

struct AppState {
    hwnd: HWND,
    dragging: bool,
    drag_origin: POINT,
    win_origin: RECT,
    scale: i32,
    opacity: i32,
    atlas: Option<wic::Atlas>,
    target: Option<RenderTarget>,
    anim: PetAnimationEngine,
    physics: PetPhysics,
    last_tick: u64,
    bubbles: Vec<BubbleEntry>,
    menu: Option<LayeredSurface>,
    bubble_win: Option<LayeredSurface>,
    menu_ctx: MenuCtx,
    always_on_top: bool,
    focus_mode: bool,
}

static mut STATE: *mut AppState = std::ptr::null_mut();

/// Right-click menu command handler (petdex commands adapted for DSH).
unsafe extern "system" fn on_menu_command(cmd: usize) {
    use dsh_pet_native::menu::*;
    let s = &mut *STATE;
    match cmd {
        CMD_TOGGLE_TOPMOST => {
            s.always_on_top = !s.always_on_top;
            SetWindowPos(s.hwnd, if s.always_on_top { HWND_TOPMOST } else { -2isize as HWND },
                0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
        }
        CMD_TOGGLE_FOCUS_MODE => { s.focus_mode = !s.focus_mode; }
        CMD_CYCLE_STATE => { s.anim.set_state(s.anim.state().next()); present(s); }
        CMD_RESET_POSITION => {
            let mut work = RECT::default();
            if SystemParametersInfoW(SPI_GETWORKAREA, 0, &mut work as *mut _ as *mut c_void, 0) != 0 {
                let w = s.target.as_ref().map(|t| t.width).unwrap_or(FRAME_W);
                let h = s.target.as_ref().map(|t| t.height).unwrap_or(FRAME_H);
                SetWindowPos(s.hwnd, HWND_TOPMOST, work.right - w - 24, work.bottom - h - 24,
                    0, 0, SWP_NOSIZE | SWP_NOACTIVATE);
            }
        }
        CMD_SEND_TEST_BUBBLE => {
            let (bw, bh) = bubble_size();
            let mut rect = RECT::default(); GetWindowRect(s.hwnd, &mut rect);
            let mut work = RECT::default();
            SystemParametersInfoW(SPI_GETWORKAREA, 0, &mut work as *mut _ as *mut c_void, 0);
            let (x, y) = compute_bubble_placement(rect.left, rect.top,
                rect.right-rect.left, rect.bottom-rect.top, bw, bh,
                work.left, work.top, work.right, work.bottom);
            SetWindowPos(s.bubble_win.as_ref().unwrap().hwnd, HWND_TOPMOST, x, y, 0, 0,
                SWP_NOSIZE | SWP_NOACTIVATE);
            show_bubble(s.bubble_win.as_ref().unwrap(), &BubbleView {
                title: "Test".into(), status: SessionStatus::NeedsInput,
                session_id: "test".into(),
            });
        }
        CMD_SHUFFLE_PET | CMD_OPEN_SETTINGS => {
            // Settings/shuffle are handled by the Host bridge (settings UI);
            // no-op here — the menu command is still a valid, non-crashing action.
        }
        CMD_QUIT => { QUITTING.store(1, Ordering::SeqCst); PostQuitMessage(0); }
        _ => {}
    }
    s.menu_ctx.always_on_top = s.always_on_top;
    s.menu_ctx.focus_mode = s.focus_mode;
}

unsafe fn null<T>() -> *const T { std::ptr::null() }
unsafe fn null_mut<T>() -> *mut T { std::ptr::null_mut() }

unsafe fn present(s: &mut AppState) {
    let (Some(atlas), Some(target)) = (s.atlas.as_ref(), s.target.as_ref()) else { return };
    let frame = s.anim.current_frame();
    let fw = (atlas.width as i32 / COLS).max(1);
    let fh = (atlas.height as i32 / ROWS.max(1)).max(1);
    let sx = (frame.col as i32) * fw;
    let sy = (frame.row as i32) * fh;
    // Clear target (transparent), then copy the frame scaled.
    std::ptr::write_bytes(target.bits, 0, (target.width * target.height * 4) as usize);
    let src = CreateCompatibleDC(null_mut());
    // Build a temporary DIB wrapper by pointing a BITMAPINFO at atlas pixels is
    // not possible with GDI; instead copy the frame row-by-row into the target
    // with manual nearest-neighbour scaling (BGRA in = BGRA out).
    let scale_x = target.width as f32 / fw as f32;
    let scale_y = target.height as f32 / fh as f32;
    for dy in 0..target.height {
        let syy = ((dy as f32 / scale_y) as i32).min(fh - 1) + sy;
        for dx in 0..target.width {
            let sxx = ((dx as f32 / scale_x) as i32).min(fw - 1) + sx;
            let src_i = ((syy * atlas.width as i32 + sxx) * 4) as usize;
            let dst_i = ((dy * target.width + dx) * 4) as usize;
            if src_i + 4 <= atlas.pixels.len() && dst_i + 4 <= (target.width * target.height * 4) as usize {
                // WIC PBGRA32 is premultiplied alpha; copy as-is for ULW AC_SRC_ALPHA.
                std::ptr::copy_nonoverlapping(
                    atlas.pixels.as_ptr().add(src_i),
                    target.bits.add(dst_i), 4);
            }
        }
    }
    DeleteDC(src);

    let mut blend = BLENDFUNCTION {
        BlendOp: AC_SRC_OVER, BlendFlags: 0,
        SourceConstantAlpha: (s.opacity * 255 / 100) as u8,
        AlphaFormat: AC_SRC_ALPHA,
    };
    let size = SIZE { cx: target.width, cy: target.height };
    let pt = POINT { x: 0, y: 0 };
    UpdateLayeredWindow(s.hwnd, null_mut(), null(), &size, target.hdc, &pt,
        0, &mut blend, ULW_ALPHA);
}

unsafe extern "system" fn wndproc(hwnd: HWND, msg: UINT, wp: WPARAM, lp: LPARAM) -> LRESULT {
    let s = &mut *STATE;
    match msg {
        WM_TIMER => {
            let now = now_ms();
            let dt = (now - s.last_tick).min(200) as u32;
            s.last_tick = now;
            if !s.dragging {
                // Petdex physics: step throw and update position.
                if s.physics.is_throwing() {
                    let mut work = RECT::default();
                    SystemParametersInfoW(SPI_GETWORKAREA, 0, &mut work as *mut _ as *mut c_void, 0);
                    let mut rect = RECT::default();
                    GetWindowRect(hwnd, &mut rect);
                    let step = s.physics.step(dt as f64 / 1000.0,
                        rect.left as f64, rect.top as f64,
                        s.target.as_ref().map(|t| t.width).unwrap_or(FRAME_W),
                        s.target.as_ref().map(|t| t.height).unwrap_or(FRAME_H),
                        (work.left, work.top, work.right, work.bottom));
                    if let Some(st) = step.suggested_state { s.anim.set_state(st) }
                    SetWindowPos(hwnd, HWND_TOPMOST, step.x as i32, step.y as i32, 0, 0,
                        SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOZORDER);
                }
                s.anim.tick(dt);
                present(s);
            }
            0
        }
        WM_LBUTTONDOWN => {
            GetCursorPos(&mut s.drag_origin);
            GetWindowRect(hwnd, &mut s.win_origin);
            s.dragging = true;
            s.physics.begin_drag(s.drag_origin.x as f64, s.drag_origin.y as f64, now_ms());
            SetCapture(hwnd);
            0
        }
        WM_MOUSEMOVE => {
            if s.dragging {
                let mut cur = POINT::default();
                GetCursorPos(&mut cur);
                let nx = s.win_origin.left + cur.x - s.drag_origin.x;
                let ny = s.win_origin.top + cur.y - s.drag_origin.y;
                if let Some(st) = s.physics.update_drag(cur.x as f64, cur.y as f64, now_ms()) {
                    s.anim.set_state(st);
                }
                SetWindowPos(hwnd, HWND_TOPMOST, nx, ny, 0, 0,
                    SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOZORDER | SWP_NOCOPYBITS);
            }
            0
        }
        WM_LBUTTONUP => {
            if s.dragging {
                s.dragging = false;
                ReleaseCapture();
                let mut cur = POINT::default();
                GetCursorPos(&mut cur);
                s.physics.end_drag(cur.x as f64, cur.y as f64, now_ms());
                present(s);
            }
            0
        }
        WM_RBUTTONUP => {
            s.menu_ctx.always_on_top = s.always_on_top;
            s.menu_ctx.focus_mode = s.focus_mode;
            if let Some(menu) = s.menu.as_ref() {
                let ctx = &mut s.menu_ctx as *mut MenuCtx;
                let mut cur = POINT::default();
                GetCursorPos(&mut cur);
                let mut work = RECT::default();
                SystemParametersInfoW(SPI_GETWORKAREA, 0, &mut work as *mut _ as *mut c_void, 0);
                // Clamp menu origin into the work area (petdex parity).
                let (mx, my) = dsh_pet_native::menu::compute_popup_origin(
                    cur.x, cur.y, menu.width, menu.height,
                    work.left, work.top, work.right, work.bottom);
                SetWindowPos(menu.hwnd, HWND_TOPMOST, mx, my, 0, 0,
                    SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOZORDER);
                show_menu(menu, ctx);
            }
            0
        }
        WM_DESTROY | WM_CLOSE | WM_QUERYENDSESSION | WM_ENDSESSION => {
            QUITTING.store(1, Ordering::SeqCst);
            PostQuitMessage(0);
            0
        }
        _ => DefWindowProcW(hwnd, msg, wp, lp),
    }
}

/// stdin protocol (petdex parity): one state slug per line.
unsafe fn stdin_loop() {
    let h = GetStdHandle(STD_INPUT_HANDLE);
    let mut buf = [0u8; 128];
    let mut acc = Vec::new();
    while QUITTING.load(Ordering::SeqCst) == 0 {
        let mut read = 0u32;
        if ReadFile(h, buf.as_mut_ptr() as *mut c_void, buf.len() as u32, &mut read, null_mut()) == 0 || read == 0 { break }
        acc.extend_from_slice(&buf[..read as usize]);
        while let Some(pos) = acc.iter().position(|&b| b == b'\n') {
            let line = String::from_utf8_lossy(&acc[..pos]).trim().to_string();
            acc.drain(..=pos);
            let s = &mut *STATE;
            if let Some(rest) = line.strip_prefix("bubble:") {
                // bubble:<status>|<text>  (status: idle|needs-input|running|completed|failed)
                let (status_str, text) = rest.split_once('|').unwrap_or((rest, ""));
                let status = match status_str.trim().to_ascii_lowercase().as_str() {
                    "needs-input" | "waiting" => SessionStatus::NeedsInput,
                    "running" => SessionStatus::Running,
                    "completed" | "done" => SessionStatus::Completed,
                    "failed" | "error" => SessionStatus::Failed,
                    _ => SessionStatus::Idle,
                };
                if let Some(win) = s.bubble_win.as_ref() {
                    let (bw, bh) = bubble_size();
                    let mut rect = RECT::default(); GetWindowRect(s.hwnd, &mut rect);
                    let mut work = RECT::default();
                    SystemParametersInfoW(SPI_GETWORKAREA, 0, &mut work as *mut _ as *mut c_void, 0);
                    let (x, y) = compute_bubble_placement(rect.left, rect.top,
                        rect.right-rect.left, rect.bottom-rect.top, bw, bh,
                        work.left, work.top, work.right, work.bottom);
                    SetWindowPos(win.hwnd, HWND_TOPMOST, x, y, 0, 0,
                        SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOZORDER);
                    show_bubble(win, &BubbleView {
                        title: if text.is_empty() { status.summary().to_string() } else { text.to_string() },
                        status, session_id: String::new(),
                    });
                }
            } else if let Some(state) = PetState::from_slug(&line) {
                s.anim.set_state(state);
                present(s);
            }
        }
    }
}

fn parse_i32(args: &[String], key: &str, default: i32) -> i32 {
    args.iter().position(|a| a == key)
        .and_then(|i| args.get(i + 1))
        .and_then(|v| v.parse().ok())
        .unwrap_or(default)
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let scale = parse_i32(&args, "--scale", 100).clamp(50, 300);
    let opacity = parse_i32(&args, "--opacity", 85).clamp(20, 100);
    let pet_dir = args.iter().position(|a| a == "--pet-dir")
        .and_then(|i| args.get(i + 1)).cloned().unwrap_or_default();

    unsafe {
        CoInitializeEx(null_mut(), COINIT_APARTMENTTHREADED);
        let _co = true;

        // Decode sprite atlas via WIC (petdex call chain).
        let sheet = format!("{}\\spritesheet.webp", pet_dir);
        let atlas = wic::decode_atlas(&sheet).or_else(|| {
            wic::decode_atlas(&format!("{}\\spritesheet.png", pet_dir)) });

        let hinst = GetModuleHandleW(null());
        let cls = wide("DshPetRustWindow");
        let wc = WNDCLASSW {
            style: 0, lpfnWndProc: Some(wndproc), cbClsExtra: 0, cbWndExtra: 0,
            hInstance: hinst, hIcon: null_mut(), hCursor: null_mut(),
            hbrBackground: null_mut(), lpszMenuName: null(), lpszClassName: cls.as_ptr(),
        };
        if RegisterClassW(&wc) == 0 { eprintln!("RegisterClassW failed: {}", GetLastError()); return }

        // Register the menu and bubble window classes (petdex UI parity).
        let menu_cls = wide("DshPetMenuWindow");
        let wc_menu = WNDCLASSW {
            style: 0, lpfnWndProc: Some(menu_wndproc), cbClsExtra: 0, cbWndExtra: 8,
            hInstance: hinst, hIcon: null_mut(), hCursor: null_mut(),
            hbrBackground: null_mut(), lpszMenuName: null(), lpszClassName: menu_cls.as_ptr(),
        };
        RegisterClassW(&wc_menu);
        let bubble_cls = wide("DshPetBubbleWindow");
        let wc_bubble = WNDCLASSW {
            style: 0, lpfnWndProc: Some(bubble_wndproc), cbClsExtra: 0, cbWndExtra: 0,
            hInstance: hinst, hIcon: null_mut(), hCursor: null_mut(),
            hbrBackground: null_mut(), lpszMenuName: null(), lpszClassName: bubble_cls.as_ptr(),
        };
        RegisterClassW(&wc_bubble);

        let fw = FRAME_W * scale / 100;
        let fh = FRAME_H * scale / 100;
        let (mut px, mut py) = (40, 40);
        let mut work = RECT::default();
        if SystemParametersInfoW(SPI_GETWORKAREA, 0, &mut work as *mut _ as *mut c_void, 0) != 0 {
            px = work.right - fw - 24; py = work.bottom - fh - 24;
        }

        let target = RenderTarget::new(fw, fh);
        let menu_layout = compute_menu_layout(&build_default_menu_entries(true, false));
        let menu_surface = LayeredSurface::create(menu_layout.width, menu_layout.height,
            menu_cls.as_ptr(), wide("dsh-pet menu").as_ptr(), hinst, 0, 0);
        let (bw, bh) = bubble_size();
        let bubble_surface = LayeredSurface::create(bw, bh,
            bubble_cls.as_ptr(), wide("dsh-pet bubble").as_ptr(), hinst, 0, 0);
        let mut state = AppState {
            hwnd: null_mut(), dragging: false,
            drag_origin: POINT::default(), win_origin: RECT::default(),
            scale, opacity, atlas, target,
            anim: PetAnimationEngine::new(), physics: PetPhysics::new(),
            last_tick: now_ms(), bubbles: Vec::new(),
            menu: menu_surface, bubble_win: bubble_surface,
            menu_ctx: MenuCtx { always_on_top: true, focus_mode: false, on_command: on_menu_command },
            always_on_top: true, focus_mode: false,
        };
        STATE = &mut state as *mut AppState;

        let hwnd = CreateWindowExW(
            WS_EX_LAYERED | WS_EX_TOOLWINDOW, cls.as_ptr(), wide("dsh-pet").as_ptr(),
            WS_POPUP, px, py, fw, fh,
            null_mut(), null_mut(), hinst, null_mut());
        if hwnd.is_null() { eprintln!("CreateWindowExW failed"); return }
        state.hwnd = hwnd;
        ShowWindow(hwnd, SW_SHOWNOACTIVATE);
        SetWindowPos(hwnd, HWND_TOPMOST, px, py, fw, fh, SWP_NOACTIVATE | SWP_NOZORDER);
        present(&mut state);
        SetTimer(hwnd, TIMER_ID, TICK_MS, null_mut());

        // stdin reader thread (state lines from the Host bridge).
        let stdin = std::thread::spawn(|| stdin_loop());

        let mut msg = MSG { hwnd: null_mut(), message: 0, wParam: 0,
            lParam: 0, time: 0, pt: POINT::default() };
        while GetMessageW(&mut msg, null_mut(), 0, 0) > 0 {
            TranslateMessage(&msg);
            DispatchMessageW(&msg);
            if QUITTING.load(Ordering::SeqCst) != 0 { break }
        }

        KillTimer(hwnd, TIMER_ID);
        QUITTING.store(1, Ordering::SeqCst);
        let _ = stdin.join();
        if let Some(t) = state.target.as_ref() { t.destroy() }
        CoUninitialize();
    }
}
