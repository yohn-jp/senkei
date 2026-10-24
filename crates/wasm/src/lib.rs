//! JSON adapters shared by the native conformance runner and raw WASM ABI.

mod dispatch;

pub use dispatch::dispatch_json;

/// Accept UTF-8 bytes at the FFI boundary and dispatch them through the same
/// function used by the native runner.
pub fn dispatch_bytes(request: &[u8]) -> String {
    match std::str::from_utf8(request) {
        Ok(request) => dispatch_json(request),
        Err(_) => dispatch::invalid_utf8_response(),
    }
}

/// Allocate a boxed byte slice for the JavaScript host to fill with one JSON
/// request. The matching `senkei_dealloc` export releases it after dispatch.
#[cfg(target_arch = "wasm32")]
#[no_mangle]
pub extern "C" fn senkei_alloc(length: usize) -> *mut u8 {
    if length == 0 {
        return std::ptr::null_mut();
    }
    Box::into_raw(vec![0_u8; length].into_boxed_slice()) as *mut u8
}

/// Release a buffer allocated by `senkei_alloc` or returned by
/// `senkei_dispatch`.
#[cfg(target_arch = "wasm32")]
#[no_mangle]
pub unsafe extern "C" fn senkei_dealloc(pointer: *mut u8, length: usize) {
    if pointer.is_null() || length == 0 {
        return;
    }
    let slice = std::ptr::slice_from_raw_parts_mut(pointer, length);
    // SAFETY: callers must pass the pointer and length returned by this
    // module's allocation functions exactly once.
    unsafe {
        drop(Box::from_raw(slice));
    }
}

/// Dispatch a JSON request and return an owned response buffer packed as
/// `(response_length << 32) | response_pointer`. The request pointer remains
/// owned by the caller and is not retained.
#[cfg(target_arch = "wasm32")]
#[no_mangle]
pub unsafe extern "C" fn senkei_dispatch(pointer: *const u8, length: usize) -> u64 {
    let request = if length == 0 {
        &[][..]
    } else if pointer.is_null() {
        return pack_response(dispatch::invalid_utf8_response().into_bytes());
    } else {
        // SAFETY: the JavaScript host calls this function with the live buffer
        // returned by `senkei_alloc` and its matching length.
        unsafe { std::slice::from_raw_parts(pointer, length) }
    };
    pack_response(dispatch_bytes(request).into_bytes())
}

#[cfg(target_arch = "wasm32")]
fn pack_response(response: Vec<u8>) -> u64 {
    let output = response.into_boxed_slice();
    let length = output.len();
    let pointer = Box::into_raw(output) as *mut u8;
    ((length as u64) << 32) | (pointer as u32 as u64)
}
