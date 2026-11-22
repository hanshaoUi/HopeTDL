#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
fn main() {
    #[cfg(feature = "desktop")]
    hopetdl_lib::desktop::run();
}
