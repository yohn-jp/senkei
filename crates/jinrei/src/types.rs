use serde::{Deserialize, Serialize};
use senkei_model::{
    ApiErrorCode, CapabilityId, CollectionId, CollectionSchema, ComparisonOperator,
    CollectionUniqueKey, DomainType, DomainValue, FieldId, KnownnessTest,
    ObservationPath, Quantifier, RulePlan, StateId, SymbolId, TacticalCollection,
    TacticalPath, TacticalPredicate, TacticalValue, TypeId,
};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct TypedProgram {
    pub name: String,
    pub states: Vec<TypedState>,
    pub actions: Vec<TypedAction>,
    pub static_cu: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct TypedState {
    pub id: StateId,
    pub predicate: Predicate,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct TypedAction {
    pub id: senkei_model::ActionId,
    pub when: Predicate,
    pub capability: CapabilityId,
    pub arguments: Vec<Value>,
    pub actor_argument: Option<usize>,
    pub target_argument: Option<usize>,
    pub target_owner: senkei_model::TargetOwnerConstraint,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) enum Predicate {
    Truth(senkei_model::Truth),
    State(StateId),
    Compare { left: Value, operator: ComparisonOperator, right: Value },
    Knownness { value: Value, test: KnownnessTest },
    And(Vec<Predicate>),
    Or(Vec<Predicate>),
    OrderedAnd(Vec<Predicate>),
    OrderedOr(Vec<Predicate>),
    Not(Box<Predicate>),
    Quantified { quantifier: Quantifier, binding: String, collection: Collection, predicates: Vec<Predicate> },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) enum Value {
    Literal { value: DomainValue, value_type: DomainType },
    Path(TypedPath),
    State(StateId),
    FilteredCollection { binding: String, collection: Collection, predicates: Vec<Predicate>, value_type: DomainType },
    Count { binding: String, collection: Collection, predicates: Vec<Predicate> },
    Sum { binding: String, collection: Collection, expression: Box<Value>, value_type: DomainType },
    Min { binding: String, collection: Collection, expression: Box<Value>, value_type: DomainType },
    Max { binding: String, collection: Collection, expression: Box<Value>, value_type: DomainType },
    ArgMin { binding: String, collection: Collection, expression: Box<Value>, unique_key: TypedPath, value_type: DomainType },
    ArgMax { binding: String, collection: Collection, expression: Box<Value>, unique_key: TypedPath, value_type: DomainType },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) enum TypedPath {
    Observation { path: ObservationPath, value_type: DomainType },
    Binding { name: String, fields: Vec<FieldId>, value_type: DomainType, synthetic_entity_id: bool },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) enum Collection {
    Path { id: CollectionId, element_type: TypeId },
    Filter { binding: String, collection: Box<Collection>, predicates: Vec<Predicate>, element_type: TypeId },
}

impl Collection {
    pub fn element_type(&self) -> &TypeId {
        match self { Self::Path { element_type, .. } | Self::Filter { element_type, .. } => element_type }
    }
}

#[derive(Clone, Debug)]
pub(crate) struct TypeChecker<'a> {
    pub plan: &'a RulePlan,
    pub state_names: BTreeSet<String>,
    pub bindings: BTreeMap<String, BindingInfo>,
}

#[derive(Clone, Debug)]
pub(crate) struct BindingInfo {
    pub entity_type: TypeId,
    pub visible_fields: BTreeMap<FieldId, senkei_model::ObservationFieldSchema>,
}

impl<'a> TypeChecker<'a> {
    pub fn new(plan: &'a RulePlan, state_names: BTreeSet<String>) -> Self {
        Self { plan, state_names, bindings: BTreeMap::new() }
    }

    pub fn type_predicate(&mut self, input: &TacticalPredicate) -> Result<Predicate, crate::CompileError> {
        use TacticalPredicate as P;
        Ok(match input {
            P::LiteralTruth(value) => Predicate::Truth(if *value { senkei_model::Truth::True } else { senkei_model::Truth::False }),
            P::StateReference(name) => {
                if !self.state_names.contains(name) { return Err(type_error(format!("unknown state '{name}'"))); }
                Predicate::State(StateId::new(name.clone()))
            }
            P::Compare { left, operator, right } => {
                let left = self.type_value(left, None)?;
                let right = self.type_value(right, Some(value_type(&left).clone()))?;
                let lt = value_type(&left);
                let rt = value_type(&right);
                if !compatible(lt, rt) {
                    return Err(type_error(format!("comparison operands have incompatible types: {lt:?} and {rt:?}")));
                }
                if !matches!(operator, ComparisonOperator::Equal | ComparisonOperator::NotEqual)
                    && !is_orderable(lt)
                { return Err(type_error("ordered comparison requires a numeric or string type")); }
                Predicate::Compare { left, operator: *operator, right }
            }
            P::Knownness { value, test } => Predicate::Knownness { value: self.type_value(value, None)?, test: *test },
            P::And(children) => Predicate::And(self.type_predicates(children)?),
            P::Or(children) => Predicate::Or(self.type_predicates(children)?),
            P::OrderedAnd(children) => Predicate::OrderedAnd(self.type_predicates(children)?),
            P::OrderedOr(children) => Predicate::OrderedOr(self.type_predicates(children)?),
            P::Not(child) => Predicate::Not(Box::new(self.type_predicate(child)?)),
            P::Quantified { quantifier, binding, collection, predicates } => {
                let collection = self.type_collection(collection)?;
                let binding_info = self.binding_info(&collection)?;
                let predicates = self.with_binding(binding, binding_info, |checker| checker.type_predicates(predicates))?;
                Predicate::Quantified { quantifier: *quantifier, binding: binding.clone(), collection, predicates }
            }
        })
    }

    fn type_predicates(&mut self, children: &[TacticalPredicate]) -> Result<Vec<Predicate>, crate::CompileError> {
        if children.is_empty() { return Err(type_error("predicate blocks cannot be empty")); }
        children.iter().map(|child| self.type_predicate(child)).collect()
    }

    fn with_binding<T>(&mut self, name: &str, info: BindingInfo,
        f: impl FnOnce(&mut Self) -> Result<T, crate::CompileError>) -> Result<T, crate::CompileError> {
        let previous = self.bindings.insert(name.to_owned(), info);
        let result = f(self);
        if let Some(previous) = previous { self.bindings.insert(name.to_owned(), previous); }
        else { self.bindings.remove(name); }
        result
    }

    pub fn type_value(&mut self, input: &TacticalValue, expected: Option<DomainType>) -> Result<Value, crate::CompileError> {
        use TacticalValue as V;
        let value = match input {
            V::Literal(value) => {
                let ty = self.literal_type(value, expected.as_ref())?;
                check_literal(value, &ty)?;
                Value::Literal { value: value.clone(), value_type: ty }
            }
            V::Path(path) => self.type_path(path, expected.as_ref())?,
            V::FilteredCollection { binding, collection, predicates } => {
                let typed_collection = self.type_collection(collection)?;
                let info = self.binding_info(&typed_collection)?;
                let predicates = self.with_binding(binding, info, |checker| checker.type_predicates(predicates))?;
                let max_items = self.collection_schema(collection)?.max_items;
                let element_type = typed_collection.element_type().clone();
                Value::FilteredCollection {
                    binding: binding.clone(),
                    collection: typed_collection,
                    predicates,
                    value_type: DomainType::Vector {
                        element: Box::new(DomainType::Entity { entity_type: Some(element_type) }),
                        max_items,
                    },
                }
            }
            V::Count { binding, collection, predicates } => {
                let collection = self.type_collection(collection)?;
                let binding_info = self.binding_info(&collection)?;
                let predicates = self.with_binding(binding, binding_info, |checker| checker.type_predicates(predicates))?;
                Value::Count { binding: binding.clone(), collection, predicates }
            }
            V::Sum { binding, collection, expression } => {
                let collection = self.type_collection(collection)?;
                let binding_info = self.binding_info(&collection)?;
                let expression = Box::new(self.with_binding(binding, binding_info, |checker| checker.type_value(expression, None))?);
                let ty = value_type(&expression);
                // An aggregate sum is not bounded by a single element's
                // declared range. It may exceed that range while remaining
                // a valid i64 result; the VM checks the actual integer limit.
                let sum_type = match ty {
                    DomainType::Integer { .. } => DomainType::Integer { min: None, max: None },
                    DomainType::Fixed { scale, .. } => DomainType::Fixed { scale: *scale, min: None, max: None },
                    _ => return Err(type_error("sum requires an integer or fixed-point expression")),
                };
                Value::Sum { binding: binding.clone(), collection, expression, value_type: sum_type }
            }
            V::Min { binding, collection, expression } => {
                let collection = self.type_collection(collection)?;
                let binding_info = self.binding_info(&collection)?;
                let expression = Box::new(self.with_binding(binding, binding_info, |checker| checker.type_value(expression, None))?);
                let ty = value_type(&expression).clone();
                if !is_numeric(&ty) { return Err(type_error("min requires an integer or fixed-point expression")); }
                Value::Min { binding: binding.clone(), collection, expression, value_type: DomainType::Optional(Box::new(ty)) }
            }
            V::Max { binding, collection, expression } => {
                let collection = self.type_collection(collection)?;
                let binding_info = self.binding_info(&collection)?;
                let expression = Box::new(self.with_binding(binding, binding_info, |checker| checker.type_value(expression, None))?);
                let ty = value_type(&expression).clone();
                if !is_numeric(&ty) { return Err(type_error("max requires an integer or fixed-point expression")); }
                Value::Max { binding: binding.clone(), collection, expression, value_type: DomainType::Optional(Box::new(ty)) }
            }
            V::ArgMin { binding, collection, expression, unique_key } => {
                self.type_arg_select(binding, collection, expression, unique_key, true)?
            }
            V::ArgMax { binding, collection, expression, unique_key } => {
                self.type_arg_select(binding, collection, expression, unique_key, false)?
            }
        };
        if let Some(expected) = expected {
            if !compatible(&expected, value_type(&value)) {
                return Err(type_error(format!("value has type {:?}, expected {expected:?}", value_type(&value))));
            }
        }
        Ok(value)
    }

    pub fn type_capability_argument(&mut self, input: &TacticalValue, expected: DomainType) -> Result<Value, crate::CompileError> {
        match self.type_value(input, Some(expected.clone())) {
            Ok(value) => Ok(value),
            Err(expected_error) => {
                let value = self.type_value(input, None).map_err(|_| expected_error.clone())?;
                let actual = value_type(&value);
                let optional_inner = match actual { DomainType::Optional(inner) => Some(inner.as_ref()), _ => None };
                if optional_inner.is_some_and(|inner| compatible(&expected, inner)) { Ok(value) } else { Err(expected_error) }
            }
        }
    }

    fn type_arg_select(&mut self, binding: &str, collection_ast: &TacticalCollection, expression_ast: &TacticalValue,
        unique_key_ast: &TacticalPath, minimum: bool) -> Result<Value, crate::CompileError> {
        let collection = self.type_collection(collection_ast)?;
        let info = self.binding_info(&collection)?;
        let (expression, unique_key) = self.with_binding(binding, info, |checker| {
            let expression = Box::new(checker.type_value(expression_ast, None)?);
            if !is_numeric(value_type(&expression)) { return Err(type_error("argmin/argmax requires a numeric ordering expression")); }
            let unique_key = match checker.type_path(unique_key_ast, None)? {
                Value::Path(path) => path,
                _ => return Err(type_error("argmin/argmax tie-break key must be an element field path")),
            };
            let key_type = match &unique_key {
                TypedPath::Binding { value_type, .. } | TypedPath::Observation { value_type, .. } => value_type,
            };
            if !matches!(key_type, DomainType::Bool | DomainType::Integer { .. } | DomainType::Fixed { .. }
                | DomainType::String { .. } | DomainType::Enum { .. } | DomainType::Entity { .. }) {
                return Err(type_error("argmin/argmax tie-break key must be a stable ordered scalar"));
            }
            Ok((expression, unique_key))
        })?;
        let schema = self.collection_schema(collection_ast)?;
        let key = match &unique_key {
            TypedPath::Binding { name, fields, synthetic_entity_id: true, .. } if name == binding && fields == &[FieldId::new("id")] => CollectionUniqueKey::EntityId,
            TypedPath::Binding { name, fields, .. } if name == binding => CollectionUniqueKey::Fields(fields.clone()),
            _ => return Err(type_error("argmin/argmax tie-break key must be an element field path")),
        };
        let is_unique = schema.unique_keys.contains(&key);
        if !is_unique {
            return Err(type_error("argmin/argmax tie-break key must be declared unique by the collection schema"));
        }
        let entity_type = DomainType::Optional(Box::new(DomainType::Entity { entity_type: Some(collection.element_type().clone()) }));
        Ok(if minimum { Value::ArgMin { binding: binding.to_owned(), collection, expression, unique_key, value_type: entity_type.clone() }
            } else { Value::ArgMax { binding: binding.to_owned(), collection, expression, unique_key, value_type: entity_type } })
    }

    fn type_path(&mut self, path: &TacticalPath, expected: Option<&DomainType>) -> Result<Value, crate::CompileError> {
        if path.0.is_empty() { return Err(type_error("value path cannot be empty")); }
        if path.0.len() == 1 && self.state_names.contains(&path.0[0]) {
            return Ok(Value::State(StateId::new(path.0[0].clone())));
        }
        let joined = path.0.join(".");
        if let Some(binding) = self.bindings.get(&path.0[0]).cloned() {
            let synthetic_entity_id = path.0.len() == 2 && path.0[1] == "id"
                && !binding.visible_fields.contains_key(&FieldId::new("id"));
            let (value_type, fields) = self.binding_path_type(&binding, &path.0[1..])?;
            return Ok(Value::Path(TypedPath::Binding { name: path.0[0].clone(), fields, value_type, synthetic_entity_id }));
        }
        if let Some(schema) = self.plan.domain.observation_fields.get(&ObservationPath::new(joined.clone())) {
            if schema.visibility == senkei_model::Visibility::Internal {
                return Err(type_error(format!("observation path '{joined}' is not accessible to Jinrei")));
            }
            return Ok(Value::Path(TypedPath::Observation { path: ObservationPath::new(joined), value_type: schema.value_type.clone() }));
        }

        // Enum values are resolved through the ruleset's symbol domains, with
        // the opposite comparison operand providing an optional expected type.
        if path.0.len() == 1 {
            let symbol = SymbolId::new(path.0[0].clone());
            let domains: Vec<_> = self.plan.domain.symbol_domains.iter()
                .filter(|(_, values)| values.contains(&symbol))
                .map(|(domain, values)| DomainType::Enum { domain: domain.clone(), values: values.clone() })
                .collect();
            let chosen = if let Some(DomainType::Enum { domain, .. }) = expected {
                domains.iter().find(|candidate| matches!(candidate, DomainType::Enum { domain: d, values: v } if d == domain && v.contains(&symbol)))
                    .cloned()
                    .or_else(|| self.find_enum_for_symbol(&symbol, domain))
            } else if domains.len() == 1 { domains.first().cloned() } else { None };
            if let Some(ty) = chosen { return Ok(Value::Literal { value: DomainValue::Enum(symbol), value_type: ty }); }
        }
        Err(type_error(format!("unknown observation, binding, state, or domain symbol '{joined}'")))
    }

    fn literal_type(&self, value: &DomainValue, expected: Option<&DomainType>) -> Result<DomainType, crate::CompileError> {
        if let DomainValue::Enum(symbol) = value {
            if let Some(DomainType::Enum { domain, values }) = expected {
                if values.contains(symbol) { return Ok(DomainType::Enum { domain: domain.clone(), values: values.clone() }); }
                return Err(type_error("enum literal is outside the expected symbol domain"));
            }
            let matches: Vec<_> = self.plan.domain.symbol_domains.iter()
                .filter(|(_, values)| values.contains(symbol))
                .map(|(domain, values)| DomainType::Enum { domain: domain.clone(), values: values.clone() })
                .collect();
            if matches.len() == 1 { return Ok(matches[0].clone()); }
            return Err(type_error("enum literal needs a unique or contextually expected symbol domain"));
        }
        literal_type(value, expected)
    }

    fn find_enum_for_symbol(&self, symbol: &SymbolId, domain: &senkei_model::SymbolDomainId) -> Option<DomainType> {
        self.plan.domain.symbol_domains.get(domain).filter(|values| values.contains(symbol))
            .map(|values| DomainType::Enum { domain: domain.clone(), values: values.clone() })
    }

    fn binding_path_type(&self, binding: &BindingInfo, fields: &[String]) -> Result<(DomainType, Vec<FieldId>), crate::CompileError> {
        if fields.is_empty() { return Ok((DomainType::Entity { entity_type: Some(binding.entity_type.clone()) }, Vec::new())); }
        if fields[0] == "id" && !binding.visible_fields.contains_key(&FieldId::new("id")) {
            if fields.len() == 1 { return Ok((DomainType::Entity { entity_type: None }, vec![FieldId::new("id")])); }
            return Err(type_error("synthetic entity id cannot have nested fields"));
        }
        let mut current_type: Option<DomainType> = None;
        let mut result = Vec::new();
        for (index, name) in fields.iter().enumerate() {
            let id = FieldId::new(name.clone());
            let next_type = if index == 0 {
                let field = binding.visible_fields.get(&id).ok_or_else(|| type_error(format!("unknown or unobservable field '{name}' on collection element")))?;
                if field.visibility == senkei_model::Visibility::Internal { return Err(type_error(format!("field '{name}' is not observable"))); }
                field.value_type.clone()
            } else {
                match current_type.as_ref() {
                    Some(DomainType::Record { fields }) => fields.get(&id).cloned()
                        .ok_or_else(|| type_error(format!("unknown nested field '{name}'")))?,
                    _ => return Err(type_error(format!("cannot access nested field '{name}' on a non-record value"))),
                }
            };
            current_type = Some(next_type);
            result.push(id);
        }
        Ok((current_type.ok_or_else(|| type_error("missing field path"))?, result))
    }

    fn type_collection(&mut self, input: &TacticalCollection) -> Result<Collection, crate::CompileError> {
        match input {
            TacticalCollection::Path(path) => {
                let joined = path.0.join(".");
                let id = CollectionId::new(joined.clone());
                let schema = self.plan.domain.collections.get(&id)
                    .ok_or_else(|| type_error(format!("unknown finite collection '{joined}'")))?;
                if schema.visibility == senkei_model::Visibility::Internal { return Err(type_error(format!("collection '{joined}' is not observable"))); }
                if schema.max_items > self.plan.domain.max_collection_items { return Err(type_error(format!("collection '{joined}' exceeds the package-wide collection bound"))); }
                Ok(Collection::Path { id, element_type: schema.element_type.clone() })
            }
            TacticalCollection::Filter { binding, collection, predicates } => {
                let source = self.type_collection(collection)?;
                let binding_info = self.binding_info(&source)?;
                let predicates = self.with_binding(binding, binding_info, |checker| checker.type_predicates(predicates))?;
                Ok(Collection::Filter { binding: binding.clone(), element_type: source.element_type().clone(), collection: Box::new(source), predicates })
            }
        }
    }

    fn collection_schema(&self, input: &TacticalCollection) -> Result<&CollectionSchema, crate::CompileError> {
        match input {
            TacticalCollection::Path(path) => self.plan.domain.collections.get(&CollectionId::new(path.0.join(".")))
                .ok_or_else(|| type_error("unknown finite collection")),
            TacticalCollection::Filter { collection, .. } => self.collection_schema(collection),
        }
    }

    fn binding_info(&self, collection: &Collection) -> Result<BindingInfo, crate::CompileError> {
        let schema = match collection {
            Collection::Path { id, .. } => self.plan.domain.collections.get(id).ok_or_else(|| type_error("unknown collection"))?,
            Collection::Filter { collection, .. } => return self.binding_info(collection),
        };
        Ok(BindingInfo { entity_type: schema.element_type.clone(), visible_fields: schema.visible_fields.clone() })
    }
}

// Nested records in world entity schemas use DomainType directly, while the
// top level uses FieldSchema. Keep the traversal explicit and bounded instead
// of fabricating leaked schema references.
pub(crate) fn value_type(value: &Value) -> &DomainType {
    match value {
        Value::Literal { value_type, .. } | Value::Path(TypedPath::Observation { value_type, .. })
        | Value::Path(TypedPath::Binding { value_type, .. }) => value_type,
        Value::State(_) => &TRUTH_TYPE,
        Value::Count { .. } => &INTEGER_TYPE,
        Value::FilteredCollection { value_type, .. } => value_type,
        Value::Sum { value_type, .. } | Value::Min { value_type, .. } | Value::Max { value_type, .. }
        | Value::ArgMin { value_type, .. } | Value::ArgMax { value_type, .. } => value_type,
    }
}

static TRUTH_TYPE: DomainType = DomainType::Bool;
static INTEGER_TYPE: DomainType = DomainType::Integer { min: None, max: None };

fn literal_type(value: &DomainValue, expected: Option<&DomainType>) -> Result<DomainType, crate::CompileError> {
    let inferred = match value {
        DomainValue::Bool(_) => DomainType::Bool,
        DomainValue::Integer(_) => expected.filter(|t| matches!(t, DomainType::Integer { .. })).cloned().unwrap_or(DomainType::Integer { min: None, max: None }),
        DomainValue::Fixed { scale, .. } => match expected {
            Some(DomainType::Fixed { scale: expected_scale, .. }) if scale == expected_scale => expected.cloned().unwrap(),
            _ => DomainType::Fixed { scale: *scale, min: None, max: None },
        },
        DomainValue::String(value) => match expected {
            Some(DomainType::String { .. }) => expected.cloned().unwrap(),
            _ => DomainType::String { max_bytes: value.len().min(u32::MAX as usize) as u32 },
        },
        DomainValue::Enum(_) => return Err(type_error("enum literals require symbol-domain resolution")),
        DomainValue::Null | DomainValue::Entity(_) | DomainValue::List(_) | DomainValue::Record(_) => return Err(type_error("this value form is not a Jinrei v0.1 scalar literal")),
    };
    Ok(inferred)
}

fn check_literal(value: &DomainValue, ty: &DomainType) -> Result<(), crate::CompileError> {
    match (value, ty) {
        (DomainValue::Integer(n), DomainType::Integer { min, max }) if min.map_or(true, |v| *n >= v) && max.map_or(true, |v| *n <= v) => Ok(()),
        (DomainValue::Integer(_), DomainType::Integer { .. }) => Err(type_error("integer literal is outside the schema range")),
        (DomainValue::Bool(_), DomainType::Bool) => Ok(()),
        (DomainValue::Fixed { coefficient, scale }, DomainType::Fixed { scale: expected, min, max })
            if scale == expected && min.map_or(true, |v| *coefficient >= v) && max.map_or(true, |v| *coefficient <= v) => Ok(()),
        (DomainValue::Fixed { .. }, DomainType::Fixed { .. }) => Err(type_error("fixed-point literal scale or range does not match the schema")),
        (DomainValue::String(s), DomainType::String { max_bytes }) if s.len() <= *max_bytes as usize => Ok(()),
        (DomainValue::String(_), DomainType::String { .. }) => Err(type_error("string literal exceeds the schema byte limit")),
        (DomainValue::Enum(symbol), DomainType::Enum { values, .. }) if values.contains(symbol) => Ok(()),
        (DomainValue::Enum(_), DomainType::Enum { .. }) => Err(type_error("enum literal is outside the declared symbol domain")),
        _ => Err(type_error(format!("literal does not match schema type {ty:?}"))),
    }
}

fn compatible(expected: &DomainType, actual: &DomainType) -> bool {
    match (expected, actual) {
        (DomainType::Integer { .. }, DomainType::Integer { .. }) => true,
        (DomainType::Fixed { scale: a, .. }, DomainType::Fixed { scale: b, .. }) => a == b,
        (DomainType::String { .. }, DomainType::String { .. }) => true,
        (DomainType::Enum { domain: a, .. }, DomainType::Enum { domain: b, .. }) => a == b,
        (DomainType::Entity { entity_type: a }, DomainType::Entity { entity_type: b }) => a == b || a.is_none() || b.is_none(),
        (DomainType::Optional(expected), DomainType::Optional(actual)) => compatible(expected, actual),
        (DomainType::Optional(expected), actual) => compatible(expected, actual),
        (DomainType::List { element: a, max_items: amax }, DomainType::Vector { element: b, max_items: bmax })
        | (DomainType::Vector { element: a, max_items: amax }, DomainType::List { element: b, max_items: bmax }) => a == b && amax == bmax,
        (DomainType::List { element: a, max_items: amax }, DomainType::List { element: b, max_items: bmax })
        | (DomainType::Vector { element: a, max_items: amax }, DomainType::Vector { element: b, max_items: bmax }) => compatible(a, b) && amax == bmax,
        (DomainType::Bool, DomainType::Bool) => true,
        _ => expected == actual,
    }
}

fn is_numeric(ty: &DomainType) -> bool { matches!(ty, DomainType::Integer { .. } | DomainType::Fixed { .. }) }
fn is_orderable(ty: &DomainType) -> bool { is_numeric(ty) || matches!(ty, DomainType::String { .. }) }
/// The logical comparison work bound represented by a schema. The top-level
/// comparison itself is one unit; every contained list item/record field adds
/// one more unit, recursively. Optional values use the maximum known-value
/// shape because they may be null at runtime. Each unit is charged as a
/// comparison operation, so a package with a base-only comparison tariff
/// still accounts for deep values.
pub(crate) fn comparison_units_bound(ty: &DomainType) -> u128 {
    1u128.saturating_add(comparison_container_work_bound(ty))
}

fn comparison_container_work_bound(ty: &DomainType) -> u128 {
    match ty {
        DomainType::Optional(inner) => comparison_container_work_bound(inner),
        DomainType::List { element, max_items } | DomainType::Vector { element, max_items } => {
            let items = *max_items as u128;
            items.saturating_add(items.saturating_mul(comparison_container_work_bound(element)))
        }
        DomainType::Matrix { element, max_rows, max_columns } => {
            let rows = *max_rows as u128;
            let cells = rows.saturating_mul(*max_columns as u128);
            rows.saturating_add(cells).saturating_add(cells.saturating_mul(comparison_container_work_bound(element)))
        }
        DomainType::Record { fields } => {
            fields.values().fold(fields.len() as u128, |work, field| {
                work.saturating_add(comparison_container_work_bound(field))
            })
        }
        _ => 0,
    }
}

fn type_error(message: impl Into<String>) -> crate::CompileError {
    crate::CompileError::new(ApiErrorCode::ValidationFailed, message)
}
