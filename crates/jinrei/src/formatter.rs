use crate::{error::CompileError, parser, AST_SCHEMA_VERSION, MAX_AST_DEPTH, MAX_SOURCE_BYTES};
use senkei_model::{
    ApiError, ApiErrorCode, ComparisonOperator, DomainValue, KnownnessTest,
    StructuredTacticsAst, TacticalCollection, TacticalDeclaration,
    TacticalPath, TacticalPredicate, TacticalValue,
};

const RESERVED: &[&str] = &[
    "senkei", "state", "action", "when", "do", "and", "or", "not", "ordered",
    "any", "all", "count", "filter", "sum", "min", "max", "argmin", "argmax",
    "in", "by", "then", "is", "known", "unknown", "true", "false",
];

/// Parse Jinrei v0.1 text into the same structured AST accepted by the compiler.
pub fn parse(source: &str) -> Result<StructuredTacticsAst, ApiError> {
    parser::parse(source).map_err(CompileError::into_api)
}

/// Render a valid structured AST as canonical Jinrei v0.1 text.
///
/// Comments, whitespace, and optional trailing commas are normalized. All
/// semantic structure is retained, including explicit ordered logic.
pub fn format(ast: &StructuredTacticsAst) -> Result<String, ApiError> {
    validate_ast(ast).map_err(CompileError::into_api)?;
    let mut out = format!("senkei {} {{\n", ast.program_name);
    for (i, declaration) in ast.declarations.iter().enumerate() {
        match declaration {
            TacticalDeclaration::State { name, predicates } => {
                out.push_str(&format!("    state {name} {{\n"));
                for (j, predicate) in predicates.iter().enumerate() {
                    out.push_str("        "); out.push_str(&predicate_text(predicate));
                    if j + 1 < predicates.len() { out.push(','); }
                    out.push('\n');
                }
                out.push_str("    }");
            }
            TacticalDeclaration::Action { name, when, do_call } => {
                out.push_str(&format!("    action {name} {{\n        when {},\n        do {}(", predicate_text(when), path_text(&do_call.capability)));
                for (j, arg) in do_call.arguments.iter().enumerate() {
                    if j > 0 { out.push_str(", "); }
                    out.push_str(&value_text(arg));
                }
                out.push_str("),\n    }");
            }
        }
        if i + 1 < ast.declarations.len() { out.push(','); }
        out.push('\n');
    }
    out.push('}');
    if out.len() > MAX_SOURCE_BYTES { return Err(ApiError::new(ApiErrorCode::ResourceLimit, "formatted source exceeds the host input limit")); }
    Ok(out)
}

pub(crate) fn validate_ast(ast: &StructuredTacticsAst) -> Result<(), CompileError> {
    if ast.schema_version != AST_SCHEMA_VERSION {
        return Err(CompileError::new(ApiErrorCode::IncompatibleVersion, "unsupported StructuredTacticsAst schema version"));
    }
    validate_ast_shape(ast)?;
    let check_name = |name: &str| -> Result<(), CompileError> {
        if !is_identifier(name) || RESERVED.contains(&name) { Err(CompileError::new(ApiErrorCode::ValidationFailed, format!("invalid or reserved identifier '{name}'"))) } else { Ok(()) }
    };
    check_name(&ast.program_name)?;
    if ast.declarations.is_empty() { return Err(CompileError::new(ApiErrorCode::ValidationFailed, "a program must declare at least one state or action")); }
    let mut names = std::collections::BTreeSet::new();
    for declaration in &ast.declarations {
        match declaration {
            TacticalDeclaration::State { name, predicates } => {
                check_name(name)?;
                if !names.insert(name) { return Err(CompileError::new(ApiErrorCode::ValidationFailed, format!("duplicate declaration '{name}'"))); }
                if predicates.is_empty() { return Err(CompileError::new(ApiErrorCode::ValidationFailed, "state conditions cannot be empty")); }
                for p in predicates { validate_predicate(p, 0)?; }
            }
            TacticalDeclaration::Action { name, when, do_call } => {
                check_name(name)?;
                if !names.insert(name) { return Err(CompileError::new(ApiErrorCode::ValidationFailed, format!("duplicate declaration '{name}'"))); }
                validate_predicate(when, 0)?;
                validate_path(&do_call.capability)?;
                for value in &do_call.arguments { validate_value(value, 0)?; }
            }
        }
    }
    Ok(())
}

fn is_identifier(value: &str) -> bool {
    let mut bytes = value.bytes();
    matches!(bytes.next(), Some(b'A'..=b'Z' | b'a'..=b'z' | b'_'))
        && bytes.all(|b| b.is_ascii_alphanumeric() || b == b'_')
}
fn validate_path(path: &TacticalPath) -> Result<(), CompileError> {
    if path.0.is_empty() { return Err(CompileError::new(ApiErrorCode::ValidationFailed, "path cannot be empty")); }
    if path.0.len() > MAX_AST_DEPTH { return Err(CompileError::new(ApiErrorCode::ResourceLimit, "path exceeds the host component limit")); }
    for part in &path.0 { if !is_identifier(part) || RESERVED.contains(&part.as_str()) { return Err(CompileError::new(ApiErrorCode::ValidationFailed, format!("invalid or reserved path component '{part}'"))); } }
    Ok(())
}

fn validate_ast_shape(ast: &StructuredTacticsAst) -> Result<(), CompileError> {
    if ast.declarations.len() > 100_000 { return Err(CompileError::new(ApiErrorCode::ResourceLimit, "structured AST contains too many declarations")); }
    let mut nodes = 0usize;
    let mut bytes = ast.program_name.len();
    let mut stack = Vec::new();
    for declaration in &ast.declarations {
        match declaration {
            TacticalDeclaration::State { name, predicates } => {
                bytes = bytes.saturating_add(name.len());
                for predicate in predicates { stack.push(ShapeNode::Predicate(predicate, 1)); }
            }
            TacticalDeclaration::Action { name, when, do_call } => {
                bytes = bytes.saturating_add(name.len());
                stack.push(ShapeNode::Predicate(when, 1));
                stack.push(ShapeNode::Path(&do_call.capability, 1));
                for argument in &do_call.arguments { stack.push(ShapeNode::Value(argument, 1)); }
            }
        }
    }
    while let Some(node) = stack.pop() {
        nodes += 1;
        if nodes > 100_000 { return Err(CompileError::new(ApiErrorCode::ResourceLimit, "structured AST contains too many nodes")); }
        if node.depth() > MAX_AST_DEPTH { return Err(CompileError::new(ApiErrorCode::ResourceLimit, "structured AST exceeds the host depth limit")); }
        match node {
            ShapeNode::Predicate(p, depth) => match p {
                TacticalPredicate::LiteralTruth(_) | TacticalPredicate::StateReference(_) => {},
                TacticalPredicate::Compare { left, right, .. } => { stack.push(ShapeNode::Value(left, depth+1)); stack.push(ShapeNode::Value(right, depth+1)); },
                TacticalPredicate::Knownness { value, .. } => stack.push(ShapeNode::Value(value, depth+1)),
                TacticalPredicate::And(v) | TacticalPredicate::Or(v) | TacticalPredicate::OrderedAnd(v) | TacticalPredicate::OrderedOr(v) => for child in v { stack.push(ShapeNode::Predicate(child, depth+1)); },
                TacticalPredicate::Not(child) => stack.push(ShapeNode::Predicate(child, depth+1)),
                TacticalPredicate::Quantified { binding, collection, predicates, .. } => {
                    bytes = bytes.saturating_add(binding.len()); stack.push(ShapeNode::Collection(collection, depth+1));
                    for child in predicates { stack.push(ShapeNode::Predicate(child, depth+1)); }
                }
            },
            ShapeNode::Value(v, depth) => match v {
                TacticalValue::Literal(DomainValue::String(s)) => bytes = bytes.saturating_add(s.len().saturating_mul(6)),
                TacticalValue::Literal(DomainValue::Enum(s)) => bytes = bytes.saturating_add(s.as_str().len()),
                TacticalValue::Literal(_) => {},
                TacticalValue::Path(path) => stack.push(ShapeNode::Path(path, depth+1)),
                TacticalValue::FilteredCollection { binding, collection, predicates } => {
                    bytes = bytes.saturating_add(binding.len()); stack.push(ShapeNode::Collection(collection, depth+1));
                    for child in predicates { stack.push(ShapeNode::Predicate(child, depth+1)); }
                }
                TacticalValue::Count { binding, collection, predicates } => {
                    bytes = bytes.saturating_add(binding.len()); stack.push(ShapeNode::Collection(collection, depth+1));
                    for child in predicates { stack.push(ShapeNode::Predicate(child, depth+1)); }
                }
                TacticalValue::Sum { binding, collection, expression } | TacticalValue::Min { binding, collection, expression } | TacticalValue::Max { binding, collection, expression } => {
                    bytes = bytes.saturating_add(binding.len()); stack.push(ShapeNode::Collection(collection, depth+1)); stack.push(ShapeNode::Value(expression, depth+1));
                }
                TacticalValue::ArgMin { binding, collection, expression, unique_key } | TacticalValue::ArgMax { binding, collection, expression, unique_key } => {
                    bytes = bytes.saturating_add(binding.len()); stack.push(ShapeNode::Collection(collection, depth+1)); stack.push(ShapeNode::Value(expression, depth+1)); stack.push(ShapeNode::Path(unique_key, depth+1));
                }
            },
            ShapeNode::Collection(collection, depth) => match collection {
                TacticalCollection::Path(path) => stack.push(ShapeNode::Path(path, depth+1)),
                TacticalCollection::Filter { binding, collection, predicates } => {
                    bytes = bytes.saturating_add(binding.len()); stack.push(ShapeNode::Collection(collection, depth+1));
                    for child in predicates { stack.push(ShapeNode::Predicate(child, depth+1)); }
                }
            },
            ShapeNode::Path(path, _) => {
                bytes = bytes.saturating_add(path.0.iter().map(String::len).sum::<usize>());
            }
        }
        if bytes > MAX_SOURCE_BYTES { return Err(CompileError::new(ApiErrorCode::ResourceLimit, "structured AST strings exceed the host input limit")); }
    }
    Ok(())
}

enum ShapeNode<'a> { Predicate(&'a TacticalPredicate, usize), Value(&'a TacticalValue, usize), Collection(&'a TacticalCollection, usize), Path(&'a TacticalPath, usize) }
impl ShapeNode<'_> { fn depth(&self) -> usize { match self { Self::Predicate(_,d)|Self::Value(_,d)|Self::Collection(_,d)|Self::Path(_,d) => *d } } }
fn validate_predicate(p: &TacticalPredicate, depth: usize) -> Result<(), CompileError> {
    if depth > MAX_AST_DEPTH { return Err(CompileError::new(ApiErrorCode::ResourceLimit, "AST depth exceeds the host limit")); }
    match p {
        TacticalPredicate::LiteralTruth(_) | TacticalPredicate::StateReference(_) => {}
        TacticalPredicate::Compare { left, right, .. } => { validate_value(left, depth + 1)?; validate_value(right, depth + 1)?; }
        TacticalPredicate::Knownness { value, .. } => validate_value(value, depth + 1)?,
        TacticalPredicate::And(children) | TacticalPredicate::Or(children) | TacticalPredicate::OrderedAnd(children) | TacticalPredicate::OrderedOr(children) => {
            if children.is_empty() { return Err(CompileError::new(ApiErrorCode::ValidationFailed, "predicate blocks cannot be empty")); }
            for child in children { validate_predicate(child, depth + 1)?; }
        }
        TacticalPredicate::Not(child) => validate_predicate(child, depth + 1)?,
        TacticalPredicate::Quantified { binding, collection, predicates, .. } => {
            validate_binding(binding)?; validate_collection(collection, depth + 1)?;
            if predicates.is_empty() { return Err(CompileError::new(ApiErrorCode::ValidationFailed, "predicate blocks cannot be empty")); }
            for p in predicates { validate_predicate(p, depth + 1)?; }
        }
    }
    Ok(())
}
fn validate_value(v: &TacticalValue, depth: usize) -> Result<(), CompileError> {
    if depth > MAX_AST_DEPTH { return Err(CompileError::new(ApiErrorCode::ResourceLimit, "AST depth exceeds the host limit")); }
    match v {
        TacticalValue::Literal(value) => match value {
            DomainValue::Null | DomainValue::Entity(_) | DomainValue::List(_) | DomainValue::Record(_) => return Err(CompileError::new(ApiErrorCode::ValidationFailed, "value is not a Jinrei v0.1 literal")),
            DomainValue::Fixed { scale: 0, .. } => return Err(CompileError::new(ApiErrorCode::ValidationFailed, "fixed-point scale zero cannot be represented as a Jinrei v0.1 literal")),
            DomainValue::Enum(symbol) if !is_identifier(symbol.as_str()) || RESERVED.contains(&symbol.as_str()) => return Err(CompileError::new(ApiErrorCode::ValidationFailed, "enum symbol cannot be represented as a Jinrei v0.1 identifier")),
            _ => {}
        },
        TacticalValue::Path(path) => validate_path(path)?,
        TacticalValue::FilteredCollection { binding, collection, predicates } => {
            validate_binding(binding)?; validate_collection(collection, depth + 1)?;
            if predicates.is_empty() { return Err(CompileError::new(ApiErrorCode::ValidationFailed, "filter predicates cannot be empty")); }
            for p in predicates { validate_predicate(p, depth + 1)?; }
        }
        TacticalValue::Count { binding, collection, predicates } => {
            validate_binding(binding)?; validate_collection(collection, depth + 1)?;
            if predicates.is_empty() { return Err(CompileError::new(ApiErrorCode::ValidationFailed, "predicate blocks cannot be empty")); }
            for p in predicates { validate_predicate(p, depth + 1)?; }
        }
        TacticalValue::Sum { binding, collection, expression } | TacticalValue::Min { binding, collection, expression } | TacticalValue::Max { binding, collection, expression } => {
            validate_binding(binding)?; validate_collection(collection, depth + 1)?; validate_value(expression, depth + 1)?;
        }
        TacticalValue::ArgMin { binding, collection, expression, unique_key } | TacticalValue::ArgMax { binding, collection, expression, unique_key } => {
            validate_binding(binding)?; validate_collection(collection, depth + 1)?; validate_value(expression, depth + 1)?; validate_path(unique_key)?;
        }
    }
    Ok(())
}
fn validate_collection(c: &TacticalCollection, depth: usize) -> Result<(), CompileError> {
    if depth > MAX_AST_DEPTH { return Err(CompileError::new(ApiErrorCode::ResourceLimit, "AST depth exceeds the host limit")); }
    match c {
        TacticalCollection::Path(path) => validate_path(path)?,
        TacticalCollection::Filter { binding, collection, predicates } => {
            validate_binding(binding)?; validate_collection(collection, depth + 1)?;
            if predicates.is_empty() { return Err(CompileError::new(ApiErrorCode::ValidationFailed, "filter predicates cannot be empty")); }
            for p in predicates { validate_predicate(p, depth + 1)?; }
        }
    }
    Ok(())
}
fn validate_binding(name: &str) -> Result<(), CompileError> {
    if !is_identifier(name) || RESERVED.contains(&name) { Err(CompileError::new(ApiErrorCode::ValidationFailed, format!("invalid or reserved binding '{name}'"))) } else { Ok(()) }
}

fn path_text(path: &TacticalPath) -> String { path.0.join(".") }
fn predicate_text(p: &TacticalPredicate) -> String {
    match p {
        TacticalPredicate::LiteralTruth(true) => "true".into(),
        TacticalPredicate::LiteralTruth(false) => "false".into(),
        TacticalPredicate::StateReference(name) => name.clone(),
        TacticalPredicate::Compare { left, operator, right } => format!("{} {} {}", value_text(left), comparison_text(*operator), value_text(right)),
        TacticalPredicate::Knownness { value, test } => format!("{} is {}", value_text(value), match test { KnownnessTest::Known => "known", KnownnessTest::Unknown => "unknown" }),
        TacticalPredicate::And(children) => block("and", children.iter().map(predicate_text)),
        TacticalPredicate::Or(children) => block("or", children.iter().map(predicate_text)),
        TacticalPredicate::OrderedAnd(children) => block("ordered and", children.iter().map(predicate_text)),
        TacticalPredicate::OrderedOr(children) => block("ordered or", children.iter().map(predicate_text)),
        TacticalPredicate::Not(child) => format!("not {{ {} }}", predicate_text(child)),
        TacticalPredicate::Quantified { quantifier, binding, collection, predicates } => {
            let word = match quantifier { senkei_model::Quantifier::Any => "any", senkei_model::Quantifier::All => "all" };
            format!("{word} {binding} in {} {}", collection_text(collection), block("", predicates.iter().map(predicate_text)))
        }
    }
}
fn block<'a>(head: &str, entries: impl Iterator<Item = String>) -> String {
    let joined = entries.collect::<Vec<_>>().join(", ");
    if head.is_empty() { format!("{{ {joined} }}") } else { format!("{head} {{ {joined} }}") }
}
fn collection_text(c: &TacticalCollection) -> String {
    match c {
        TacticalCollection::Path(path) => path_text(path),
        TacticalCollection::Filter { binding, collection, predicates } => format!("filter {binding} in {} {}", collection_text(collection), block("", predicates.iter().map(predicate_text))),
    }
}
fn value_text(v: &TacticalValue) -> String {
    match v {
        TacticalValue::Literal(value) => literal_text(value),
        TacticalValue::Path(path) => path_text(path),
        TacticalValue::FilteredCollection { binding, collection, predicates } => format!("filter {binding} in {} {}", collection_text(collection), block("", predicates.iter().map(predicate_text))),
        TacticalValue::Count { binding, collection, predicates } => format!("count {binding} in {} {}", collection_text(collection), block("", predicates.iter().map(predicate_text))),
        TacticalValue::Sum { binding, collection, expression } => format!("sum {binding} in {} by {}", collection_text(collection), value_text(expression)),
        TacticalValue::Min { binding, collection, expression } => format!("min {binding} in {} by {}", collection_text(collection), value_text(expression)),
        TacticalValue::Max { binding, collection, expression } => format!("max {binding} in {} by {}", collection_text(collection), value_text(expression)),
        TacticalValue::ArgMin { binding, collection, expression, unique_key } => format!("argmin {binding} in {} by {} then {}", collection_text(collection), value_text(expression), path_text(unique_key)),
        TacticalValue::ArgMax { binding, collection, expression, unique_key } => format!("argmax {binding} in {} by {} then {}", collection_text(collection), value_text(expression), path_text(unique_key)),
    }
}
fn literal_text(value: &DomainValue) -> String {
    match value {
        DomainValue::Bool(v) => v.to_string(),
        DomainValue::Integer(v) => v.to_string(),
        DomainValue::Fixed { coefficient, scale } => {
            let negative = *coefficient < 0;
            let digits = coefficient.unsigned_abs().to_string();
            let scale = *scale as usize;
            let mut number = if scale == 0 { digits } else if digits.len() <= scale { format!("0.{}{}", "0".repeat(scale.saturating_sub(digits.len())), digits) }
                else { format!("{}.{}", &digits[..digits.len() - scale], &digits[digits.len() - scale..]) };
            if negative { number.insert(0, '-'); }
            number
        }
        DomainValue::String(value) => {
            let mut out = String::from("\"");
            for ch in value.chars() { match ch { '"' => out.push_str("\\\""), '\\' => out.push_str("\\\\"), '\n' => out.push_str("\\n"), '\r' => out.push_str("\\r"), '\t' => out.push_str("\\t"), other => out.push(other) } }
            out.push('"'); out
        }
        DomainValue::Enum(symbol) => symbol.as_str().to_owned(),
        _ => String::new(),
    }
}
fn comparison_text(operator: ComparisonOperator) -> &'static str {
    match operator {
        ComparisonOperator::Equal => "==", ComparisonOperator::NotEqual => "!=",
        ComparisonOperator::LessThan => "<", ComparisonOperator::LessThanOrEqual => "<=",
        ComparisonOperator::GreaterThan => ">", ComparisonOperator::GreaterThanOrEqual => ">=",
    }
}

#[cfg(test)]
mod tests {
    use super::{format, parse};

    #[test]
    fn parser_formatter_preserves_v01_ast() {
        let source = r#"
            senkei control {
                state threat {
                    enemy.position is unknown,
                    ordered or {
                        any target in filter unit in enemies.visible {
                            unit.health > 0,
                            target.lane == top,
                        } {
                            target.health > 3,
                        },
                        count unit in allies.units { unit.health > 2, } >= 2,
                    },
                    not { false, },
                },
                action choose {
                    when threat,
                    do attack_unit(argmax unit in enemies.visible by unit.health then unit.id, 1),
                },
            }
        "#;
        let ast = parse(source).expect("valid Jinrei source");
        let canonical = format(&ast).expect("AST can be formatted");
        let reparsed = parse(&canonical).expect("canonical source parses");
        assert_eq!(ast, reparsed);
    }

    #[test]
    fn parser_rejects_assignment_and_missing_commas() {
        assert!(parse("senkei x { state a { x = true, }, }").is_err());
        assert!(parse("senkei x { state a { true false, }, }").is_err());
        assert!(parse("senkei x { action a { when true do hit(), }, }").is_err());
    }

    #[test]
    fn fixed_literals_keep_scale_and_value_when_formatted() {
        for literal in ["0.01", "0.1", "1.20", "-12.34"] {
            let source = format!("senkei x {{ action a {{ when amount == {literal}, do hit(), }}, }}");
            let ast = parse(&source).expect("fixed literal parses");
            let canonical = format(&ast).expect("fixed AST formats");
            assert_eq!(ast, parse(&canonical).expect("formatted fixed literal parses"));
        }
    }
}
