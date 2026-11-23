//! Layered-window UI helpers for the menu and bubble windows.
//! GDI drawing only — no external crates, tiny binary.

use crate::win32::*;
use dsh_pet_native::core::SessionStatus;
use dsh_pet_native::bubble::status_dot_rgb;
use std::ffi::c_void;
use std::ptr::{null, null_mut};

pub struct LayeredSurface {
    pub hwnd: HWND,
    pub hdc: HDC,
    pub bitmap: HBITMAP,
    pub bits: *mut u8,
    pub width: i32,
    pub height: i32,
}

impl LayeredSurface {
    pub unsafe fn create(width: i32, height: i32, class: *const u16, title: *const u16,
        hinst: HINSTANCE, x: i32, y: i32) -> Option<Self> {
        let mut bmi = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: width, biHeight: -height, biPlanes: 1,
                biBitCount: 32, biCompression: BI_RGB,
                biSizeImage: 0, biXPelsPerMeter: 0, biYPelsPerMeter: 0,
                biClrUsed: 0, biClrImportant: 0,
            }, bmiColors: [0],
        };
        let screen = GetDC(null_mut());
        let mut bits: *mut c_void = null_mut();
        let bitmap = CreateDIBSection(screen, &mut bmi, DIB_RGB_COLORS, &mut bits, null_mut(), 0);
        ReleaseDC(null_mut(), screen);
        if bitmap.is_null() { return None }
        let hdc = CreateCompatibleDC(null_mut());
        let hwnd = CreateWindowExW(
            WS_EX_LAYERED | WS_EX_TOOLWINDOW, class, title, WS_POPUP,
            x, y, width, height, null_mut(), null_mut(), hinst, null_mut());
        if hwnd.is_null() { DeleteObject(bitmap); DeleteDC(hdc); return None }
        Some(Self { hwnd, hdc, bitmap, bits: bits as *mut u8, width, height })
    }

    pub unsafe fn clear(&self) {
        std::ptr::write_bytes(self.bits, 0, (self.width * self.height * 4) as usize);
    }

    /// Fill a rounded rect with premultiplied BGRA color.
    pub unsafe fn round_rect(&self, x: i32, y: i32, w: i32, h: i32, radius: i32, color: (u8,u8,u8,u8)) {
        let (r,g,b,a) = color;
        let a = a as f32 / 255.0;
        for py in y..(y+h).min(self.height) {
            for px in x..(x+w).min(self.width) {
                let rx = px - x; let ry = py - y;
                // Rounded corner test.
                let in_corner =
                    (rx < radius && ry < radius && ((rx-radius)*(rx-radius)+(ry-radius)*(ry-radius) <= radius*radius)) ||
                    (rx >= w-radius && ry < radius && ((rx-(w-radius-1))*(rx-(w-radius-1))+(ry-radius)*(ry-radius) <= radius*radius)) ||
                    (rx < radius && ry >= h-radius && ((rx-radius)*(rx-radius)+(ry-(h-radius-1))*(ry-(h-radius-1)) <= radius*radius)) ||
                    (rx >= w-radius && ry >= h-radius && ((rx-(w-radius-1))*(rx-(w-radius-1))+(ry-(h-radius-1))*(ry-(h-radius-1)) <= radius*radius));
                let inside = (rx >= 0 && ry >= 0 && rx < w && ry < h) &&
                    (rx >= radius || ry >= radius || rx < w-radius || ry < h-radius) && !(
                    (rx < radius && ry < radius && ((rx-radius)*(rx-radius)+(ry-radius)*(ry-radius) > radius*radius)) ||
                    (rx >= w-radius && ry < radius && ((rx-(w-radius-1))*(rx-(w-radius-1))+(ry-radius)*(ry-radius) > radius*radius)) ||
                    (rx < radius && ry >= h-radius && ((rx-radius)*(rx-radius)+(ry-(h-radius-1))*(ry-(h-radius-1)) > radius*radius)) ||
                    (rx >= w-radius && ry >= h-radius && ((rx-(w-radius-1))*(rx-(w-radius-1))+(ry-(h-radius-1))*(ry-(h-radius-1)) > radius*radius))
                    );
                if inside || in_corner {
                    let i = ((py*self.width + px)*4) as usize;
                    if i+4 <= (self.width*self.height*4) as usize {
                        self.bits.add(i).write((r as f32*a) as u8);
                        self.bits.add(i+1).write((g as f32*a) as u8);
                        self.bits.add(i+2).write((b as f32*a) as u8);
                        self.bits.add(i+3).write((a * 255.0) as u8);
                    }
                }
            }
        }
    }

    /// Fill a circle (status dot).
    pub unsafe fn dot(&self, cx: i32, cy: i32, radius: i32, status: SessionStatus) {
        let (r,g,b) = status_dot_rgb(status);
        for y in (cy-radius)..=(cy+radius) {
            for x in (cx-radius)..=(cx+radius) {
                if (x-cx)*(x-cx)+(y-cy)*(y-cy) <= radius*radius && x>=0 && y>=0 && x<self.width && y<self.height {
                    let i = ((y*self.width+x)*4) as usize;
                    self.bits.add(i).write((r as f32*0.9) as u8);
                    self.bits.add(i+1).write((g as f32*0.9) as u8);
                    self.bits.add(i+2).write((b as f32*0.9) as u8);
                    self.bits.add(i+3).write(230);
                }
            }
        }
    }

    pub unsafe fn present(&self, opacity: u8) {
        let mut blend = BLENDFUNCTION {
            BlendOp: AC_SRC_OVER, BlendFlags: 0, SourceConstantAlpha: opacity,
            AlphaFormat: AC_SRC_ALPHA,
        };
        let size = SIZE { cx: self.width, cy: self.height };
        let pt = POINT { x: 0, y: 0 };
        UpdateLayeredWindow(self.hwnd, null_mut(), null(), &size, self.hdc, &pt,
            0, &mut blend, ULW_ALPHA);
    }

    pub unsafe fn destroy(&self) {
        if !self.hwnd.is_null() { DestroyWindow(self.hwnd); }
        if !self.bitmap.is_null() { DeleteObject(self.bitmap); }
        if !self.hdc.is_null() { DeleteDC(self.hdc); }
    }
}
