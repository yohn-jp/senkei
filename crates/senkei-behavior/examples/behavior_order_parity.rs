//! Test-only fixture harness; no production operation or game policy.
#[allow(dead_code, unused_imports)]
#[path = "../tests/runtime.rs"]
mod fixture;

fn fixture_bytes() -> Vec<u8> {
    serde_json::to_vec(&fixture::authored_order_parity_fixture()).unwrap()
}

fn main() {
    #[cfg(not(target_arch = "wasm32"))]
    println!("{}", String::from_utf8(fixture_bytes()).unwrap());
}

#[cfg(target_arch = "wasm32")]
#[no_mangle]
pub extern "C" fn behavior_order_fixture() -> u64 {
    let bytes = fixture_bytes().into_boxed_slice();
    let length = bytes.len();
    let pointer = Box::into_raw(bytes) as *mut u8;
    ((length as u64) << 32) | pointer as u32 as u64
}

#[cfg(target_arch = "wasm32")]
#[no_mangle]
pub unsafe extern "C" fn behavior_order_release(pointer: *mut u8, length: usize) {
    let slice = std::ptr::slice_from_raw_parts_mut(pointer, length);
    // SAFETY: this test harness host passes the exact live allocation once.
    unsafe { drop(Box::from_raw(slice)); }
}
