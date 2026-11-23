//! Menu + bubble window procedures and painting (petdex UI parity).
//! Kept in a separate module so main.rs stays readable.

use crate::win32::*;
use crate::ui::LayeredSurface;
use dsh_pet_native::core::SessionStatus;
use dsh_pet_native::menu::{build_default_menu_entries, compute_menu_layout, PopupMenuEntry};
use dsh_pet_native::bubble::{status_dot_rgb, DEFAULT_BUBBLE_WIDTH, DEFAULT_BUBBLE_HEIGHT};
use std::ffi::c_void;
use std::ptr::{null, null_mut};

pub struct BubbleView {
    pub title: String,
    pub status: SessionStatus,
    pub session_id: String,
}

unsafe fn paint_menu(s: &LayeredSurface, entries: &[PopupMenuEntry], hover: Option<usize>) {
    s.clear();
    let layout = compute_menu_layout(entries);
    // Card background.
    s.round_rect(0, 0, layout.width, layout.height, 8, (250,250,252,245));
    // Font for labels.
    let mut lf: LOGFONTW = std::mem::zeroed();
    lf.lfHeight = 15;
    lf.lfWeight = 400;
    lf.lfCharSet = ANSI_CHARSET;
    lf.lfOutPrecision = OUT_TT_PRECIS;
    lf.lfClipPrecision = CLIP_DEFAULT_PRECIS;
    lf.lfQuality = DEFAULT_QUALITY;
    lf.lfPitchAndFamily = DEFAULT_PITCH;
    let face: Vec<u16> = "Segoe UI".encode_utf16().chain(std::iter::once(0)).collect();
    lf.lfFaceName[..face.len()].copy_from_slice(&face);
    let font = CreateFontIndirectW(&lf);
    let old_font = SelectObject(s.hdc, font as HANDLE);
    SetBkMode(s.hdc, TRANSPARENT);
    for (i, rect) in layout.rects.iter().enumerate() {
        match entries.get(i) {
            Some(PopupMenuEntry::Item { label, .. }) => {
                if hover == Some(i) {
                    s.round_rect(rect.left, rect.top, rect.right-rect.left, rect.bottom-rect.top,
                        4, (77,107,254,40));
                }
                SetTextColor(s.hdc, 0x20_20_24); // COLORREF is RGB (BGR in memory but TextOut takes COLORREF)
                let text = wide(label);
                // Drawing text into a DIB-backed DC then using UpdateLayeredWindow:
                // GDI text writes opaque pixels; for a layered window we draw text
                // with a transparent background so the card behind shows through.
                TextOutW(s.hdc, rect.left + 10, rect.top + 8, text.as_ptr(), (text.len()-1) as i32);
            }
            Some(PopupMenuEntry::Separator) => {
                s.round_rect(rect.left, rect.top + 4, rect.right-rect.left, 1, 0, (200,200,205,120));
            }
            None => {}
        }
    }
    SelectObject(s.hdc, old_font);
    if !font.is_null() { DeleteObject(font as HANDLE); }
    s.present(255);
}

unsafe fn paint_bubble(s: &LayeredSurface, view: &BubbleView) {
    s.clear();
    // Card: rounded 248x72 with a small tail; status dot at left.
    s.round_rect(0, 0, s.width, s.height, 16, (252,252,254,242));
    s.dot(22, 26, 6, view.status);
    // Status badge text (top) + summary/session (bottom).
    let mut lf: LOGFONTW = std::mem::zeroed();
    lf.lfHeight = 14; lf.lfWeight = 400; lf.lfCharSet = ANSI_CHARSET;
    lf.lfOutPrecision = OUT_TT_PRECIS; lf.lfClipPrecision = CLIP_DEFAULT_PRECIS;
    lf.lfQuality = DEFAULT_QUALITY; lf.lfPitchAndFamily = DEFAULT_PITCH;
    let face: Vec<u16> = "Segoe UI".encode_utf16().chain(std::iter::once(0)).collect();
    lf.lfFaceName[..face.len()].copy_from_slice(&face);
    let font = CreateFontIndirectW(&lf);
    let old_font = SelectObject(s.hdc, font as HANDLE);
    SetBkMode(s.hdc, TRANSPARENT);
    SetTextColor(s.hdc, 0x30_30_38);
    let title = wide(&view.title);
    TextOutW(s.hdc, 36, 18, title.as_ptr(), (title.len()-1) as i32);
    let sub = format!("{} · {}", view.status.summary(), view.session_id);
    let sub_w = wide(&sub);
    TextOutW(s.hdc, 36, 40, sub_w.as_ptr(), (sub_w.len()-1) as i32);
    SelectObject(s.hdc, old_font);
    if !font.is_null() { DeleteObject(font as HANDLE); }
    s.present(245);
}

/// Menu window WndProc: paints on WM_PAINT-equivalent (we paint on show),
/// handles click hit-test and forwards the command id via a callback.
pub unsafe extern "system" fn menu_wndproc(hwnd: HWND, msg: UINT, wp: WPARAM, lp: LPARAM) -> LRESULT {
    match msg {
        WM_LBUTTONDOWN => {
            let x = (lp & 0xFFFF) as i32;
            let y = ((lp >> 16) & 0xFFFF) as i32;
            let ctx = GetWindowLongPtrW(hwnd, 0) as *mut MenuCtx;
            if !ctx.is_null() {
                let entries = build_default_menu_entries((*ctx).always_on_top, (*ctx).focus_mode);
                let layout = compute_menu_layout(&entries);
                if let Some(idx) = layout.hit_test(x, y) {
                    if let PopupMenuEntry::Item { command_id, .. } = entries[idx] {
                        ((*ctx).on_command)(command_id);
                    }
                }
            }
            ShowWindow(hwnd, 0); // SW_HIDE
            0
        }
        WM_RBUTTONUP | WM_DESTROY => 0,
        _ => DefWindowProcW(hwnd, msg, wp, lp),
    }
}

#[repr(C)]
pub struct MenuCtx {
    pub always_on_top: bool,
    pub focus_mode: bool,
    pub on_command: unsafe extern "system" fn(usize),
}

pub unsafe extern "system" fn bubble_wndproc(hwnd: HWND, msg: UINT, wp: WPARAM, lp: LPARAM) -> LRESULT {
    match msg {
        WM_LBUTTONDOWN | WM_RBUTTONUP => { ShowWindow(hwnd, 0); 0 }
        _ => DefWindowProcW(hwnd, msg, wp, lp),
    }
}

// Extra FFI used above.
#[link(name = "user32")]
extern "system" {
    fn GetWindowLongPtrW(hwnd: HWND, index: i32) -> isize;
    fn SetWindowLongPtrW(hwnd: HWND, index: i32, value: isize) -> isize;
}

pub(crate) unsafe fn show_menu(surface: &LayeredSurface, ctx: *mut MenuCtx) {
    let entries = build_default_menu_entries((*ctx).always_on_top, (*ctx).focus_mode);
    paint_menu(surface, &entries, None);
    SetWindowLongPtrW(surface.hwnd, 0, ctx as isize);
    ShowWindow(surface.hwnd, SW_SHOWNOACTIVATE);
    surface.present(255);
}

pub(crate) unsafe fn show_bubble(surface: &LayeredSurface, view: &BubbleView) {
    paint_bubble(surface, view);
    ShowWindow(surface.hwnd, SW_SHOWNOACTIVATE);
    surface.present(245);
}

pub(crate) fn bubble_size() -> (i32, i32) { (DEFAULT_BUBBLE_WIDTH, DEFAULT_BUBBLE_HEIGHT) }
