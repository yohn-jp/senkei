//! Versioned, structured input shared by the visual editor and Jinrei compiler.

use crate::{DomainValue, Version};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct StructuredTacticsAst {
    pub schema_version: Version,
    pub program_name: String,
    pub declarations: Vec<TacticalDeclaration>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum TacticalDeclaration {
    State {
        name: String,
        /// State block contents use implicit AND, matching the text grammar.
        predicates: Vec<TacticalPredicate>,
    },
    Action {
        name: String,
        when: TacticalPredicate,
        do_call: TacticalCapabilityCall,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "value", rename_all = "snake_case")]
pub enum TacticalPredicate {
    LiteralTruth(bool),
    StateReference(String),
    Compare {
        left: TacticalValue,
        operator: ComparisonOperator,
        right: TacticalValue,
    },
    Knownness {
        value: TacticalValue,
        test: KnownnessTest,
    },
    And(Vec<TacticalPredicate>),
    Or(Vec<TacticalPredicate>),
    Not(Box<TacticalPredicate>),
    OrderedAnd(Vec<TacticalPredicate>),
    OrderedOr(Vec<TacticalPredicate>),
    Quantified {
        quantifier: Quantifier,
        binding: String,
        collection: TacticalCollection,
        predicates: Vec<TacticalPredicate>,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ComparisonOperator {
    Equal,
    NotEqual,
    LessThan,
    LessThanOrEqual,
    GreaterThan,
    GreaterThanOrEqual,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum KnownnessTest {
    Known,
    Unknown,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Quantifier {
    Any,
    All,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "value", rename_all = "snake_case")]
pub enum TacticalValue {
    Literal(DomainValue),
    Path(TacticalPath),
    Count {
        binding: String,
        collection: TacticalCollection,
        predicates: Vec<TacticalPredicate>,
    },
    Sum {
        binding: String,
        collection: TacticalCollection,
        expression: Box<TacticalValue>,
    },
    Min {
        binding: String,
        collection: TacticalCollection,
        expression: Box<TacticalValue>,
    },
    Max {
        binding: String,
        collection: TacticalCollection,
        expression: Box<TacticalValue>,
    },
    ArgMin {
        binding: String,
        collection: TacticalCollection,
        expression: Box<TacticalValue>,
        unique_key: TacticalPath,
    },
    ArgMax {
        binding: String,
        collection: TacticalCollection,
        expression: Box<TacticalValue>,
        unique_key: TacticalPath,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "value", rename_all = "snake_case")]
pub enum TacticalCollection {
    Path(TacticalPath),
    Filter {
        binding: String,
        collection: Box<TacticalCollection>,
        predicates: Vec<TacticalPredicate>,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(transparent)]
pub struct TacticalPath(pub Vec<String>);

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct TacticalCapabilityCall {
    pub capability: TacticalPath,
    pub arguments: Vec<TacticalValue>,
}
