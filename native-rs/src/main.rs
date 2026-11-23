//! dsh-pet native renderer — main entry (Rust port of petdex Windows layer).
//! Stage 5a: Win32 window + message loop + input plumbing. Sprite decode next.

mod win32;

use win32::*;
use std::ffi::c_void;
use std::sync::atomic::{AtomicI32, Ordering};

const WM_APP_STATE: u32 = 0x8001;
const TIMER_ID: UINT = 1;
const TICK_MS: u32 = 20;
static QUITTING: AtomicI32 = AtomicI32::new(0);

struct AppState {
    hwnd: HWND,
    dragging: bool,
    drag_origin: POINT,
    win_origin: RECT,
    scale: i32,
    opacity: i32,
}

static mut STATE: *mut AppState = std::ptr::null_mut();

unsafe extern "system" fn wndproc(hwnd: HWND, msg: UINT, wp: WPARAM, lp: LPARAM) -> LRESULT {
    match msg {
        WM_TIMER => 0,
        WM_LBUTTONDOWN => {
            let s = &mut *STATE;
            GetCursorPos(&mut s.drag_origin);
            GetWindowRect(hwnd, &mut s.win_origin);
            s.dragging = true;
            SetCapture(hwnd);
            0
        }
        WM_MOUSEMOVE => {
            let s = &mut *STATE;
            if s.dragging {
                let mut cur = POINT::default();
                GetCursorPos(&mut cur);
                let nx = s.win_origin.left + cur.x - s.drag_origin.x;
                let ny = s.win_origin.top + cur.y - s.drag_origin.y;
                SetWindowPos(hwnd, HWND_TOPMOST, nx, ny, 0, 0,
                    SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOZORDER | SWP_NOCOPYBITS);
            }
            0
        }
        WM_LBUTTONUP => {
            let s = &mut *STATE;
            if s.dragging { s.dragging = false; ReleaseCapture(); }
            0
        }
        WM_RBUTTONUP => {
            // Menu window is added in the next stage; for now just a no-op.
            0
        }
        WM_DESTROY | WM_CLOSE | WM_QUERYENDSESSION | WM_ENDSESSION => {
            QUITTING.store(1, Ordering::SeqCst);
            PostQuitMessage(0);
            0
        }
        WM_APP_STATE => 0,
        _ => DefWindowProcW(hwnd, msg, wp, lp),
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

    unsafe {
        CoInitializeEx(std::ptr::null_mut(), COINIT_APARTMENTTHREADED);

        let hinst = GetModuleHandleW(std::ptr::null());
        let cls = wide("DshPetRustWindow");
        let mut wc = WNDCLASSW {
            style: 0, lpfnWndProc: Some(wndproc), cbClsExtra: 0, cbWndExtra: 0,
            hInstance: hinst, hIcon: std::ptr::null_mut(), hCursor: std::ptr::null_mut(),
            hbrBackground: std::ptr::null_mut(), lpszMenuName: std::ptr::null(),
            lpszClassName: cls.as_ptr(),
        };
        if RegisterClassW(&wc) == 0 {
            eprintln!("RegisterClassW failed: {}", GetLastError());
            return;
        }

        // Frame-size window, bottom-right of work area (petdex parity).
        let frame_w = 192 * scale / 100;
        let frame_h = 208 * scale / 100;
        let mut work = RECT::default();
        let (mut px, mut py) = (40, 40);
        if SystemParametersInfoW(SPI_GETWORKAREA, 0, &mut work as *mut _ as *mut c_void, 0) != 0 {
            px = work.right - frame_w - 24;
            py = work.bottom - frame_h - 24;
        }

        let mut state = AppState {
            hwnd: std::ptr::null_mut(), dragging: false,
            drag_origin: POINT::default(), win_origin: RECT::default(),
            scale, opacity,
        };
        STATE = &mut state as *mut AppState;

        let hwnd = CreateWindowExW(
            WS_EX_LAYERED | WS_EX_TOOLWINDOW, cls.as_ptr(), wide("dsh-pet").as_ptr(),
            WS_POPUP, px, py, frame_w, frame_h,
            std::ptr::null_mut(), std::ptr::null_mut(), hinst, std::ptr::null_mut());
        if hwnd.is_null() {
            eprintln!("CreateWindowExW failed: {}", GetLastError());
            return;
        }
        state.hwnd = hwnd;
        ShowWindow(hwnd, SW_SHOWNOACTIVATE);
        SetWindowPos(hwnd, HWND_TOPMOST, px, py, frame_w, frame_h, SWP_NOACTIVATE | SWP_NOZORDER);
        SetTimer(hwnd, TIMER_ID, TICK_MS, std::ptr::null_mut());

        let mut msg = MSG { hwnd: std::ptr::null_mut(), message: 0, wParam: 0,
            lParam: 0, time: 0, pt: POINT::default() };
        while GetMessageW(&mut msg, std::ptr::null_mut(), 0, 0) > 0 {
            TranslateMessage(&msg);
            DispatchMessageW(&msg);
            if QUITTING.load(Ordering::SeqCst) != 0 { break }
        }

        KillTimer(hwnd, TIMER_ID);
        CoUninitialize();
    }
}
