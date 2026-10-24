//! Jinrei's text compiler and dedicated, deterministic tactical VM.
//!
//! Text and visual tactics are lowered through the same versioned model AST.
//! The bytecode is a bounded, versioned JSON encoding of Jinrei opcodes with a
//! fixed magic/version prefix; it is never passed to a host language runtime.

mod bytecode;
mod compiler;
mod error;
mod formatter;
mod lexer;
mod parser;
mod types;
mod vm;

pub use compiler::{compile, compile_ast, compile_ast_with_options, compile_with_options, CompileOptions};
pub use error::{compile_error, CompileError};
pub use formatter::{format, parse};
pub use vm::{verify_program_digest, Vm, VmOptions};

pub const LANGUAGE_VERSION: senkei_model::Version = senkei_model::Version::new(1, 0, 0);
pub const AST_SCHEMA_VERSION: senkei_model::Version = senkei_model::AST_SCHEMA_VERSION;
pub const STRUCTURED_AST_VERSION: senkei_model::Version = AST_SCHEMA_VERSION;
pub const TYPED_IR_VERSION: senkei_model::Version = senkei_model::Version::new(1, 0, 0);
pub const BYTECODE_VERSION: senkei_model::Version = senkei_model::Version::new(1, 0, 0);

const MAX_SOURCE_BYTES: usize = 1_000_000;
const MAX_BYTECODE_BYTES: usize = 4_000_000;
const MAX_TOKENS: usize = 100_000;
const MAX_AST_DEPTH: usize = 24;
const MAX_STATE_REF_DEPTH: usize = 64;
const MAX_RUNTIME_COLLECTION_ITEMS: usize = 100_000;
