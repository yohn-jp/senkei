use std::io::{self, Read};

fn main() {
    let mut request = String::new();
    io::stdin()
        .read_to_string(&mut request)
        .expect("read compile request");
    match senkei_editor_adapter::compile_next_json(&request) {
        Ok(response) => print!("{response}"),
        Err(error) => {
            eprintln!("{error}");
            std::process::exit(2);
        }
    }
}
