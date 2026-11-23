//! Minimal hand-written Win32 FFI — no external crates, tiny binary.
//! Covers: layered window, WIC WebP/PNG decode, GDI blit, menus, messages.

#![allow(non_camel_case_types, non_snake_case, non_upper_case_globals, dead_code)]

use std::ffi::c_void;

pub type HWND = *mut c_void;
pub type HINSTANCE = *mut c_void;
pub type HDC = *mut c_void;
pub type HBITMAP = *mut c_void;
pub type HANDLE = *mut c_void;
pub type HICON = *mut c_void;
pub type HMENU = *mut c_void;
pub type WPARAM = usize;
pub type LPARAM = isize;
pub type LRESULT = isize;
pub type BOOL = i32;
pub type UINT = u32;
pub type DWORD = u32;
pub type HRESULT = i32;
pub type ULONG = u32;
pub type LONGLONG = i64;

pub const TRUE: BOOL = 1;
pub const FALSE: BOOL = 0;
pub const S_OK: HRESULT = 0;

#[repr(C)]
#[derive(Debug, Clone, Copy, Default)]
pub struct POINT { pub x: i32, pub y: i32 }
#[repr(C)]
#[derive(Debug, Clone, Copy, Default)]
pub struct RECT { pub left: i32, pub top: i32, pub right: i32, pub bottom: i32 }
#[repr(C)]
#[derive(Debug, Clone, Copy, Default)]
pub struct SIZE { pub cx: i32, pub cy: i32 }

#[repr(C)]
#[derive(Debug, Clone, Copy)]
pub struct BLENDFUNCTION {
    pub BlendOp: u8,
    pub BlendFlags: u8,
    pub SourceConstantAlpha: u8,
    pub AlphaFormat: u8,
}

#[repr(C)]
pub struct MSG {
    pub hwnd: HWND, pub message: UINT, pub wParam: WPARAM,
    pub lParam: LPARAM, pub time: DWORD, pub pt: POINT,
}

#[repr(C)]
pub struct WNDCLASSW {
    pub style: UINT,
    pub lpfnWndProc: Option<unsafe extern "system" fn(HWND, UINT, WPARAM, LPARAM) -> LRESULT>,
    pub cbClsExtra: i32, pub cbWndExtra: i32, pub hInstance: HINSTANCE,
    pub hIcon: HICON, pub hCursor: HANDLE, pub hbrBackground: HANDLE,
    pub lpszMenuName: *const u16, pub lpszClassName: *const u16,
}

#[repr(C)]
#[derive(Debug, Clone, Copy)]
pub struct BITMAPINFOHEADER {
    pub biSize: DWORD, pub biWidth: i32, pub biHeight: i32,
    pub biPlanes: u16, pub biBitCount: u16, pub biCompression: DWORD,
    pub biSizeImage: DWORD, pub biXPelsPerMeter: i32, pub biYPelsPerMeter: i32,
    pub biClrUsed: DWORD, pub biClrImportant: DWORD,
}
#[repr(C)]
pub struct BITMAPINFO { pub bmiHeader: BITMAPINFOHEADER, pub bmiColors: [u32; 1] }

// Window styles / constants
pub const WS_POPUP: u32 = 0x8000_0000;
pub const WS_EX_LAYERED: u32 = 0x0008_0000;
pub const WS_EX_TOOLWINDOW: u32 = 0x0000_0080;
pub const HWND_TOPMOST: HWND = -1isize as HWND;
pub const SWP_NOSIZE: u32 = 0x0001;
pub const SWP_NOMOVE: u32 = 0x0002;
pub const SWP_NOACTIVATE: u32 = 0x0010;
pub const SWP_NOZORDER: u32 = 0x0004;
pub const SWP_NOCOPYBITS: u32 = 0x0100;
pub const SW_SHOWNOACTIVATE: i32 = 4;
pub const ULW_ALPHA: u32 = 0x0002;
pub const AC_SRC_OVER: u8 = 0x00;
pub const AC_SRC_ALPHA: u8 = 0x01;
pub const BI_RGB: u32 = 0;
pub const DIB_RGB_COLORS: u32 = 0;
pub const SRCCOPY: i32 = 0x00CC0020;
pub const SPI_GETWORKAREA: u32 = 0x0030;

// Messages
pub const WM_DESTROY: u32 = 0x0002;
pub const WM_CLOSE: u32 = 0x0010;
pub const WM_TIMER: u32 = 0x0113;
pub const WM_LBUTTONDOWN: u32 = 0x0201;
pub const WM_LBUTTONUP: u32 = 0x0202;
pub const WM_MOUSEMOVE: u32 = 0x0200;
pub const WM_RBUTTONUP: u32 = 0x0205;
pub const WM_QUERYENDSESSION: u32 = 0x0011;
pub const WM_ENDSESSION: u32 = 0x0016;
pub const GENERIC_READ: u32 = 0x8000_0000;
pub const GENERIC_WRITE: u32 = 0x4000_0000;
pub const FILE_SHARE_READ: u32 = 0x1;
pub const FILE_SHARE_WRITE: u32 = 0x2;
pub const OPEN_EXISTING: u32 = 3;
pub const CREATE_ALWAYS: u32 = 2;
pub const FILE_ATTRIBUTE_NORMAL: u32 = 0x80;
pub const SYNCHRONIZE: u32 = 0x0010_0000;
pub const WAIT_OBJECT_0: u32 = 0;

#[link(name = "user32")]
extern "system" {
    pub fn RegisterClassW(lpwc: *const WNDCLASSW) -> u16;
    pub fn CreateWindowExW(dwExStyle: u32, lpClassName: *const u16, lpWindowName: *const u16,
        dwStyle: u32, x: i32, y: i32, w: i32, h: i32,
        hWndParent: HWND, hMenu: HMENU, hInstance: HINSTANCE, lpParam: *mut c_void) -> HWND;
    pub fn ShowWindow(hwnd: HWND, nCmdShow: i32) -> BOOL;
    pub fn UpdateWindow(hwnd: HWND) -> BOOL;
    pub fn SetWindowPos(hwnd: HWND, after: HWND, x: i32, y: i32, cx: i32, cy: i32, flags: u32) -> BOOL;
    pub fn GetWindowRect(hwnd: HWND, rect: *mut RECT) -> BOOL;
    pub fn GetCursorPos(pt: *mut POINT) -> BOOL;
    pub fn ClientToScreen(hwnd: HWND, pt: *mut POINT) -> BOOL;
    pub fn SetCapture(hwnd: HWND) -> HWND;
    pub fn ReleaseCapture() -> BOOL;
    pub fn SetTimer(hwnd: HWND, id: UINT, elapse: UINT, proc: *mut c_void) -> UINT;
    pub fn KillTimer(hwnd: HWND, id: UINT) -> BOOL;
    pub fn GetMessageW(msg: *mut MSG, hwnd: HWND, min: UINT, max: UINT) -> BOOL;
    pub fn PeekMessageW(msg: *mut MSG, hwnd: HWND, min: UINT, max: UINT, remove: UINT) -> BOOL;
    pub fn TranslateMessage(msg: *const MSG) -> BOOL;
    pub fn DispatchMessageW(msg: *const MSG) -> LRESULT;
    pub fn PostQuitMessage(code: i32);
    pub fn PostMessageW(hwnd: HWND, msg: UINT, wp: WPARAM, lp: LPARAM) -> BOOL;
    pub fn DefWindowProcW(hwnd: HWND, msg: UINT, wp: WPARAM, lp: LPARAM) -> LRESULT;
    pub fn DestroyWindow(hwnd: HWND) -> BOOL;
    pub fn SystemParametersInfoW(action: u32, param: u32, pvParam: *mut c_void, fWinIni: u32) -> BOOL;
    pub fn LoadCursorW(hinst: HINSTANCE, name: *const u16) -> HANDLE;
    pub fn SetCursor(cursor: HANDLE) -> HANDLE;
    pub fn GetSystemMetrics(index: i32) -> i32;
}

// GDI stock objects / text modes for the menu and bubble windows.
pub const TRANSPARENT: i32 = 1;
pub const DEFAULT_GUI_FONT: i32 = 17;
pub const FW_NORMAL: u32 = 400;
pub const ANSI_CHARSET: u8 = 0;
pub const OUT_TT_PRECIS: u8 = 4;
pub const CLIP_DEFAULT_PRECIS: u8 = 0;
pub const DEFAULT_QUALITY: u8 = 0;
pub const DEFAULT_PITCH: u8 = 2;
pub const FF_DONTCARE: u8 = 0;

#[repr(C)]
pub struct LOGFONTW {
    pub lfHeight: i32, pub lfWidth: i32, pub lfEscapement: i32, pub lfOrientation: i32,
    pub lfWeight: i32, pub lfItalic: u8, pub lfUnderline: u8, pub lfStrikeOut: u8,
    pub lfCharSet: u8, pub lfOutPrecision: u8, pub lfClipPrecision: u8,
    pub lfQuality: u8, pub lfPitchAndFamily: u8, pub lfFaceName: [u16; 32],
}


#[link(name = "gdi32")]
extern "system" {
    pub fn CreateCompatibleDC(hdc: HDC) -> HDC;
    pub fn CreateDIBSection(hdc: HDC, bmi: *const BITMAPINFO, usage: u32, bits: *mut *mut c_void,
        hSection: HANDLE, offset: u32) -> HBITMAP;
    pub fn SelectObject(hdc: HDC, obj: HANDLE) -> HANDLE;
    pub fn DeleteObject(obj: HANDLE) -> BOOL;
    pub fn DeleteDC(hdc: HDC) -> BOOL;
    pub fn StretchBlt(dst: HDC, x: i32, y: i32, w: i32, h: i32, src: HDC,
        sx: i32, sy: i32, sw: i32, sh: i32, rop: i32) -> BOOL;
    pub fn GetDC(hwnd: HWND) -> HDC;
    pub fn ReleaseDC(hwnd: HWND, hdc: HDC) -> i32;
    pub fn UpdateLayeredWindow(hwnd: HWND, hdcDst: HDC, pptDst: *const POINT, psize: *const SIZE,
        hdcSrc: HDC, pptSrc: *const POINT, crKey: u32, pblend: *const BLENDFUNCTION, dwFlags: u32) -> BOOL;
    pub fn TextOutW(hdc: HDC, x: i32, y: i32, text: *const u16, len: i32) -> BOOL;
    pub fn SetTextColor(hdc: HDC, color: u32) -> u32;
    pub fn SetBkMode(hdc: HDC, mode: i32) -> i32;
    pub fn GetStockObject(index: i32) -> HANDLE;
    pub fn CreateFontIndirectW(lf: *const LOGFONTW) -> HANDLE;
}

#[link(name = "kernel32")]
extern "system" {
    pub fn GetModuleHandleW(name: *const u16) -> HINSTANCE;
    pub fn GetStdHandle(which: u32) -> HANDLE;
    pub fn ReadFile(h: HANDLE, buf: *mut c_void, len: u32, read: *mut u32, overlapped: *mut c_void) -> BOOL;
    pub fn GetCurrentProcessId() -> u32;
    pub fn OpenProcess(desired: u32, inherit: i32, pid: u32) -> HANDLE;
    pub fn WaitForSingleObject(h: HANDLE, ms: u32) -> u32;
    pub fn CloseHandle(h: HANDLE) -> BOOL;
    pub fn CreateFileW(name: *const u16, access: u32, share: u32, sec: *mut c_void,
        create: u32, flags: u32, tmpl: HANDLE) -> HANDLE;
    pub fn WriteFile(h: HANDLE, buf: *const c_void, len: u32, written: *mut u32, ov: *mut c_void) -> BOOL;
    pub fn GetTempPathW(len: u32, buf: *mut u16) -> u32;
    pub fn GetLastError() -> u32;
    pub fn Sleep(ms: u32);
}

pub const STD_INPUT_HANDLE: u32 = 0xFFFF_FFF6;
pub const PM_REMOVE: u32 = 0x0001;

// ---- WIC COM interfaces (hand-written vtables) ----
#[repr(C)]
pub struct IWICImagingFactoryVtbl {
    pub query: unsafe extern "system" fn(*mut c_void, *const [u8;16], *mut *mut c_void) -> HRESULT,
    pub add_ref: unsafe extern "system" fn(*mut c_void) -> ULONG,
    pub release: unsafe extern "system" fn(*mut c_void) -> ULONG,
    pub pad1: *mut c_void, pub pad2: *mut c_void, pub pad3: *mut c_void, pub pad4: *mut c_void,
    pub pad5: *mut c_void, pub pad6: *mut c_void, pub pad7: *mut c_void, pub pad8: *mut c_void,
    pub create_decoder_from_filename: unsafe extern "system" fn(*mut c_void, *const u16, *mut c_void, u32, *mut *mut c_void) -> HRESULT,
}

// Use the documented CLSID/IID for WIC factory via CoCreateInstance.
#[link(name = "ole32")]
extern "system" {
    pub fn CoInitializeEx(pv: *mut c_void, coinit: u32) -> HRESULT;
    pub fn CoUninitialize();
    pub fn CoCreateInstance(cls: *const [u8;16], outer: *mut c_void, ctx: u32, iid: *const [u8;16], out: *mut *mut c_void) -> HRESULT;
}

pub const CLSID_WICImagingFactory: [u8;16] = [
    0xc0,0xac,0xaf,0x41,0x27,0x8a,0xcf,0x11,0x85,0xee,0x00,0x15,0x60,0x61,0xcf,0x60,
];
pub const IID_IWICImagingFactory: [u8;16] = [
    0xec,0x5e,0xc0,0x9b,0x09,0xfb,0x47,0xdc,0xab,0x4c,0x62,0x9c,0x93,0x11,0x3a,0x2e,
];
pub const COINIT_APARTMENTTHREADED: u32 = 0x2;
pub const WIC_CACHE_ONLOAD: u32 = 0x1;

pub fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}
