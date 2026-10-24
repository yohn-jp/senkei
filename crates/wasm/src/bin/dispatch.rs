use std::io::{self, BufRead, Write};

fn main() -> io::Result<()> {
    let stdin = io::stdin();
    let stdout = io::stdout();
    let mut input = String::new();
    let mut reader = stdin.lock();
    let mut writer = io::BufWriter::new(stdout.lock());

    loop {
        input.clear();
        if reader.read_line(&mut input)? == 0 {
            break;
        }
        while input.ends_with('\n') || input.ends_with('\r') {
            input.pop();
        }
        let response = senkei_wasm::dispatch_json(&input);
        writer.write_all(response.as_bytes())?;
        writer.write_all(b"\n")?;
        writer.flush()?;
    }

    Ok(())
}
