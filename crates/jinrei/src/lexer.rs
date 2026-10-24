use crate::{CompileError, MAX_TOKENS};
use senkei_model::ApiErrorCode;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum TokenKind {
    Ident(String),
    Integer(i64),
    Fixed { coefficient: i64, scale: u8 },
    String(String),
    LBrace,
    RBrace,
    LParen,
    RParen,
    Comma,
    Dot,
    Eq,
    Ne,
    Lt,
    Le,
    Gt,
    Ge,
    Eof,
}

#[derive(Clone, Debug)]
pub(crate) struct Token {
    pub kind: TokenKind,
    pub offset: usize,
}

pub(crate) fn lex(source: &str) -> Result<Vec<Token>, CompileError> {
    let mut tokens = Vec::new();
    let bytes = source.as_bytes();
    let mut pos = 0usize;
    while pos < bytes.len() {
        let byte = bytes[pos];
        let current = source[pos..].chars().next().ok_or_else(|| lex_error(pos, "invalid UTF-8 source"))?;
        if current.is_whitespace() {
            pos += current.len_utf8();
            continue;
        }
        if byte == b'/' && bytes.get(pos + 1) == Some(&b'/') {
            pos += 2;
            while pos < bytes.len() && bytes[pos] != b'\n' { pos += 1; }
            continue;
        }
        let start = pos;
        let kind = match byte {
            b'{' => { pos += 1; TokenKind::LBrace }
            b'}' => { pos += 1; TokenKind::RBrace }
            b'(' => { pos += 1; TokenKind::LParen }
            b')' => { pos += 1; TokenKind::RParen }
            b',' => { pos += 1; TokenKind::Comma }
            b'.' => { pos += 1; TokenKind::Dot }
            b'=' if bytes.get(pos + 1) == Some(&b'=') => { pos += 2; TokenKind::Eq }
            b'!' if bytes.get(pos + 1) == Some(&b'=') => { pos += 2; TokenKind::Ne }
            b'<' if bytes.get(pos + 1) == Some(&b'=') => { pos += 2; TokenKind::Le }
            b'>' if bytes.get(pos + 1) == Some(&b'=') => { pos += 2; TokenKind::Ge }
            b'<' => { pos += 1; TokenKind::Lt }
            b'>' => { pos += 1; TokenKind::Gt }
            b'=' | b'!' => return Err(lex_error(start, "assignment and unary operators are not part of Jinrei v0.1")),
            b'"' => {
                pos += 1;
                let mut value = String::new();
                let mut closed = false;
                while pos < bytes.len() {
                    match bytes[pos] {
                        b'"' => { pos += 1; closed = true; break; }
                        b'\\' => {
                            pos += 1;
                            let escaped = *bytes.get(pos).ok_or_else(|| lex_error(start, "unterminated string escape"))?;
                            pos += 1;
                            value.push(match escaped {
                                b'"' => '"', b'\\' => '\\', b'n' => '\n', b'r' => '\r', b't' => '\t',
                                _ => return Err(lex_error(pos - 1, "unsupported string escape")),
                            });
                        }
                        _ => {
                            let ch = source[pos..].chars().next().ok_or_else(|| lex_error(pos, "invalid UTF-8 source"))?;
                            value.push(ch);
                            pos += ch.len_utf8();
                        }
                    }
                }
                if !closed { return Err(lex_error(start, "unterminated string literal")); }
                TokenKind::String(value)
            }
            b'-' | b'0'..=b'9' => {
                let negative = byte == b'-';
                if negative {
                    if !bytes.get(pos + 1).is_some_and(u8::is_ascii_digit) {
                        return Err(lex_error(start, "expected a digit after '-'"));
                    }
                    pos += 1;
                }
                while pos < bytes.len() && bytes[pos].is_ascii_digit() { pos += 1; }
                if bytes.get(pos) == Some(&b'.') {
                    if !bytes.get(pos + 1).is_some_and(u8::is_ascii_digit) {
                        return Err(lex_error(pos, "a fixed-point literal needs digits after the decimal point"));
                    }
                    pos += 1;
                    let fraction_start = pos;
                    while pos < bytes.len() && bytes[pos].is_ascii_digit() { pos += 1; }
                    let scale = pos - fraction_start;
                    if scale > u8::MAX as usize { return Err(lex_error(start, "fixed-point scale is too large")); }
                    let text = &source[start..pos];
                    let sign = if negative { -1i128 } else { 1i128 };
                    let unsigned = text.trim_start_matches('-').replace('.', "");
                    let coefficient = unsigned.parse::<i128>().ok().and_then(|x| x.checked_mul(sign))
                        .and_then(|x| i64::try_from(x).ok())
                        .ok_or_else(|| lex_error(start, "fixed-point literal is out of range"))?;
                    TokenKind::Fixed { coefficient, scale: scale as u8 }
                } else {
                    let value = source[start..pos].parse::<i64>().map_err(|_| lex_error(start, "integer literal is out of range"))?;
                    TokenKind::Integer(value)
                }
            }
            b'A'..=b'Z' | b'a'..=b'z' | b'_' => {
                pos += 1;
                while pos < bytes.len() && (bytes[pos].is_ascii_alphanumeric() || bytes[pos] == b'_') { pos += 1; }
                TokenKind::Ident(source[start..pos].to_owned())
            }
            _ => {
                let ch = source[pos..].chars().next().unwrap_or('\u{fffd}');
                return Err(lex_error(start, format!("unexpected character {ch:?}")));
            }
        };
        tokens.push(Token { kind, offset: start });
        if tokens.len() > MAX_TOKENS { return Err(CompileError::new(ApiErrorCode::ResourceLimit, "source contains too many tokens")); }
    }
    tokens.push(Token { kind: TokenKind::Eof, offset: source.len() });
    Ok(tokens)
}

fn lex_error(offset: usize, message: impl Into<String>) -> CompileError {
    CompileError::new(ApiErrorCode::CompileFailed, message).at(format!("source@{offset}"))
}
