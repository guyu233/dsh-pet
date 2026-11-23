//! WebP/PNG decode via Windows Imaging Component (WIC), hand-written COM
//! vtables, no external crates. Adapted from the verified C implementation.

use crate::win32::*;
use std::ffi::c_void;
use std::ptr::null_mut;

// GUIDs (little-endian byte layout as Windows expects).
const CLSID_WIC_FACTORY: [u8;16] = [0xc0,0xac,0xaf,0x41,0x27,0x8a,0xcf,0x11,0x85,0xee,0x00,0x15,0x60,0x61,0xcf,0x60];
const IID_FACTORY: [u8;16] = [0xec,0x5e,0xc0,0x9b,0x09,0xfb,0x47,0xdc,0xab,0x4c,0x62,0x9c,0x93,0x11,0x3a,0x2e];
const GUID_PBGRA32: [u8;16] = [0x86,0x00,0x00,0x00,0x00,0x00,0x10,0x00,0x80,0x00,0x00,0xaa,0x00,0x38,0x9b,0x71];
const WIC_DECODE_CACHE_ONLOAD: u32 = 1;
const WIC_DITHER_NONE: u32 = 0;
const WIC_PALETTE_CUSTOM: u32 = 0;

// IUnknown vtable prefix (3 methods).
#[repr(C)]
struct IUnknownVtbl {
    query: unsafe extern "system" fn(*mut c_void, *const c_void, *mut *mut c_void) -> HRESULT,
    addref: unsafe extern "system" fn(*mut c_void) -> ULONG,
    release: unsafe extern "system" fn(*mut c_void) -> ULONG,
}

// IWICBitmapSource vtable: IUnknown + GetSize + GetPixelFormat + GetResolution
// + CopyPalette + CopyPixels.
#[repr(C)]
struct BitmapSourceVtbl {
    unk: IUnknownVtbl,
    get_size: unsafe extern "system" fn(*mut c_void, *mut u32, *mut u32) -> HRESULT,
    get_pixel_format: unsafe extern "system" fn(*mut c_void, *mut [u8;16]) -> HRESULT,
    get_resolution: unsafe extern "system" fn(*mut c_void, *mut f64, *mut f64) -> HRESULT,
    copy_palette: unsafe extern "system" fn(*mut c_void, *mut c_void) -> HRESULT,
    copy_pixels: unsafe extern "system" fn(*mut c_void, *const RECT, u32, u32, *mut u8) -> HRESULT,
}

// IWICBitmapDecoder vtable: IUnknown + QueryCapability + Initialize
// + GetContainerFormat + GetDecoderInfo + CopyPalette + GetMetadataQueryReader
// + GetPreview + GetColorContexts + GetThumbnail + GetFrameCount + GetFrame.
#[repr(C)]
struct DecoderVtbl {
    unk: IUnknownVtbl,
    query_capability: unsafe extern "system" fn(*mut c_void, *mut c_void, u32, *mut u32) -> HRESULT,
    initialize: unsafe extern "system" fn(*mut c_void, *mut c_void, u32) -> HRESULT,
    get_container_format: unsafe extern "system" fn(*mut c_void, *mut [u8;16]) -> HRESULT,
    get_decoder_info: unsafe extern "system" fn(*mut c_void, *mut *mut c_void) -> HRESULT,
    copy_palette: unsafe extern "system" fn(*mut c_void, *mut c_void) -> HRESULT,
    get_metadata_query_reader: unsafe extern "system" fn(*mut c_void, *mut *mut c_void) -> HRESULT,
    get_preview: unsafe extern "system" fn(*mut c_void, *mut *mut c_void) -> HRESULT,
    get_color_contexts: unsafe extern "system" fn(*mut c_void, u32, *mut c_void, *mut u32) -> HRESULT,
    get_thumbnail: unsafe extern "system" fn(*mut c_void, *mut *mut c_void) -> HRESULT,
    get_frame_count: unsafe extern "system" fn(*mut c_void, *mut u32) -> HRESULT,
    get_frame: unsafe extern "system" fn(*mut c_void, u32, *mut *mut c_void) -> HRESULT,
}

// IWICFormatConverter vtable: IUnknown + BitmapSource methods + Initialize
// + CanConvert.
#[repr(C)]
struct ConverterVtbl {
    src: BitmapSourceVtbl,
    initialize: unsafe extern "system" fn(*mut c_void, *mut c_void, *const [u8;16], u32, *mut c_void, f64, u32) -> HRESULT,
    can_convert: unsafe extern "system" fn(*mut c_void, *const [u8;16], *mut i32) -> HRESULT,
}

// IWICImagingFactory vtable: IUnknown + CreateDecoderFromFilename (4th after
// IUnknown's 3) ... full prefix needed up to that method.
// Order: QueryInterface, AddRef, Release, CreateDecoderFromFilename,
// CreateDecoderFromStream, CreateDecoderFromFileHandle, CreateComponentInfo,
// CreateDecoder, CreateEncoder, CreatePalette, CreateFormatConverter,
// CreateBitmapScaler, CreateBitmapClipper, CreateBitmapFlipRotator,
// CreateStream, CreateColorContext, CreateColorTransformer, CreateBitmap,
// CreateBitmapFromSource, CreateBitmapFromSourceRect, CreateBitmapFromMemory,
// CreateBitmapFromSection, CreateBitmapFromSectionEx, CreatePaletteTransparent,
// CreateComponentEnumerator, CreateFastMetadataEncoderFromDecoder,
// CreateFastMetadataEncoderFromFrameDecode, CreateQueryWriter,
// CreateQueryWriterFromReader, CreateMetadataReader, CreateMetadataReaderFromContainer.
#[repr(C)]
struct FactoryVtbl {
    unk: IUnknownVtbl,
    create_decoder_from_filename: unsafe extern "system" fn(*mut c_void, *const u16, *const c_void, u32, u32, *mut *mut c_void) -> HRESULT,
    create_decoder_from_stream: unsafe extern "system" fn() -> HRESULT,
    create_decoder_from_file_handle: unsafe extern "system" fn() -> HRESULT,
    create_component_info: unsafe extern "system" fn() -> HRESULT,
    create_decoder: unsafe extern "system" fn() -> HRESULT,
    create_encoder: unsafe extern "system" fn() -> HRESULT,
    create_palette: unsafe extern "system" fn() -> HRESULT,
    create_format_converter: unsafe extern "system" fn(*mut c_void, *mut *mut c_void) -> HRESULT,
}

/// Decoded atlas: 32bpp BGRA top-down pixels.
pub struct Atlas {
    pub width: u32,
    pub height: u32,
    pub pixels: Vec<u8>,
}

unsafe fn release(p: *mut c_void) {
    if p.is_null() { return }
    let vtbl = *(p as *const *const IUnknownVtbl);
    ((*vtbl).release)(p);
}

/// Decode a spritesheet (webp/png) from `path` into BGRA32 pixels.
pub unsafe fn decode_atlas(path: &str) -> Option<Atlas> {
    let mut p = wide(path);
    let mut factory: *mut c_void = null_mut();
    let hr = CoCreateInstance(
        &CLSID_WIC_FACTORY, null_mut(), 2, &IID_FACTORY, &mut factory);
    if hr != S_OK || factory.is_null() { return None }
    let ftbl = *(factory as *const *const FactoryVtbl);

    let mut decoder: *mut c_void = null_mut();
    let hr = ((*ftbl).create_decoder_from_filename)(
        factory, p.as_ptr(), null_mut(), GENERIC_READ,
        WIC_DECODE_CACHE_ONLOAD, &mut decoder);
    if hr != S_OK || decoder.is_null() { release(factory); return None }
    let dtbl = *(decoder as *const *const DecoderVtbl);

    let mut frame: *mut c_void = null_mut();
    let hr = ((*dtbl).get_frame)(decoder, 0, &mut frame);
    if hr != S_OK || frame.is_null() {
        release(decoder); release(factory); return None
    }
    let frame_src = frame as *mut c_void;
    let stbl = *(frame_src as *const *const BitmapSourceVtbl);

    // Check pixel format; convert to PBGRA32 if needed.
    let mut pf = [0u8;16];
    ((*stbl).get_pixel_format)(frame_src, &mut pf);

    let mut source = frame_src;
    let mut conv: *mut c_void = null_mut();
    if pf != GUID_PBGRA32 {
        let hr = ((*ftbl).create_format_converter)(factory, &mut conv);
        if hr != S_OK || conv.is_null() {
            release(frame); release(decoder); release(factory); return None
        }
        let ctbl = *(conv as *const *const ConverterVtbl);
        // Initialize is the first method after the IWICBitmapSource vtable.
        let hr = ((*ctbl).initialize)(conv, frame_src, &GUID_PBGRA32,
            WIC_DITHER_NONE, null_mut(), 0.0, WIC_PALETTE_CUSTOM);
        if hr != S_OK {
            release(conv); release(frame); release(decoder); release(factory); return None
        }
        source = conv;
    }

    let stbl2 = *(source as *const *const BitmapSourceVtbl);
    let (mut w, mut h) = (0u32, 0u32);
    ((*stbl2).get_size)(source, &mut w, &mut h);
    let stride = w * 4;
    let mut pixels = vec![0u8; (stride * h) as usize];
    let hr = ((*stbl2).copy_pixels)(source, std::ptr::null(), stride, stride * h, pixels.as_mut_ptr());
    if hr != S_OK { pixels.clear() }

    if !conv.is_null() { release(conv) }
    release(frame); release(decoder); release(factory);
    if pixels.is_empty() { None } else { Some(Atlas { width: w, height: h, pixels }) }
}

