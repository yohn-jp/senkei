use crate::lexer::{lex, Token, TokenKind};
use crate::{CompileError, MAX_AST_DEPTH, MAX_SOURCE_BYTES, STRUCTURED_AST_VERSION};
use senkei_model::{
    ApiErrorCode, ComparisonOperator, DomainValue, KnownnessTest, StructuredTacticsAst,
    TacticalCapabilityCall, TacticalCollection, TacticalDeclaration, TacticalPath,
    TacticalPredicate, TacticalValue, Quantifier,
};

const RESERVED: &[&str] = &[
    "senkei", "state", "action", "when", "do", "and", "or", "not", "ordered",
    "any", "all", "count", "filter", "sum", "min", "max", "argmin", "argmax",
    "in", "by", "then", "is", "known", "unknown", "true", "false",
];

pub(crate) fn parse(source: &str) -> Result<StructuredTacticsAst, CompileError> {
    if source.len() > MAX_SOURCE_BYTES {
        return Err(CompileError::new(ApiErrorCode::ResourceLimit, "source exceeds the configured host input limit"));
    }
    let tokens = lex(source)?;
    let mut parser = Parser { tokens, index: 0, depth: 0 };
    parser.parse_program()
}

struct Parser { tokens: Vec<Token>, index: usize, depth: usize }

impl Parser {
    fn parse_program(&mut self) -> Result<StructuredTacticsAst, CompileError> {
        self.expect_word("senkei")?;
        let name = self.identifier()?;
        self.expect(TokenKind::LBrace, "expected '{' after program name")?;
        let declarations = self.list_until_rbrace(|parser| parser.declaration())?;
        if declarations.is_empty() { return Err(self.error("a program must declare at least one state or action")); }
        self.expect(TokenKind::RBrace, "expected '}' after declarations")?;
        if !matches!(self.peek(), TokenKind::Eof) { return Err(self.error("unexpected tokens after the program")); }
        Ok(StructuredTacticsAst { schema_version: STRUCTURED_AST_VERSION, program_name: name, declarations })
    }

    fn declaration(&mut self) -> Result<TacticalDeclaration, CompileError> {
        if self.word_is("state") {
            self.bump();
            let name = self.identifier()?;
            self.expect(TokenKind::LBrace, "expected '{' after state name")?;
            let predicates = self.list_until_rbrace(|p| p.predicate())?;
            if predicates.is_empty() { return Err(self.error("state conditions cannot be empty")); }
            self.expect(TokenKind::RBrace, "expected '}' after state conditions")?;
            Ok(TacticalDeclaration::State { name, predicates })
        } else if self.word_is("action") {
            self.bump();
            let name = self.identifier()?;
            self.expect(TokenKind::LBrace, "expected '{' after action name")?;
            self.expect_word("when")?;
            let when = self.predicate()?;
            self.expect(TokenKind::Comma, "action 'when' must be followed by a comma")?;
            self.expect_word("do")?;
            let do_call = self.capability_call()?;
            self.optional_comma();
            self.expect(TokenKind::RBrace, "expected '}' after action")?;
            Ok(TacticalDeclaration::Action { name, when, do_call })
        } else {
            Err(self.error("expected a state or action declaration"))
        }
    }

    fn list_until_rbrace<T>(&mut self, mut item: impl FnMut(&mut Self) -> Result<T, CompileError>) -> Result<Vec<T>, CompileError> {
        let mut values = Vec::new();
        if matches!(self.peek(), TokenKind::RBrace) { return Ok(values); }
        loop {
            values.push(item(self)?);
            if matches!(self.peek(), TokenKind::RBrace) { break; }
            self.expect(TokenKind::Comma, "expected ',' between list elements")?;
            if matches!(self.peek(), TokenKind::RBrace) { break; }
        }
        Ok(values)
    }

    fn predicates_block(&mut self) -> Result<Vec<TacticalPredicate>, CompileError> {
        self.expect(TokenKind::LBrace, "expected '{' before predicate block")?;
        let values = self.list_until_rbrace(|p| p.predicate())?;
        if values.is_empty() { return Err(self.error("predicate blocks cannot be empty")); }
        self.expect(TokenKind::RBrace, "expected '}' after predicate block")?;
        Ok(values)
    }

    fn predicate(&mut self) -> Result<TacticalPredicate, CompileError> {
        self.enter()?;
        let result = self.predicate_inner();
        self.depth -= 1;
        result
    }

    fn predicate_inner(&mut self) -> Result<TacticalPredicate, CompileError> {
        if self.word_is("true") { self.bump(); return Ok(TacticalPredicate::LiteralTruth(true)); }
        if self.word_is("false") { self.bump(); return Ok(TacticalPredicate::LiteralTruth(false)); }
        if self.word_is("and") {
            self.bump(); return Ok(TacticalPredicate::And(self.predicates_block()?));
        }
        if self.word_is("or") {
            self.bump(); return Ok(TacticalPredicate::Or(self.predicates_block()?));
        }
        if self.word_is("ordered") {
            self.bump();
            if self.word_is("and") { self.bump(); return Ok(TacticalPredicate::OrderedAnd(self.predicates_block()?)); }
            if self.word_is("or") { self.bump(); return Ok(TacticalPredicate::OrderedOr(self.predicates_block()?)); }
            return Err(self.error("ordered must be followed by and or or"));
        }
        if self.word_is("not") {
            self.bump();
            self.expect(TokenKind::LBrace, "expected '{' after not")?;
            let inner = self.predicate()?;
            self.optional_comma();
            if !matches!(self.peek(), TokenKind::RBrace) { return Err(self.error("not accepts exactly one predicate")); }
            self.bump();
            return Ok(TacticalPredicate::Not(Box::new(inner)));
        }
        if self.word_is("any") || self.word_is("all") {
            let quantifier = if self.word_is("any") { Quantifier::Any } else { Quantifier::All };
            self.bump();
            let binding = self.identifier()?;
            self.expect_word("in")?;
            let collection = self.collection()?;
            let predicates = self.predicates_block()?;
            return Ok(TacticalPredicate::Quantified { quantifier, binding, collection, predicates });
        }

        let left = self.value()?;
        if self.word_is("is") {
            self.bump();
            let test = if self.word_is("known") { KnownnessTest::Known }
                else if self.word_is("unknown") { KnownnessTest::Unknown }
                else { return Err(self.error("expected known or unknown after 'is'")); };
            self.bump();
            return Ok(TacticalPredicate::Knownness { value: left, test });
        }
        let operator = match self.peek() {
            TokenKind::Eq => ComparisonOperator::Equal,
            TokenKind::Ne => ComparisonOperator::NotEqual,
            TokenKind::Lt => ComparisonOperator::LessThan,
            TokenKind::Le => ComparisonOperator::LessThanOrEqual,
            TokenKind::Gt => ComparisonOperator::GreaterThan,
            TokenKind::Ge => ComparisonOperator::GreaterThanOrEqual,
            _ => {
                if let TacticalValue::Path(path) = left {
                    if path.0.len() == 1 && !RESERVED.contains(&path.0[0].as_str()) {
                        return Ok(TacticalPredicate::StateReference(path.0[0].clone()));
                    }
                }
                return Err(self.error("expected a comparison, knownness test, or state reference"));
            }
        };
        self.bump();
        let right = self.value()?;
        Ok(TacticalPredicate::Compare { left, operator, right })
    }

    fn value(&mut self) -> Result<TacticalValue, CompileError> {
        self.enter()?;
        let result = self.value_inner();
        self.depth -= 1;
        result
    }

    fn value_inner(&mut self) -> Result<TacticalValue, CompileError> {
        if let TokenKind::Integer(value) = self.peek().clone() { self.bump(); return Ok(TacticalValue::Literal(DomainValue::Integer(value))); }
        if let TokenKind::Fixed { coefficient, scale } = self.peek().clone() { self.bump(); return Ok(TacticalValue::Literal(DomainValue::Fixed { coefficient, scale })); }
        if let TokenKind::String(value) = self.peek().clone() { self.bump(); return Ok(TacticalValue::Literal(DomainValue::String(value))); }
        if self.word_is("true") { self.bump(); return Ok(TacticalValue::Literal(DomainValue::Bool(true))); }
        if self.word_is("false") { self.bump(); return Ok(TacticalValue::Literal(DomainValue::Bool(false))); }
        if self.word_is("count") {
            self.bump(); let binding = self.identifier()?; self.expect_word("in")?;
            let collection = self.collection()?; let predicates = self.predicates_block()?;
            return Ok(TacticalValue::Count { binding, collection, predicates });
        }
        if self.word_is("filter") {
            match self.collection()? {
                TacticalCollection::Filter { binding, collection, predicates } => {
                    return Ok(TacticalValue::FilteredCollection { binding, collection: *collection, predicates });
                }
                TacticalCollection::Path(_) => unreachable!("filter parser always produces a filter collection"),
            }
        }
        if self.word_is("sum") || self.word_is("min") || self.word_is("max") || self.word_is("argmin") || self.word_is("argmax") {
            let op = match self.peek() { TokenKind::Ident(w) => w.clone(), _ => unreachable!() };
            self.bump(); let binding = self.identifier()?; self.expect_word("in")?;
            let collection = self.collection()?; self.expect_word("by")?;
            let expression = Box::new(self.value()?);
            if op == "sum" { return Ok(TacticalValue::Sum { binding, collection, expression }); }
            if op == "min" { return Ok(TacticalValue::Min { binding, collection, expression }); }
            if op == "max" { return Ok(TacticalValue::Max { binding, collection, expression }); }
            self.expect_word("then")?;
            let unique_key = self.path()?;
            return Ok(if op == "argmin" {
                TacticalValue::ArgMin { binding, collection, expression, unique_key }
            } else {
                TacticalValue::ArgMax { binding, collection, expression, unique_key }
            });
        }
        if let TokenKind::Ident(word) = self.peek() {
            if RESERVED.contains(&word.as_str()) { return Err(self.error("reserved word is not a value path")); }
            return Ok(TacticalValue::Path(self.path()?));
        }
        Err(self.error("expected a literal, path, or aggregate"))
    }

    fn collection(&mut self) -> Result<TacticalCollection, CompileError> {
        self.enter()?;
        let result = self.collection_inner();
        self.depth -= 1;
        result
    }

    fn collection_inner(&mut self) -> Result<TacticalCollection, CompileError> {
        if self.word_is("filter") {
            self.bump(); let binding = self.identifier()?; self.expect_word("in")?;
            let collection = Box::new(self.collection()?);
            let predicates = self.predicates_block()?;
            Ok(TacticalCollection::Filter { binding, collection, predicates })
        } else {
            Ok(TacticalCollection::Path(self.path()?))
        }
    }

    fn capability_call(&mut self) -> Result<TacticalCapabilityCall, CompileError> {
        let capability = self.path()?;
        self.expect(TokenKind::LParen, "expected '(' after capability name")?;
        let mut arguments = Vec::new();
        if !matches!(self.peek(), TokenKind::RParen) {
            loop {
                arguments.push(self.value()?);
                if matches!(self.peek(), TokenKind::RParen) { break; }
                self.expect(TokenKind::Comma, "expected ',' between capability arguments")?;
                if matches!(self.peek(), TokenKind::RParen) { break; }
            }
        }
        self.expect(TokenKind::RParen, "expected ')' after capability arguments")?;
        Ok(TacticalCapabilityCall { capability, arguments })
    }

    fn path(&mut self) -> Result<TacticalPath, CompileError> {
        let mut parts = vec![self.identifier()?];
        while matches!(self.peek(), TokenKind::Dot) {
            if parts.len() >= MAX_AST_DEPTH { return Err(CompileError::new(ApiErrorCode::ResourceLimit, "path exceeds the host component limit")); }
            self.bump(); parts.push(self.identifier()?);
        }
        Ok(TacticalPath(parts))
    }

    fn enter(&mut self) -> Result<(), CompileError> {
        if self.depth >= MAX_AST_DEPTH { return Err(CompileError::new(ApiErrorCode::ResourceLimit, "source nesting exceeds the host parser limit")); }
        self.depth += 1;
        Ok(())
    }

    fn identifier(&mut self) -> Result<String, CompileError> {
        match self.peek().clone() {
            TokenKind::Ident(value) => {
                if RESERVED.contains(&value.as_str()) { return Err(self.error("reserved words cannot be identifiers")); }
                self.bump(); Ok(value)
            }
            _ => Err(self.error("expected an identifier")),
        }
    }

    fn expect_word(&mut self, word: &str) -> Result<(), CompileError> {
        if self.word_is(word) { self.bump(); Ok(()) } else { Err(self.error(format!("expected '{word}'"))) }
    }
    fn word_is(&self, word: &str) -> bool { matches!(&self.peek(), TokenKind::Ident(value) if value == word) }
    fn optional_comma(&mut self) { if matches!(self.peek(), TokenKind::Comma) { self.bump(); } }
    fn expect(&mut self, expected: TokenKind, message: &str) -> Result<(), CompileError> {
        if std::mem::discriminant(self.peek()) == std::mem::discriminant(&expected) { self.bump(); Ok(()) }
        else { Err(self.error(message)) }
    }
    fn peek(&self) -> &TokenKind { &self.tokens[self.index].kind }
    fn bump(&mut self) { if !matches!(self.peek(), TokenKind::Eof) { self.index += 1; } }
    fn error(&self, message: impl Into<String>) -> CompileError {
        CompileError::new(ApiErrorCode::CompileFailed, message).at(format!("source@{}", self.tokens[self.index].offset))
    }
}
