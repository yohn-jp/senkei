use senkei_runner::{decode_input, run, MAX_INPUT_BYTES};
use std::env;
use std::fs::File;
use std::io::{self, Read, Write};
use std::process::ExitCode;

fn main() -> ExitCode {
    match execute() {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("senkei-runner: {error}");
            ExitCode::FAILURE
        }
    }
}

fn execute() -> Result<(), Box<dyn std::error::Error>> {
    let mut args = env::args().skip(1);
    let Some(command) = args.next() else {
        print_usage();
        return Err("missing command".into());
    };
    if command == "--help" || command == "help" {
        print_usage();
        return Ok(());
    }
    if command != "run" {
        print_usage();
        return Err(format!("unknown command `{command}`").into());
    }

    let input_path = args.next().ok_or("run requires an input path or `-`")?;
    let mut public_only = false;
    for arg in args {
        if arg == "--public-only" {
            public_only = true;
        } else {
            return Err(format!("unknown run option `{arg}`").into());
        }
    }

    let mut input_bytes = Vec::new();
    if input_path == "-" {
        io::stdin()
            .take(MAX_INPUT_BYTES as u64 + 1)
            .read_to_end(&mut input_bytes)?;
    } else {
        File::open(input_path)?
            .take(MAX_INPUT_BYTES as u64 + 1)
            .read_to_end(&mut input_bytes)?;
    }
    let input = decode_input(&input_bytes)?;
    let output = run(input)?;
    let json = if public_only {
        output.to_public_json()?
    } else {
        output.to_local_json()?
    };
    let mut stdout = io::BufWriter::new(io::stdout().lock());
    stdout.write_all(json.as_bytes())?;
    stdout.write_all(b"\n")?;
    stdout.flush()?;
    Ok(())
}

fn print_usage() {
    eprintln!(
        "Usage: senkei-runner run <input.json|-> [--public-only]\n\
         Reads one immutable local match input and emits JSON. Without --public-only,\n\
         the output includes restricted local diagnostics and compilation CU summaries."
    );
}
