use senkei_model::*;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};

/// Hashes deterministic rule content with its self-reference and presentation
/// projection fields removed. `serde_json::Map` is key ordered in this
/// workspace, and all model maps are `BTreeMap`, so native/WASM agree.
pub fn canonical_digest(package: &RulePackage) -> Result<ContentDigest, serde_json::Error> {
    let mut value = serde_json::to_value(package)?;
    if let Some(ruleset) = value.get_mut("ruleset").and_then(serde_json::Value::as_object_mut) {
        ruleset.remove("digest");
    }
    // The paired World reference travels with match/replay identity, but its
    // presentation half is deliberately outside simulation/package identity.
    // BattleMap logical coordinates remain rule/Jinrei inputs. Only the
    // paired World presentation identity and coordinates are renderer inputs.
    if let Some(next) = value.get_mut("next").and_then(serde_json::Value::as_object_mut) {
        if let Some(identity) = next.get_mut("world_identity").and_then(serde_json::Value::as_object_mut) {
            identity.remove("presentation_digest");
        }
        if let Some(map) = next.get_mut("map").and_then(serde_json::Value::as_object_mut) {
            if let Some(identity) = map.get_mut("world_identity").and_then(serde_json::Value::as_object_mut) {
                identity.remove("presentation_digest");
            }
            if let Some(projection) = map.get_mut("world_projection").and_then(serde_json::Value::as_object_mut) {
                if let Some(identity) = projection.get_mut("source_identity").and_then(serde_json::Value::as_object_mut) {
                    identity.remove("presentation_digest");
                }
                projection.remove("presentation_artifact");
            }
            if let Some(nodes) = map.get_mut("nodes").and_then(serde_json::Value::as_object_mut) {
                for node in nodes.values_mut() {
                    if let Some(node) = node.as_object_mut() {
                        node.remove("presentation_x");
                        node.remove("presentation_y");
                    }
                }
            }
        }
    }
    let bytes = serde_json::to_vec(&value)?;
    let digest = Sha256::digest(bytes);
    Ok(ContentDigest::new(format!("{digest:x}")))
}

/// Validates an untrusted Senritsu package and returns the only type Enbu may
/// execute. Every issue is returned in stable path/code order.
pub fn validate(
    package: RulePackage,
    engine: &EngineCompatibility,
) -> Result<VerifiedRulePlan, Vec<ValidationIssue>> {
    let resolver = crate::next_world::builtin_world_resolver();
    validate_with_world_resolver_and_catalog_extension(package, engine, &resolver, None)
}

/// Validates a RulePackage against an explicit immutable World artifact store.
/// All next packages must resolve and exactly reproduce their versioned
/// BattleMap projection before a VerifiedRulePlan can be constructed.
pub fn validate_with_world_resolver(
    package: RulePackage,
    engine: &EngineCompatibility,
    resolver: &senkei_world::WorldResolver,
) -> Result<VerifiedRulePlan, Vec<ValidationIssue>> {
    validate_with_world_resolver_and_catalog_extension(package, engine, resolver, None)
}

/// Validates the World projection and the package-bound catalog/Behavior
/// extension before returning an executable plan. The extension is required
/// exactly when the RulePackage carries its semantic content digest.
pub fn validate_with_catalog_extension(
    package: RulePackage,
    engine: &EngineCompatibility,
    extension: crate::catalog::CatalogMetadataExtension,
) -> Result<VerifiedRulePlan, Vec<ValidationIssue>> {
    let resolver = crate::next_world::builtin_world_resolver();
    validate_with_world_resolver_and_catalog_extension(package, engine, &resolver, Some(extension))
}

pub fn validate_with_world_resolver_and_catalog_extension(
    package: RulePackage,
    engine: &EngineCompatibility,
    resolver: &senkei_world::WorldResolver,
    extension: Option<crate::catalog::CatalogMetadataExtension>,
) -> Result<VerifiedRulePlan, Vec<ValidationIssue>> {
    let mut issues = Vec::new();
    validate_header_and_digest(&package, engine, &mut issues);
    validate_limits(&package, &mut issues);
    validate_domain(&package, &mut issues);
    validate_world(&package, &mut issues);
    validate_world_initialization(&package, &mut issues);
    if package.next.is_none() { validate_roster_identity_contract(&package, &mut issues); }
    crate::next_validate::validate_next(&package, &mut issues);
    validate_world_resolution(&package, resolver, &mut issues);
    validate_phases_and_rules(&package, &mut issues);
    validate_arbitration(&package, &mut issues);
    validate_costs(&package, &mut issues);
    validate_presentation(&package, &mut issues);
    validate_termination(&package, &mut issues);

    issues.sort_by(|left, right| {
        (&left.path, &left.code, &left.message).cmp(&(&right.path, &right.code, &right.message))
    });
    issues.dedup_by(|left, right| {
        left.path == right.path && left.code == right.code && left.message == right.message
    });
    if !issues.is_empty() {
        return Err(issues);
    }

    let digest = canonical_digest(&package).map_err(|error| {
        vec![ValidationIssue::new(
            "canonical_serialization_failed",
            "ruleset",
            format!("package could not be serialized for digest verification: {error}"),
        )]
    })?;
    let plan = VerifiedRulePlan::from_validation(
        package.ruleset.clone(),
        digest,
        RulePlan::from(&package),
    );
    match (plan.catalog_semantics_digest(), extension) {
        (None, None) => Ok(plan),
        (Some(_), None) => Err(vec![ValidationIssue::new(
            "missing_catalog_semantics_extension",
            "catalog_semantics_digest",
            "RulePackage references match-affecting catalog/Behavior metadata but no extension was resolved",
        )]),
        (_, Some(extension)) => {
            crate::catalog::DomainCatalog::from_verified_plan_with_extension(&plan, extension)
                .map(|_| plan)
                .map_err(|error| error.issues.into_iter().map(|issue| ValidationIssue::new(
                    issue.code,
                    issue.path,
                    issue.message,
                )).collect())
        }
    }
}

fn validate_world_resolution(
    package: &RulePackage,
    resolver: &senkei_world::WorldResolver,
    issues: &mut Vec<ValidationIssue>,
) {
    let Some(next) = package.next.as_ref() else { return };
    let Some(reference) = next.world_identity.as_ref() else {
        issues.push(ValidationIssue::new(
            "missing_world_identity",
            "next.world_identity",
            "RulePackage cannot be verified without its source World identity",
        ));
        return;
    };
    let world = match resolver.resolve(reference) {
        Ok(world) => world,
        Err(senkei_world::WorldResolveError::MissingWorld) => {
            issues.push(ValidationIssue::new(
                "world_artifact_missing",
                "next.world_identity",
                "referenced World artifact is unavailable in the resolver",
            ));
            return;
        }
        Err(senkei_world::WorldResolveError::IdentityMismatch) => {
            issues.push(ValidationIssue::new(
                "world_identity_mismatch",
                "next.world_identity",
                "resolved World artifact does not match the complete paired identity",
            ));
            return;
        }
        Err(senkei_world::WorldResolveError::IdentityConflict) => {
            issues.push(ValidationIssue::new(
                "world_resolver_conflict",
                "next.world_identity",
                "resolver contains conflicting immutable artifacts for one World identity",
            ));
            return;
        }
    };
    match crate::next_world::project_verified_world(world, None) {
        Ok(projection) if projection.runtime_map() == &next.map => {}
        Ok(_) => issues.push(ValidationIssue::new(
            "world_projection_mismatch",
            "next.map.world_projection",
            "BattleMap content does not exactly match the resolved canonical World projection",
        )),
        Err(error) => issues.push(ValidationIssue::new(
            "world_projection_invalid",
            "next.map.world_projection",
            format!("resolved World cannot produce this BattleMap projection: {error}"),
        )),
    }
}

fn validate_header_and_digest(
    package: &RulePackage,
    engine: &EngineCompatibility,
    issues: &mut Vec<ValidationIssue>,
) {
    if package.ruleset.id.as_str().is_empty() {
        issue(issues, "invalid_ruleset_id", "ruleset.id", "ruleset ID cannot be empty");
    }
    if package.ruleset.version == Version::default() {
        issue(issues, "invalid_version", "ruleset.version", "ruleset version cannot be zero");
    }
    for (path, version) in [
        ("minimum_engine_version", package.minimum_engine_version),
        ("model_version", package.model_version),
        ("primitive_set_version", package.primitive_set_version),
        ("jinrei_language_version", package.jinrei_language_version),
        ("structured_ast_version", package.structured_ast_version),
        ("typed_ir_version", package.typed_ir_version),
        ("bytecode_version", package.bytecode_version),
    ] {
        if version == Version::default() {
            issue(issues, "invalid_version", path, "component version cannot be zero");
        }
    }
    if !package.ruleset.digest.has_sha256_shape() {
        issue(issues, "invalid_digest", "ruleset.digest", "digest must be 64 lowercase hexadecimal characters");
    }
    match canonical_digest(package) {
        Ok(expected) if expected != package.ruleset.digest => issue(
            issues,
            "digest_mismatch",
            "ruleset.digest",
            "ruleset digest does not match canonical package content",
        ),
        Err(error) => issue(
            issues,
            "canonical_serialization_failed",
            "ruleset",
            format!("package could not be serialized for digest verification: {error}"),
        ),
        _ => {}
    }
    if let Err(header_issues) = senkei_model::validate_package_header(package, engine) {
        issues.extend(header_issues);
    }
}

fn validate_limits(package: &RulePackage, issues: &mut Vec<ValidationIssue>) {
    if package.domain.max_expression_depth == 0 {
        issue(issues, "invalid_limit", "domain.max_expression_depth", "expression depth must be finite and greater than zero");
    }
    if package.domain.max_collection_items == 0 {
        issue(issues, "invalid_limit", "domain.max_collection_items", "collection item limit must be finite and greater than zero");
    }
    if package.world.max_entities == 0 {
        issue(issues, "invalid_limit", "world.max_entities", "entity limit must be greater than zero");
    }
    if package.limits.max_entities == 0 || package.limits.max_entities > package.world.max_entities {
        issue(issues, "invalid_limit", "limits.max_entities", "rule entity limit must be positive and no greater than the world schema limit");
    }
    for (path, value) in [
        ("limits.max_input_bytes", package.limits.max_input_bytes),
        ("limits.max_events", package.limits.max_events),
        ("limits.max_diagnostic_events", package.limits.max_diagnostic_events),
        ("limits.max_output_bytes", package.limits.max_output_bytes),
    ] {
        if value == 0 || value > LogicalCu::MAX_SAFE_JSON_INTEGER {
            issue(issues, "invalid_limit", path, "host limits must be positive and safe for JSON clients");
        }
    }
    if package.limits.max_intents_per_side_per_tick == 0 {
        issue(issues, "invalid_limit", "limits.max_intents_per_side_per_tick", "intent limit must be greater than zero");
    }
    if package.limits.max_value_depth == 0 || package.limits.max_value_depth > package.domain.max_expression_depth {
        issue(issues, "invalid_limit", "limits.max_value_depth", "value depth must be positive and no greater than the expression depth limit");
    }
    if package.termination.max_ticks == 0 {
        issue(issues, "invalid_limit", "termination.max_ticks", "maximum tick count must be greater than zero");
    }
}

fn validate_domain(package: &RulePackage, issues: &mut Vec<ValidationIssue>) {
    let domain = &package.domain;
    if domain.schema_version == Version::default() {
        issue(issues, "invalid_version", "domain.schema_version", "domain schema version cannot be zero");
    }
    if domain.observation_fields.is_empty() {
        issue(issues, "empty_schema", "domain.observation_fields", "at least one observation field is required");
    }
    if domain.capabilities.is_empty() {
        issue(issues, "empty_schema", "domain.capabilities", "at least one capability is required");
    }
    if domain.senkei_configuration.is_empty() {
        issue(issues, "empty_schema", "domain.senkei_configuration", "at least one Senkei configuration field is required");
    }

    for (id, values) in &domain.symbol_domains {
        if id.as_str().is_empty() || values.is_empty() {
            issue(issues, "invalid_symbol_domain", format!("domain.symbol_domains.{id}"), "symbol domains must have an ID and at least one value");
        }
        if values.iter().any(|value| value.as_str().is_empty()) {
            issue(issues, "invalid_symbol", format!("domain.symbol_domains.{id}"), "enum symbol IDs cannot be empty");
        }
    }

    for (id, field) in &domain.senkei_configuration {
        let path = format!("domain.senkei_configuration.{id}");
        validate_type(&field.value_type, &format!("{path}.value_type"), package, issues, 0);
        if let Some(default) = &field.default {
            validate_value(default, &field.value_type, &format!("{path}.default"), package, issues, 0);
        }
        if field.required && field.default.is_some() {
            issue(issues, "invalid_default", format!("{path}.default"), "a required configuration field cannot also declare a default");
        }
    }

    for (path_id, field) in &domain.observation_fields {
        let path = format!("domain.observation_fields.{path_id}");
        if path_id.as_str().is_empty() {
            issue(issues, "invalid_observation_path", &path, "observation paths cannot be empty");
        }
        if field.visibility == Visibility::Internal {
            issue(issues, "hidden_observation_access", &path, "internal fields cannot be published in the Jinrei observation schema");
        }
        validate_type(&field.value_type, &format!("{path}.value_type"), package, issues, 0);
        validate_observation_source(&field.source, &field.value_type, &field.visibility, &path, package, issues);
    }

    for (id, collection) in &domain.collections {
        let path = format!("domain.collections.{id}");
        validate_observation_collection(id, collection, &path, package, issues);
    }

    for (id, value_type) in &domain.tactical_memory {
        validate_type(value_type, &format!("domain.tactical_memory.{id}"), package, issues, 0);
        if !matches!(value_type, DomainType::Bool | DomainType::Integer { .. } | DomainType::Fixed { .. } | DomainType::String { .. } | DomainType::Enum { .. } | DomainType::Optional(_)) {
            issue(issues, "invalid_memory_type", format!("domain.tactical_memory.{id}"), "tactical memory must use a finite scalar or optional type");
        }
    }

    for (capability_id, capability) in &domain.capabilities {
        let path = format!("domain.capabilities.{capability_id}");
        if capability_id.as_str().is_empty() {
            issue(issues, "invalid_capability", &path, "capability ID cannot be empty");
        }
        if capability.arguments.len() > 32 {
            issue(issues, "invalid_limit", format!("{path}.arguments"), "capability may have at most 32 parameters");
        }
        let mut parameter_ids = BTreeSet::new();
        for (index, argument) in capability.arguments.iter().enumerate() {
            let argument_path = format!("{path}.arguments[{index}]");
            if argument.id.as_str().is_empty() {
                issue(issues, "invalid_parameter", &argument_path, "parameter ID cannot be empty");
            }
            if !parameter_ids.insert(argument.id.clone()) {
                issue(issues, "duplicate_parameter", &argument_path, "parameter IDs must be unique within a capability");
            }
            validate_type(&argument.value_type, &format!("{argument_path}.value_type"), package, issues, 0);
            if argument.optional && !matches!(argument.value_type, DomainType::Optional(_)) {
                issue(issues, "invalid_parameter", format!("{argument_path}.optional"), "optional parameters must use an Optional value type");
            }
        }
        if let Some(target_type) = &capability.target_type {
            if !package.world.entity_types.contains_key(target_type) {
                issue(issues, "unknown_entity_type", format!("{path}.target_type"), "capability target type is not declared by the world schema");
            }
        }
        let actor_type = validate_entity_binding(capability.actor_argument, capability, &format!("{path}.actor_argument"), false, issues);
        let target_type = validate_entity_binding(capability.target_argument, capability, &format!("{path}.target_argument"), package.next.is_some(), issues);
        if let Some(target_index) = capability.target_argument {
            if capability.actor_argument == Some(target_index) {
                issue(issues, "invalid_capability_binding", &path, "actor and target arguments must be different");
            }
            if target_type != capability.target_type.as_ref() {
                issue(issues, "target_type_mismatch", format!("{path}.target_type"), "target_type must exactly match the target argument entity type");
            }
        } else if capability.target_type.is_some() || capability.target_owner != TargetOwnerConstraint::Any {
            issue(issues, "invalid_capability_binding", &path, "target type and owner constraint require a target argument");
        }
        let _ = actor_type;
        if capability.phases.is_empty() {
            issue(issues, "missing_phase", format!("{path}.phases"), "capability must declare at least one execution phase");
        }
        for (index, precondition) in capability.preconditions.iter().enumerate() {
            let expression_path = format!("{path}.preconditions[{index}]");
            let ty = infer_expression_type(precondition, &expression_path, Some(capability), None, package, issues, 0);
            if ty.as_ref().is_some_and(|ty| !is_bool(ty)) {
                issue(issues, "invalid_precondition_type", &expression_path, "capability preconditions must evaluate to boolean values");
            }
        }
    }
}

fn validate_world(package: &RulePackage, issues: &mut Vec<ValidationIssue>) {
    for (id, field) in &package.world.global_fields {
        let path = format!("world.global_fields.{id}");
        if id.as_str().is_empty() {
            issue(issues, "invalid_field", &path, "field IDs cannot be empty");
        }
        validate_type(&field.value_type, &format!("{path}.value_type"), package, issues, 0);
    }
    for (type_id, entity_type) in &package.world.entity_types {
        let type_path = format!("world.entity_types.{type_id}");
        if type_id.as_str().is_empty() {
            issue(issues, "invalid_entity_type", &type_path, "entity type IDs cannot be empty");
        }
        for (field_id, field) in &entity_type.fields {
            let path = format!("{type_path}.fields.{field_id}");
            if field_id.as_str().is_empty() {
                issue(issues, "invalid_field", &path, "field IDs cannot be empty");
            }
            validate_type(&field.value_type, &format!("{path}.value_type"), package, issues, 0);
            if field.writable && field.visibility == Visibility::Internal {
                // Internal fields may be writable by the finite engine rules,
                // but are never part of an externally visible schema.
            }
        }
    }
    for (id, collection) in &package.world.collections {
        let path = format!("world.collections.{id}");
        if id.as_str().is_empty() {
            issue(issues, "invalid_collection", &path, "collection IDs cannot be empty");
        }
        if collection.max_items == 0 || collection.max_items > package.limits.max_entities {
            issue(issues, "invalid_limit", format!("{path}.max_items"), "world collection size must be positive and within the entity limit");
        }
        validate_type(&collection.element_type, &format!("{path}.element_type"), package, issues, 0);
        if let DomainType::Entity { entity_type: Some(entity_type) } = &collection.element_type {
            if !package.world.entity_types.contains_key(entity_type) {
                issue(issues, "unknown_entity_type", format!("{path}.element_type"), "collection element entity type is not declared");
            }
        }
    }
}

fn validate_world_initialization(package: &RulePackage, issues: &mut Vec<ValidationIssue>) {
    let initialization = &package.world_initialization;
    for (field_id, value) in &initialization.global_fields {
        let path = format!("world_initialization.global_fields.{field_id}");
        match package.world.global_fields.get(field_id) {
            None => issue(issues, "unknown_global_field", &path, "initialization seeds an undeclared global field"),
            Some(schema) => validate_value(value, &schema.value_type, &path, package, issues, 0),
        }
    }
    for (field_id, schema) in &package.world.global_fields {
        if !initialization.global_fields.contains_key(field_id) {
            issue(issues, "missing_initial_global", format!("world_initialization.global_fields.{field_id}"), "every global world field requires a deterministic initial value");
        }
        let _ = schema;
    }

    for (collection_id, values) in &initialization.collections {
        let path = format!("world_initialization.collections.{collection_id}");
        let Some(schema) = package.world.collections.get(collection_id) else {
            issue(issues, "unknown_collection", &path, "initialization seeds an undeclared world collection");
            continue;
        };
        if values.len() > schema.max_items as usize {
            issue(issues, "value_limit", &path, "initial collection seed exceeds the world collection item limit");
        }
        for (index, value) in values.iter().enumerate() {
            validate_value(value, &schema.element_type, &format!("{path}[{index}]"), package, issues, 0);
        }
    }
    for (collection_id, schema) in &package.world.collections {
        if !initialization.collections.contains_key(collection_id) {
            // An empty collection is represented by an explicit empty seed;
            // this prevents engine defaults from changing between versions.
            issue(issues, "missing_initial_collection", format!("world_initialization.collections.{collection_id}"), "world collections require an explicit initial seed, including empty collections");
        }
        let _ = schema;
    }

    let mut projection_keys = BTreeSet::new();
    for (index, projection) in initialization.entities.iter().enumerate() {
        let path = format!("world_initialization.entities[{index}]");
        if projection.projection_id.as_str().is_empty() {
            issue(issues, "invalid_projection_id", format!("{path}.projection_id"), "projection IDs cannot be empty");
        }
        if projection.entity_type.as_str().is_empty() {
            issue(issues, "invalid_entity_type", format!("{path}.entity_type"), "projection entity type cannot be empty");
        }
        let Some(entity_schema) = package.world.entity_types.get(&projection.entity_type) else {
            issue(issues, "unknown_entity_type", format!("{path}.entity_type"), "projection entity type is not declared by the world schema");
            continue;
        };
        match &projection.source {
            EntityProjectionSource::Singleton => {}
            EntityProjectionSource::EachConfigurationItem { field } => {
                match package.domain.senkei_configuration.get(field).map(|field| &field.value_type) {
                    Some(DomainType::List { element, .. }) | Some(DomainType::Vector { element, .. }) if matches!(element.as_ref(), DomainType::Record { .. }) => {}
                    _ => issue(issues, "invalid_projection_source", format!("{path}.source"), "configuration item projection source must be a bounded list of records"),
                }
            }
        }
        validate_entity_id_projection(&projection.entity_id, projection, &path, package, issues);

        let key = format!(
            "{}|{}|{:?}|{:?}|{:?}|{:?}",
            projection.projection_id,
            projection.entity_type,
            projection.applies_to,
            projection.owner,
            projection.source,
            projection.entity_id,
        );
        if !projection_keys.insert(key) {
            issue(issues, "duplicate_entity_projection", &path, "two projections can produce the same entity identity");
        }
        if matches!(projection.entity_id, EntityIdProjection::Fixed(_))
            && projection.applies_to == ProjectionSides::Both
            && !matches!(projection.owner, EntityOwnerProjection::Fixed(_))
        {
            issue(issues, "duplicate_fixed_entity_id", format!("{path}.entity_id"), "a fixed entity ID projected for both sides must have a fixed owner to avoid collision");
        }

        for field_id in entity_schema.fields.keys() {
            if !projection.fields.contains_key(field_id) {
                issue(issues, "missing_projected_field", format!("{path}.fields.{field_id}"), "projection must provide a value for every entity field");
            }
        }
        for (field_id, value) in &projection.fields {
            let value_path = format!("{path}.fields.{field_id}");
            match entity_schema.fields.get(field_id) {
                None => issue(issues, "unknown_field", &value_path, "projection supplies an undeclared entity field"),
                Some(field) => validate_projection_value(value, &field.value_type, projection, &value_path, package, issues),
            }
        }
    }
}

fn validate_roster_identity_contract(package: &RulePackage, issues: &mut Vec<ValidationIssue>) {
    let slot_id = FieldId::new("slot_id");
    let roster_fields = [FieldId::new("initial_deployments"), FieldId::new("reinforcements")];

    // The same per-side slot namespace is used for initial units and reserves.
    // Duplicate values would collide in the shared `unit_roster` projection.
    let mut seen = BTreeMap::<String, FieldId>::new();
    for roster_field in &roster_fields {
        let Some(schema) = package.domain.senkei_configuration.get(roster_field) else { continue };
        let Some(DomainValue::List(items)) = &schema.default else { continue };
        for (index, item) in items.iter().enumerate() {
            let DomainValue::Record(fields) = item else { continue };
            let Some(DomainValue::String(value)) = fields.get(&slot_id) else { continue };
            if seen.insert(value.clone(), roster_field.clone()).is_some() {
                issue(
                    issues,
                    "duplicate_roster_slot_id",
                    format!("domain.senkei_configuration.{roster_field}.default[{index}].slot_id"),
                    "slot_id values must be unique across initial deployments and reinforcements",
                );
            }
        }
    }

    let mut shared_projection_id: Option<ProjectionId> = None;
    for source_field in &roster_fields {
        let source_projections = package.world_initialization.entities.iter().filter(|projection| {
            projection.source == EntityProjectionSource::EachConfigurationItem { field: source_field.clone() }
        }).collect::<Vec<_>>();
        if source_projections.len() != 1 {
            issue(
                issues,
                "invalid_roster_projection",
                format!("world_initialization.entities.{source_field}"),
                "each roster configuration list must have exactly one unit projection",
            );
            continue;
        }
        let projection = source_projections[0];
        let expected_slot_path = vec![slot_id.clone()];
        if projection.entity_type != TypeId::new("unit")
            || projection.applies_to != ProjectionSides::Both
            || projection.owner != EntityOwnerProjection::SnapshotSide
            || projection.entity_id != (EntityIdProjection::ConfigurationItemKey { path: expected_slot_path.clone() })
            || projection.fields.get(&slot_id) != Some(&ProjectionValue::ConfigurationItemPath { path: expected_slot_path })
        {
            issue(
                issues,
                "invalid_roster_projection",
                format!("world_initialization.entities.{source_field}"),
                "roster units must project slot_id as their per-side unit key and visible unit field",
            );
        }
        if let Some(existing) = &shared_projection_id {
            if existing != &projection.projection_id {
                issue(
                    issues,
                    "invalid_roster_projection",
                    format!("world_initialization.entities.{source_field}.projection_id"),
                    "initial units and reserves must share a projection ID so duplicate slot IDs collide",
                );
            }
        } else {
            shared_projection_id = Some(projection.projection_id.clone());
        }
    }

    let unit_schema_field = package
        .world
        .entity_types
        .get(&TypeId::new("unit"))
        .and_then(|schema| schema.fields.get(&slot_id));
    if !unit_schema_field.is_some_and(|field| {
        field.value_type == (DomainType::String { max_bytes: 48 })
            && field.visibility == Visibility::Public
            && !field.writable
    }) {
        issue(issues, "invalid_roster_slot_id_field", "world.entity_types.unit.fields.slot_id", "slot_id must be a read-only public string field with a 48-byte limit");
    }

    for collection_id in ["allies.units", "allies.reserves", "enemies.visible_units"] {
        let collection = package.domain.collections.get(&CollectionId::new(collection_id));
        let field = collection.and_then(|collection| collection.visible_fields.get(&slot_id));
        if !field.is_some_and(|field| {
            field.value_type == (DomainType::String { max_bytes: 48 })
                && field.visibility == Visibility::Public
                && field.source == (ObservationSource::CurrentEntityField { field: slot_id.clone() })
        }) {
            issue(issues, "missing_roster_slot_id_observation", format!("domain.collections.{collection_id}.visible_fields.slot_id"), "unit observation must expose slot_id from the current entity");
        }
        if !collection.is_some_and(|collection| {
            collection.unique_keys.contains(&CollectionUniqueKey::Fields(vec![slot_id.clone()]))
        }) {
            issue(issues, "missing_roster_slot_id_unique_key", format!("domain.collections.{collection_id}.unique_keys"), "unit observation must declare slot_id as a unique key for deterministic argmin/argmax");
        }
    }

    if package
        .presentation
        .visible_entity_fields
        .get(&TypeId::new("unit"))
        .is_some_and(|fields| fields.contains(&slot_id))
    {
        issue(issues, "roster_slot_id_presentation_leak", "presentation.visible_entity_fields.unit.slot_id", "raw slot IDs are tactical observation keys and must not be exposed in public replay");
    }
}

fn validate_entity_id_projection(
    id_projection: &EntityIdProjection,
    projection: &EntityProjection,
    path: &str,
    package: &RulePackage,
    issues: &mut Vec<ValidationIssue>,
) {
    let key_type = match id_projection {
        EntityIdProjection::Fixed(entity_id) => {
            if entity_id.as_str().is_empty() {
                issue(issues, "invalid_entity_id", format!("{path}.entity_id"), "fixed entity ID cannot be empty");
            }
            None
        }
        EntityIdProjection::ConstantKey(key) => {
            if key.is_empty() || key.len() > 256 {
                issue(issues, "invalid_projection_key", format!("{path}.entity_id"), "constant projection keys must be 1..256 UTF-8 bytes");
            }
            None
        }
        EntityIdProjection::ConfigurationKey { root, path: fields } => {
            if !matches!(projection.source, EntityProjectionSource::Singleton) {
                issue(issues, "invalid_projection_key", format!("{path}.entity_id"), "configuration-root keys are valid only for singleton projections");
            }
            match configuration_path_type(&package.domain, root, fields) {
                Some(ty) => Some(ty),
                None => {
                    issue(issues, "invalid_projection_key", format!("{path}.entity_id"), "configuration ID key path is not declared by the configuration schema");
                    None
                }
            }
        }
        EntityIdProjection::ConfigurationItemKey { path: fields } => {
            let field = match &projection.source {
                EntityProjectionSource::EachConfigurationItem { field } => Some(field),
                EntityProjectionSource::Singleton => None,
            };
            let ty = field.and_then(|field| configuration_item_path_type(&package.domain, field, fields));
            if ty.is_none() {
                issue(issues, "invalid_projection_key", format!("{path}.entity_id"), "configuration item ID key path is not declared by the selected record schema");
            }
            ty
        }
    };
    if let Some(ty) = key_type {
        if !matches!(ty, DomainType::String { .. } | DomainType::Entity { .. }) {
            issue(issues, "invalid_projection_key_type", format!("{path}.entity_id"), "projected entity key must be a bounded string or entity ID");
        }
    }
}

fn validate_projection_value(
    value: &ProjectionValue,
    expected: &DomainType,
    projection: &EntityProjection,
    path: &str,
    package: &RulePackage,
    issues: &mut Vec<ValidationIssue>,
) {
    match value {
        ProjectionValue::Constant(value) => validate_value(value, expected, path, package, issues, 0),
        ProjectionValue::ConfigurationPath { root, path: fields } => match configuration_path_type(&package.domain, root, fields) {
            Some(actual) if same_type(expected, &actual) => {}
            Some(_) => issue(issues, "projection_type_mismatch", path, "configuration value type does not match the projected world field"),
            None => issue(issues, "invalid_configuration_path", path, "projection references an undeclared configuration path"),
        },
        ProjectionValue::ConfigurationItemPath { path: fields } => {
            let source = match &projection.source {
                EntityProjectionSource::EachConfigurationItem { field } => Some(field),
                EntityProjectionSource::Singleton => None,
            };
            match source.and_then(|field| configuration_item_path_type(&package.domain, field, fields)) {
                Some(actual) if same_type(expected, &actual) => {}
                Some(_) => issue(issues, "projection_type_mismatch", path, "configuration item value type does not match the projected world field"),
                None => issue(issues, "invalid_configuration_path", path, "projection references an undeclared configuration item path"),
            }
        }
        ProjectionValue::SnapshotSide => match expected {
            DomainType::Enum { values, .. }
                if values.contains(&SymbolId::new("attacker")) && values.contains(&SymbolId::new("defender")) => {}
            _ => issue(issues, "projection_type_mismatch", path, "snapshot side requires an enum containing attacker and defender"),
        },
    }
}

fn validate_observation_source(
    source: &ObservationSource,
    expected: &DomainType,
    visibility: &Visibility,
    path: &str,
    package: &RulePackage,
    issues: &mut Vec<ValidationIssue>,
) {
    match source {
        ObservationSource::Tick => {
            if !is_integer(expected) {
                issue(issues, "observation_source_type_mismatch", format!("{path}.source"), "tick source must use an integer value type");
            }
        }
        ObservationSource::WorldGlobalField { field } => match package.world.global_fields.get(field) {
            None => issue(issues, "unknown_global_field", format!("{path}.source"), "observation source references an undeclared world global"),
            Some(field_schema) => {
                if !same_type(expected, &field_schema.value_type) {
                    issue(issues, "observation_source_type_mismatch", format!("{path}.source"), "observation type does not match the world global field");
                }
                if !visibility_can_publish(*visibility, field_schema.visibility) {
                    issue(issues, "hidden_observation_access", format!("{path}.source"), "observation path exposes a hidden global field");
                }
            }
        },
        ObservationSource::WorldEntityField { entity, field } => {
            match world_entity_selector_type(entity, package) {
                None => issue(issues, "unknown_entity_selector", format!("{path}.source.entity"), "observation entity selector is not produced by this ruleset"),
                Some(entity_type) => match package.world.entity_types.get(&entity_type).and_then(|schema| schema.fields.get(field)) {
                    None => issue(issues, "unknown_field", format!("{path}.source.field"), "observation entity field is not declared"),
                    Some(field_schema) => {
                        if !same_type(expected, &field_schema.value_type) {
                            issue(issues, "observation_source_type_mismatch", format!("{path}.source"), "observation type does not match the world entity field");
                        }
                        if !visibility_can_publish(*visibility, field_schema.visibility) {
                            issue(issues, "hidden_observation_access", format!("{path}.source"), "observation path exposes an entity field hidden from this viewer");
                        }
                    }
                },
            }
        }
        ObservationSource::CurrentEntityField { .. } => {
            issue(issues, "invalid_observation_source", format!("{path}.source"), "current entity source is valid only inside an entity collection schema");
        }
        ObservationSource::Derived(expression) => {
            validate_observation_expression_visibility(
                expression,
                *visibility,
                &format!("{path}.source.derived"),
                package,
                issues,
                0,
            );
            let ty = infer_expression_type(expression, &format!("{path}.source.derived"), None, None, package, issues, 0);
            if ty.as_ref().is_some_and(|ty| !same_type(expected, ty)) {
                issue(issues, "observation_source_type_mismatch", format!("{path}.source"), "derived observation expression does not match the declared value type");
            }
        }
    }
}

fn validate_observation_expression_visibility(
    expression: &RuleExpression,
    view: Visibility,
    path: &str,
    package: &RulePackage,
    issues: &mut Vec<ValidationIssue>,
    depth: u32,
) {
    if depth > package.domain.max_expression_depth {
        return;
    }
    match expression {
        RuleExpression::Field { target, field } => {
            let Some(entity_type) = selector_type(target, None, None, package, path, issues) else { return };
            match package.world.entity_types.get(&entity_type).and_then(|schema| schema.fields.get(field)) {
                Some(schema) if !visibility_can_publish(view, schema.visibility) => issue(
                    issues,
                    "hidden_observation_access",
                    path,
                    "derived observation reads a world field hidden from this viewer",
                ),
                None => issue(issues, "unknown_field", format!("{path}.field"), "derived observation references an undeclared field"),
                _ => {}
            }
        }
        RuleExpression::GlobalField(field) => match package.world.global_fields.get(field) {
            Some(schema) if !visibility_can_publish(view, schema.visibility) => issue(
                issues,
                "hidden_observation_access",
                path,
                "derived observation reads a global field hidden from this viewer",
            ),
            None => issue(issues, "unknown_global_field", path, "derived observation references an undeclared global field"),
            _ => {}
        },
        RuleExpression::AddInteger { left, right }
        | RuleExpression::SubtractInteger { left, right }
        | RuleExpression::AddFixed { left, right }
        | RuleExpression::Equal { left, right }
        | RuleExpression::LessThan { left, right } => {
            validate_observation_expression_visibility(left, view, &format!("{path}.left"), package, issues, depth + 1);
            validate_observation_expression_visibility(right, view, &format!("{path}.right"), package, issues, depth + 1);
        }
        RuleExpression::And(items) | RuleExpression::Or(items) => {
            for (index, item) in items.iter().enumerate() {
                validate_observation_expression_visibility(item, view, &format!("{path}[{index}]"), package, issues, depth + 1);
            }
        }
        RuleExpression::Not(inner) => validate_observation_expression_visibility(inner, view, &format!("{path}.value"), package, issues, depth + 1),
        RuleExpression::Literal(_) | RuleExpression::IntentArgument(_) => {}
        RuleExpression::CurrentTick => {}
    }
}

fn visibility_can_publish(view: Visibility, field: Visibility) -> bool {
    match (view, field) {
        (_, Visibility::Internal) => false,
        (Visibility::Internal, _) => false,
        (Visibility::Public, Visibility::Public) => true,
        (Visibility::OwningSide, Visibility::Public | Visibility::OwningSide) => true,
        (Visibility::EnemyVisible, Visibility::Public | Visibility::EnemyVisible) => true,
        (Visibility::Public, _) => false,
        _ => false,
    }
}

fn world_entity_selector_type(selector: &WorldEntitySelector, package: &RulePackage) -> Option<TypeId> {
    match selector {
        WorldEntitySelector::Fixed(entity_id) => package
            .world_initialization
            .entities
            .iter()
            .find(|projection| matches!(&projection.entity_id, EntityIdProjection::Fixed(id) if id == entity_id))
            .map(|projection| projection.entity_type.clone()),
        WorldEntitySelector::ByProjectionKey { projection_id, entity_type, owner, key } => {
            package.world_initialization.entities.iter().find_map(|projection| {
                if &projection.projection_id != projection_id || &projection.entity_type != entity_type || !owner_matches_projection(*owner, projection) {
                    return None;
                }
                match &projection.entity_id {
                    EntityIdProjection::ConstantKey(value) if key == &DomainValue::String(value.clone()) => Some(entity_type.clone()),
                    _ => None,
                }
            })
        }
    }
}

fn owner_matches_projection(owner: EntityOwnerSelector, projection: &EntityProjection) -> bool {
    match owner {
        EntityOwnerSelector::Any => true,
        EntityOwnerSelector::OwnSide | EntityOwnerSelector::OtherSide => matches!(projection.owner, EntityOwnerProjection::SnapshotSide),
        EntityOwnerSelector::Unowned => matches!(projection.owner, EntityOwnerProjection::Unowned),
        EntityOwnerSelector::Attacker => matches!(projection.owner, EntityOwnerProjection::Fixed(CombatantSide::Attacker) | EntityOwnerProjection::SnapshotSide),
        EntityOwnerSelector::Defender => matches!(projection.owner, EntityOwnerProjection::Fixed(CombatantSide::Defender) | EntityOwnerProjection::SnapshotSide),
    }
}

fn validate_entity_binding<'a>(
    index: Option<u16>,
    capability: &'a CapabilitySchema,
    path: &str,
    allow_generic: bool,
    issues: &mut Vec<ValidationIssue>,
) -> Option<&'a TypeId> {
    let Some(index) = index else { return None };
    match capability.arguments.get(index as usize).map(|parameter| &parameter.value_type) {
        Some(DomainType::Entity { entity_type: Some(entity_type) })
            if !capability.arguments[index as usize].optional => Some(entity_type),
        Some(DomainType::Entity { entity_type: None }) if allow_generic && !capability.arguments[index as usize].optional => None,
        Some(DomainType::Entity { .. }) => {
            issue(issues, "invalid_capability_binding", path, "bound actor and target arguments must have a concrete, required entity type");
            None
        }
        Some(_) => {
            issue(issues, "invalid_capability_binding", path, "bound actor and target arguments must have an Entity type");
            None
        }
        None => {
            issue(issues, "invalid_capability_binding", path, "actor or target argument index is outside the capability signature");
            None
        }
    }
}

fn configuration_path_type(domain: &DomainSchema, root: &FieldId, path: &[FieldId]) -> Option<DomainType> {
    let mut ty = domain.senkei_configuration.get(root)?.value_type.clone();
    for field in path {
        let DomainType::Record { fields } = ty else { return None };
        ty = fields.get(field)?.clone();
    }
    Some(ty)
}

fn configuration_item_path_type(domain: &DomainSchema, root: &FieldId, path: &[FieldId]) -> Option<DomainType> {
    let root_type = &domain.senkei_configuration.get(root)?.value_type;
    let item_type = match root_type {
        DomainType::List { element, .. } | DomainType::Vector { element, .. } => element.as_ref().clone(),
        _ => return None,
    };
    let DomainType::Record { fields } = item_type else { return None };
    let mut ty = DomainType::Record { fields };
    for field in path {
        let DomainType::Record { fields } = ty else { return None };
        ty = fields.get(field)?.clone();
    }
    Some(ty)
}

fn infer_expression_type_with_observed(
    expression: &RuleExpression,
    path: &str,
    collection: &CollectionSchema,
    package: &RulePackage,
    issues: &mut Vec<ValidationIssue>,
    depth: u32,
) -> Option<DomainType> {
    infer_expression_type_inner(expression, path, None, None, Some(collection), package, issues, depth)
}

fn validate_observation_collection(
    id: &CollectionId,
    collection: &CollectionSchema,
    path: &str,
    package: &RulePackage,
    issues: &mut Vec<ValidationIssue>,
) {
    if id.as_str().is_empty() {
        issue(issues, "invalid_collection", path, "collection IDs cannot be empty");
    }
    if collection.max_items == 0 || collection.max_items > package.domain.max_collection_items {
        issue(issues, "invalid_limit", format!("{path}.max_items"), "collection must have a positive finite item limit within the domain limit");
    }
    let Some(element_schema) = package.world.entity_types.get(&collection.element_type) else {
        issue(issues, "unknown_entity_type", format!("{path}.element_type"), "collection element type is not declared by the world schema");
        return;
    };
    if collection.visibility == Visibility::Internal {
        issue(issues, "hidden_collection_access", format!("{path}.visibility"), "observable collections cannot use internal visibility");
    }
    match &collection.source {
        CollectionSource::WorldEntities { entity_types, owner: _, filter } => {
            if entity_types.len() != 1 || !entity_types.contains(&collection.element_type) {
                issue(issues, "collection_source_type_mismatch", format!("{path}.source.entity_types"), "world entity source must select exactly the declared collection element type");
            }
            for entity_type in entity_types {
                if !package.world.entity_types.contains_key(entity_type) {
                    issue(issues, "unknown_entity_type", format!("{path}.source.entity_types"), "collection source references an unknown entity type");
                }
            }
            if let Some(filter) = filter {
                let ty = infer_expression_type_with_observed(filter, &format!("{path}.source.filter"), collection, package, issues, 0);
                if ty.as_ref().is_some_and(|ty| !is_bool(ty)) {
                    issue(issues, "invalid_collection_filter", format!("{path}.source.filter"), "collection filter must evaluate to boolean");
                }
            }
        }
    }
    for (field_id, observed) in &collection.visible_fields {
        let field_path = format!("{path}.visible_fields.{field_id}");
        validate_type(&observed.value_type, &format!("{field_path}.value_type"), package, issues, 0);
        if observed.visibility == Visibility::Internal || !visibility_can_publish(collection.visibility, observed.visibility) {
            issue(issues, "hidden_collection_field", &field_path, "collection cannot publish a field hidden from this viewer");
        }
        match element_schema.fields.get(field_id) {
            None => issue(issues, "unknown_field", &field_path, "visible collection field is absent from the entity schema"),
            Some(world_field) => {
                if !same_type(&world_field.value_type, &observed.value_type) {
                    issue(issues, "collection_field_type_mismatch", &field_path, "visible field type must match its world entity field");
                }
                if !visibility_can_publish(collection.visibility, world_field.visibility) {
                    issue(issues, "hidden_collection_field", &field_path, "collection exposes a world field that is hidden from this viewer");
                }
            }
        }
        match &observed.source {
            ObservationSource::CurrentEntityField { field } if field == field_id => {}
            ObservationSource::CurrentEntityField { .. } => issue(issues, "collection_field_source_mismatch", format!("{field_path}.source"), "current-entity field source must name the visible field itself"),
            _ => issue(issues, "invalid_collection_field_source", format!("{field_path}.source"), "collection fields must come from the current entity view"),
        }
    }
    let mut order_seen = BTreeSet::new();
    for field_id in &collection.order_by {
        if !order_seen.insert(field_id.clone()) {
            issue(issues, "duplicate_order_field", format!("{path}.order_by"), "collection order fields must be unique");
            continue;
        }
        if !collection.visible_fields.contains_key(field_id) {
            issue(issues, "hidden_order_field", format!("{path}.order_by.{field_id}"), "collection order fields must be visible to the observing side");
            continue;
        }
        if let Some(field) = element_schema.fields.get(field_id) {
            if !orderable(&field.value_type) {
                issue(issues, "invalid_order_type", format!("{path}.order_by.{field_id}"), "collection ordering fields must use an orderable scalar type");
            }
        }
    }
    for unique_key in &collection.unique_keys {
        match unique_key {
            CollectionUniqueKey::EntityId => {}
            CollectionUniqueKey::Fields(fields) => {
                if fields.is_empty() {
                    issue(issues, "invalid_unique_key", format!("{path}.unique_keys"), "field unique keys must contain at least one field");
                }
                for field_id in fields {
                    if !collection.visible_fields.contains_key(field_id) {
                        issue(issues, "hidden_unique_key", format!("{path}.unique_keys.{field_id}"), "unique keys must use fields visible in the collection");
                    }
                    if let Some(field) = element_schema.fields.get(field_id) {
                        if !orderable(&field.value_type) {
                            issue(issues, "invalid_unique_key_type", format!("{path}.unique_keys.{field_id}"), "unique key fields must use scalar types");
                        }
                    }
                }
            }
        }
    }
}

fn validate_phases_and_rules(package: &RulePackage, issues: &mut Vec<ValidationIssue>) {
    if package.phases.is_empty() {
        issue(issues, "missing_phases", "phases", "an execution phase sequence is required");
    }
    let mut phase_ids = BTreeSet::new();
    let mut phase_orders = BTreeSet::new();
    for (index, phase) in package.phases.iter().enumerate() {
        let path = format!("phases[{index}]");
        if phase.id.as_str().is_empty() || !phase_ids.insert(phase.id.clone()) {
            issue(issues, "duplicate_phase", format!("{path}.id"), "phase IDs must be non-empty and unique");
        }
        if !phase_orders.insert(phase.order) {
            issue(issues, "duplicate_order", format!("{path}.order"), "phase orders must define a strict total order");
        }
    }
    let phase_by_id: BTreeMap<_, _> = package.phases.iter().map(|phase| (phase.id.clone(), phase)).collect();
    let mut rules = BTreeSet::new();
    let mut orders = BTreeSet::new();
    let mut used_primitives = BTreeSet::new();
    for (index, rule) in package.transitions.iter().enumerate() {
        let path = format!("transitions[{index}]");
        if rule.id.as_str().is_empty() || !rules.insert(rule.id.clone()) {
            issue(issues, "duplicate_rule", format!("{path}.id"), "transition rule IDs must be non-empty and unique");
        }
        if !phase_by_id.contains_key(&rule.phase) {
            issue(issues, "unknown_phase", format!("{path}.phase"), "transition references an undeclared phase");
        }
        if !orders.insert((rule.phase.clone(), rule.order)) {
            issue(issues, "duplicate_order", format!("{path}.order"), "transition order must be unique within its phase");
        }
        if rule.operations.is_empty() {
            issue(issues, "empty_transition", format!("{path}.operations"), "transition rules must contain at least one operation");
        }
        let capability = rule.capability.as_ref().and_then(|id| {
            package.domain.capabilities.get(id).or_else(|| {
                issue(issues, "unknown_capability", format!("{path}.capability"), "transition references an undeclared capability");
                None
            })
        });
        if let (Some(capability), Some(phase)) = (capability, phase_by_id.get(&rule.phase)) {
            if !capability.phases.contains(&phase.id) {
                issue(issues, "capability_phase_mismatch", format!("{path}.phase"), "capability is not available in the transition phase");
            }
        }
        if let Some(condition) = &rule.when {
            let ty = infer_expression_type(condition, &format!("{path}.when"), capability, Some(rule), package, issues, 0);
            if ty.as_ref().is_some_and(|ty| !is_bool(ty)) {
                issue(issues, "invalid_condition_type", format!("{path}.when"), "transition condition must be boolean");
            }
        }
        for (op_index, operation) in rule.operations.iter().enumerate() {
            let op_path = format!("{path}.operations[{op_index}]");
            used_primitives.insert(operation.kind());
            validate_operation(operation, &op_path, capability, rule, package, issues);
        }
    }
    for primitive in &used_primitives {
        if !package.required_primitives.contains(primitive) {
            issue(issues, "undeclared_primitive", "required_primitives", format!("transition uses primitive {primitive:?} that is not declared as required"));
        }
    }
    for primitive in &package.required_primitives {
        if package.next.is_some() && matches!(primitive, TransitionPrimitiveKind::BattleNavigation|TransitionPrimitiveKind::BattleVision|TransitionPrimitiveKind::BattleSquads|TransitionPrimitiveKind::BattleCombat) { continue; }
        if !package
            .transitions
            .iter()
            .flat_map(|rule| rule.operations.iter())
            .any(|operation| operation.kind() == *primitive)
        {
            issue(issues, "unused_primitive", "required_primitives", format!("required primitive {primitive:?} is never used by a transition"));
        }
    }
    for (capability_id, capability) in &package.domain.capabilities {
        if !package.arbitration.contains_key(capability_id) {
            issue(issues, "missing_arbitration", format!("arbitration.{capability_id}"), "every executable capability requires an explicit arbitration rule");
        }
        if package.next.is_none() && !package.transitions.iter().any(|rule| rule.capability.as_ref() == Some(capability_id)) {
            issue(issues, "missing_transition", format!("domain.capabilities.{capability_id}"), "every capability must have at least one transition rule");
        }
        for phase in &capability.phases {
            if !phase_by_id.contains_key(phase) {
                issue(issues, "unknown_phase", format!("domain.capabilities.{capability_id}.phases"), "capability references an undeclared phase");
            }
        }
    }
}

fn validate_operation(
    operation: &TransitionPrimitive,
    path: &str,
    capability: Option<&CapabilitySchema>,
    rule: &TransitionRule,
    package: &RulePackage,
    issues: &mut Vec<ValidationIssue>,
) {
    match operation {
        TransitionPrimitive::SetField { target, field, value } => {
            let target_type = selector_type(target, capability, Some(rule), package, path, issues);
            let expected = target_type.and_then(|type_id| package.world.entity_types.get(&type_id)).and_then(|entity| entity.fields.get(field));
            if expected.is_none() {
                issue(issues, "unknown_field", format!("{path}.field"), "set-field target does not declare this field");
            } else if !expected.is_some_and(|field| field.writable) {
                issue(issues, "immutable_field", format!("{path}.field"), "transition cannot write a read-only entity field");
            }
            let actual = infer_expression_type(value, &format!("{path}.value"), capability, Some(rule), package, issues, 0);
            if let (Some(expected), Some(actual)) = (expected, actual.as_ref()) {
                if !same_type(&expected.value_type, actual) {
                    issue(issues, "type_mismatch", format!("{path}.value"), "set-field expression type does not match the target field");
                }
            }
        }
        TransitionPrimitive::AddInteger { target, field, amount } => {
            let target_type = selector_type(target, capability, Some(rule), package, path, issues);
            let expected = target_type.and_then(|type_id| package.world.entity_types.get(&type_id)).and_then(|entity| entity.fields.get(field));
            if !expected.is_some_and(|field| field.writable && is_integer(&field.value_type)) {
                issue(issues, "invalid_numeric_field", format!("{path}.field"), "integer addition requires a writable integer entity field");
            }
            require_integer_expression(amount, &format!("{path}.amount"), capability, rule, package, issues);
        }
        TransitionPrimitive::AddFixed { target, field, amount } => {
            let target_type = selector_type(target, capability, Some(rule), package, path, issues);
            let expected = target_type.and_then(|type_id| package.world.entity_types.get(&type_id)).and_then(|entity| entity.fields.get(field));
            if !expected.is_some_and(|field| field.writable && matches!(field.value_type, DomainType::Fixed { .. })) {
                issue(issues, "invalid_numeric_field", format!("{path}.field"), "fixed-point addition requires a writable fixed-point entity field");
            }
            let actual = infer_expression_type(amount, &format!("{path}.amount"), capability, Some(rule), package, issues, 0);
            if !actual.as_ref().is_some_and(|ty| matches!(ty, DomainType::Fixed { .. })) {
                issue(issues, "invalid_numeric_expression", format!("{path}.amount"), "fixed-point addition amount must be fixed point");
            }
        }
        TransitionPrimitive::SetGlobalField { field, value } => {
            let expected = package.world.global_fields.get(field);
            if !expected.is_some_and(|field| field.writable) {
                issue(issues, "unknown_or_immutable_field", format!("{path}.field"), "global transition target must exist and be writable");
            }
            let actual = infer_expression_type(value, &format!("{path}.value"), capability, Some(rule), package, issues, 0);
            if let (Some(expected), Some(actual)) = (expected, actual.as_ref()) {
                if !same_type(&expected.value_type, actual) {
                    issue(issues, "type_mismatch", format!("{path}.value"), "global field expression type does not match its schema");
                }
            }
        }
        TransitionPrimitive::AddGlobalInteger { field, amount } => {
            let expected = package.world.global_fields.get(field);
            if !expected.is_some_and(|field| field.writable && is_integer(&field.value_type)) {
                issue(issues, "invalid_numeric_field", format!("{path}.field"), "global integer addition requires a writable integer field");
            }
            require_integer_expression(amount, &format!("{path}.amount"), capability, rule, package, issues);
        }
        TransitionPrimitive::CreateEntity { id: _, entity_type, owner: _, fields } => {
            if let Some(schema) = package.world.entity_types.get(entity_type) {
                for (field_id, expression) in fields {
                    let field_path = format!("{path}.fields.{field_id}");
                    match schema.fields.get(field_id) {
                        None => issue(issues, "unknown_field", &field_path, "created entity field is not declared"),
                        Some(field) => {
                            let actual = infer_expression_type(expression, &field_path, capability, Some(rule), package, issues, 0);
                            if actual.as_ref().is_some_and(|actual| !same_type(&field.value_type, actual)) {
                                issue(issues, "type_mismatch", &field_path, "created entity value does not match its field schema");
                            }
                        }
                    }
                }
                for (field_id, field) in &schema.fields {
                    if !fields.contains_key(field_id) && !field.writable {
                        issue(issues, "incomplete_entity", format!("{path}.fields.{field_id}"), "creation must supply every read-only field");
                    }
                }
            } else {
                issue(issues, "unknown_entity_type", format!("{path}.entity_type"), "created entity type is not declared");
            }
        }
        TransitionPrimitive::RemoveEntity { target } => {
            if selector_type(target, capability, Some(rule), package, path, issues).is_none() {
                issue(issues, "invalid_selector", format!("{path}.target"), "remove-entity needs a typed entity selector");
            }
        }
        TransitionPrimitive::AppendCollection { collection, value } => {
            let schema = package.world.collections.get(collection);
            if schema.is_none() {
                issue(issues, "unknown_collection", format!("{path}.collection"), "collection append target is not declared");
            }
            let actual = infer_expression_type(value, &format!("{path}.value"), capability, Some(rule), package, issues, 0);
            let expected = schema.map(|schema| schema.element_type.clone());
            if let (Some(expected), Some(actual)) = (expected.as_ref(), actual.as_ref()) {
                if !same_type(expected, actual) {
                    issue(issues, "type_mismatch", format!("{path}.value"), "appended value does not match the collection element type");
                }
            }
        }
        TransitionPrimitive::RemoveCollectionValue { collection, value } => {
            let schema = package.world.collections.get(collection);
            if schema.is_none() {
                issue(issues, "unknown_collection", format!("{path}.collection"), "collection removal target is not declared");
            }
            let actual = infer_expression_type(value, &format!("{path}.value"), capability, Some(rule), package, issues, 0);
            let expected = schema.map(|schema| schema.element_type.clone());
            if let (Some(expected), Some(actual)) = (expected.as_ref(), actual.as_ref()) {
                if !same_type(expected, actual) {
                    issue(issues, "type_mismatch", format!("{path}.value"), "removed value does not match the collection element type");
                }
            }
        }
        TransitionPrimitive::EmitEvent { event, payload } => {
            let schema = package.presentation.visible_events.get(event);
            if schema.is_none() {
                issue(issues, "undeclared_event", format!("{path}.event"), "emitted event must be declared in the presentation allowlist");
            }
            if let Some(schema) = schema {
                for (field_id, expression) in payload {
                    let field_path = format!("{path}.payload.{field_id}");
                    match schema.payload.get(field_id) {
                        None => issue(issues, "undeclared_event_field", &field_path, "event payload field is not declared"),
                        Some(expected) => {
                            let actual = infer_expression_type(expression, &field_path, capability, Some(rule), package, issues, 0);
                            if actual.as_ref().is_some_and(|actual| !same_type(expected, actual)) {
                                issue(issues, "type_mismatch", &field_path, "event expression does not match the allowlisted payload type");
                            }
                        }
                    }
                }
                for field_id in schema.payload.keys() {
                    if !payload.contains_key(field_id) {
                        issue(issues, "missing_event_field", format!("{path}.payload.{field_id}"), "all declared event payload fields must be supplied");
                    }
                }
            }
        }
        TransitionPrimitive::SetOutcome { outcome, .. } => {
            let actual = infer_expression_type(outcome, &format!("{path}.outcome"), capability, Some(rule), package, issues, 0);
            if !actual.as_ref().is_some_and(|ty| matches!(ty, DomainType::Enum { .. })) {
                issue(issues, "invalid_outcome_type", format!("{path}.outcome"), "outcome expressions must be a typed enum");
            }
        }
    }
}

fn validate_arbitration(package: &RulePackage, issues: &mut Vec<ValidationIssue>) {
    for capability_id in package.arbitration.keys() {
        if !package.domain.capabilities.contains_key(capability_id) {
            issue(issues, "unknown_capability", format!("arbitration.{capability_id}"), "arbitration refers to an undeclared capability");
        }
    }
    for (capability_id, rule) in &package.arbitration {
        let path = format!("arbitration.{capability_id}");
        if rule.conflict_keys.is_empty() {
            issue(issues, "missing_conflict_key", format!("{path}.conflict_keys"), "arbitration requires at least one explicit conflict key");
        }
        let mut keys = BTreeSet::new();
        for key in &rule.conflict_keys {
            if !keys.insert(key.clone()) {
                issue(issues, "duplicate_conflict_key", format!("{path}.conflict_keys"), "conflict keys must be unique");
            }
            validate_intent_key(key, capability_id, &format!("{path}.conflict_keys"), package, issues);
        }
        match &rule.resolution {
            ArbitrationResolution::AllowAll { max_accepted } => {
                if *max_accepted == 0 || *max_accepted > package.limits.max_intents_per_side_per_tick {
                    issue(issues, "invalid_limit", format!("{path}.resolution"), "AllowAll must declare a positive acceptance limit within the intent cap");
                }
            }
            ArbitrationResolution::RejectConflicts => {}
            ArbitrationResolution::SelectOrdered { sort_by, max_accepted } => {
                if sort_by.is_empty() {
                    issue(issues, "missing_arbitration_order", format!("{path}.resolution.sort_by"), "ordered arbitration requires an explicit stable ordering");
                }
                let mut sort_keys = BTreeSet::new();
                for term in sort_by {
                    if !sort_keys.insert(term.key.clone()) {
                        issue(issues, "duplicate_arbitration_key", format!("{path}.resolution.sort_by"), "arbitration sort keys must be unique");
                    }
                    validate_intent_key(&term.key, capability_id, &format!("{path}.resolution.sort_by"), package, issues);
                }
                if *max_accepted == 0 || *max_accepted > package.limits.max_intents_per_side_per_tick {
                    issue(issues, "invalid_limit", format!("{path}.resolution"), "ordered arbitration must declare a positive acceptance limit within the intent cap");
                }
            }
        }
    }
}

fn validate_intent_key(key: &IntentKey, capability_id: &CapabilityId, path: &str, package: &RulePackage, issues: &mut Vec<ValidationIssue>) {
    let Some(capability) = package.domain.capabilities.get(capability_id) else { return };
    if let IntentKey::Argument(index) = key {
        if *index as usize >= capability.arguments.len() {
            issue(issues, "invalid_intent_key", path, format!("argument key {index} is outside the capability signature"));
        }
    }
}

fn validate_costs(package: &RulePackage, issues: &mut Vec<ValidationIssue>) {
    let schedule = &package.cost_schedule;
    if schedule.id.as_str().is_empty() || schedule.version == Version::default() {
        issue(issues, "invalid_cost_schedule", "cost_schedule", "cost schedule requires a stable ID and nonzero version");
    }
    if schedule.operations.is_empty() {
        issue(issues, "empty_cost_schedule", "cost_schedule.operations", "cost schedule must declare operation costs");
    }
    if schedule.per_tick_budget.0 == 0 || !schedule.per_tick_budget.is_json_safe() {
        issue(issues, "invalid_cu_budget", "cost_schedule.per_tick_budget", "per-tick CU budget must be positive and JavaScript-safe");
    }
    if schedule.per_match_budget.0 == 0 || !schedule.per_match_budget.is_json_safe() || schedule.per_tick_budget.0 > schedule.per_match_budget.0 {
        issue(issues, "invalid_cu_budget", "cost_schedule.per_match_budget", "per-match CU budget must be safe and at least as large as the per-tick budget");
    }
    for (id, cost) in &schedule.operations {
        if id.as_str().is_empty() {
            issue(issues, "invalid_cost_operation", "cost_schedule.operations", "cost operation IDs cannot be empty");
        }
        if cost.base > LogicalCu::MAX_SAFE_JSON_INTEGER || cost.per_item > LogicalCu::MAX_SAFE_JSON_INTEGER {
            issue(issues, "unsafe_cu_value", format!("cost_schedule.operations.{id}"), "individual CU charges must fit the safe JSON integer range");
        }
        if cost.base == 0 && cost.per_item == 0 {
            issue(issues, "zero_cost_operation", format!("cost_schedule.operations.{id}"), "each declared operation must have a positive base or per-item charge");
        }
    }
    for required in [
        "jinrei.path_read",
        "jinrei.comparison",
        "jinrei.arithmetic",
        "jinrei.logic",
        "jinrei.state_reference",
        "jinrei.collection_iteration",
        "jinrei.aggregate",
        "jinrei.memory_read",
        "jinrei.memory_write",
        "jinrei.capability_issue",
    ] {
        if !schedule.operations.contains_key(&CostOperationId::new(required)) {
            issue(issues, "missing_cost_operation", format!("cost_schedule.operations.{required}"), "the complete Jinrei logical operation price table is required");
        }
    }
    for (capability_id, capability) in &package.domain.capabilities {
        if !schedule.operations.contains_key(&capability.issue_cost) {
            issue(issues, "missing_cost_operation", format!("domain.capabilities.{capability_id}.issue_cost"), "capability issue cost is absent from the cost schedule");
        }
    }
}

fn validate_presentation(package: &RulePackage, issues: &mut Vec<ValidationIssue>) {
    for (event, schema) in &package.presentation.visible_events {
        if event.as_str().is_empty() {
            issue(issues, "invalid_event", "presentation.visible_events", "event IDs cannot be empty");
        }
        for (field, ty) in &schema.payload {
            validate_type(ty, &format!("presentation.visible_events.{event}.payload.{field}"), package, issues, 0);
        }
    }
    for (type_id, visible_fields) in &package.presentation.visible_entity_fields {
        let Some(entity) = package.world.entity_types.get(type_id) else {
            issue(issues, "unknown_entity_type", format!("presentation.visible_entity_fields.{type_id}"), "presentation refers to an unknown entity type");
            continue;
        };
        for field_id in visible_fields {
            match entity.fields.get(field_id) {
                None => issue(issues, "unknown_field", format!("presentation.visible_entity_fields.{type_id}.{field_id}"), "visible field is not present on the entity type"),
                Some(field) if field.visibility == Visibility::Internal => issue(issues, "hidden_presentation_field", format!("presentation.visible_entity_fields.{type_id}.{field_id}"), "internal fields cannot be allowlisted for public presentation"),
                _ => {}
            }
        }
    }
    for field_id in &package.presentation.visible_global_fields {
        match package.world.global_fields.get(field_id) {
            None => issue(issues, "unknown_field", format!("presentation.visible_global_fields.{field_id}"), "visible global field is not present in the world schema"),
            Some(field) if field.visibility == Visibility::Internal => issue(issues, "hidden_presentation_field", format!("presentation.visible_global_fields.{field_id}"), "internal fields cannot be allowlisted for public presentation"),
            _ => {}
        }
    }
}

fn validate_termination(package: &RulePackage, issues: &mut Vec<ValidationIssue>) {
    if package.next.is_none() && package.termination.conditions.is_empty() {
        issue(issues, "missing_termination", "termination.conditions", "at least one ordered termination condition is required");
    }
    let mut orders = BTreeSet::new();
    for (index, condition) in package.termination.conditions.iter().enumerate() {
        let path = format!("termination.conditions[{index}]");
        if !orders.insert(condition.order) {
            issue(issues, "duplicate_order", format!("{path}.order"), "termination conditions must have a strict explicit order");
        }
        let ty = infer_expression_type(&condition.when, &format!("{path}.when"), None, None, package, issues, 0);
        if ty.as_ref().is_some_and(|ty| !is_bool(ty)) {
            issue(issues, "invalid_condition_type", format!("{path}.when"), "termination condition must evaluate to boolean");
        }
    }
}

fn validate_type(ty: &DomainType, path: &str, package: &RulePackage, issues: &mut Vec<ValidationIssue>, depth: u32) {
    if depth > package.domain.max_expression_depth {
        issue(issues, "type_depth_limit", path, "type schema exceeds the package depth limit");
        return;
    }
    match ty {
        DomainType::Bool => {}
        DomainType::Integer { min, max } | DomainType::Fixed { min, max, .. } => {
            if let (Some(min), Some(max)) = (min, max) {
                if min > max {
                    issue(issues, "invalid_range", path, "numeric minimum cannot exceed its maximum");
                }
                if min.unsigned_abs() > LogicalCu::MAX_SAFE_JSON_INTEGER || max.unsigned_abs() > LogicalCu::MAX_SAFE_JSON_INTEGER {
                    issue(issues, "unsafe_numeric_bound", path, "numeric schema bounds must fit JavaScript's safe integer range");
                }
            } else {
                issue(issues, "unbounded_numeric_type", path, "integer and fixed-point values require both finite minimum and maximum bounds");
            }
            if let DomainType::Fixed { scale, .. } = ty {
                if *scale > 18 {
                    issue(issues, "invalid_scale", path, "fixed-point scale cannot exceed 18 decimal places");
                }
            }
        }
        DomainType::String { max_bytes } => {
            if *max_bytes == 0 || *max_bytes > 1_000_000 {
                issue(issues, "invalid_limit", path, "string byte limits must be finite and between 1 and 1,000,000");
            }
        }
        DomainType::Enum { domain, values } => {
            if values.is_empty() {
                issue(issues, "empty_enum", path, "enum types must declare at least one value");
            }
            match package.domain.symbol_domains.get(domain) {
                None => issue(issues, "unknown_symbol_domain", path, "enum type references an undeclared symbol domain"),
                Some(declared) if declared != values => issue(issues, "symbol_domain_mismatch", path, "enum values must match their declared symbol domain exactly"),
                _ => {}
            }
        }
        DomainType::Entity { entity_type } => {
            if let Some(entity_type) = entity_type {
                if !package.world.entity_types.contains_key(entity_type) {
                    issue(issues, "unknown_entity_type", path, "entity type is not declared by the world schema");
                }
            }
        }
        DomainType::Optional(inner) => validate_type(inner, path, package, issues, depth + 1),
        DomainType::List { element, max_items } | DomainType::Vector { element, max_items } => {
            if *max_items == 0 || *max_items > package.domain.max_collection_items {
                issue(issues, "invalid_limit", path, "list/vector size must have a positive finite bound within the domain limit");
            }
            validate_type(element, path, package, issues, depth + 1);
        }
        DomainType::Matrix { element, max_rows, max_columns } => {
            if *max_rows == 0 || *max_columns == 0 || *max_rows > package.domain.max_collection_items || *max_columns > package.domain.max_collection_items {
                issue(issues, "invalid_limit", path, "matrix dimensions must be positively bounded within the domain limit");
            }
            validate_type(element, path, package, issues, depth + 1);
        }
        DomainType::Record { fields } => {
            for (field_id, field_type) in fields {
                if field_id.as_str().is_empty() {
                    issue(issues, "invalid_field", path, "record field IDs cannot be empty");
                }
                validate_type(field_type, &format!("{path}.{field_id}"), package, issues, depth + 1);
            }
        }
    }
}

fn validate_value(value: &DomainValue, ty: &DomainType, path: &str, package: &RulePackage, issues: &mut Vec<ValidationIssue>, depth: u32) {
    if depth > package.limits.max_value_depth {
        issue(issues, "value_depth_limit", path, "default value exceeds the package value depth limit");
        return;
    }
    let valid = match (value, ty) {
        (DomainValue::Null, DomainType::Optional(_)) => true,
        (DomainValue::Bool(_), DomainType::Bool) => true,
        (DomainValue::Integer(value), DomainType::Integer { min, max }) => {
            check_integer_bounds(*value, min.as_ref(), max.as_ref(), path, issues);
            true
        }
        (DomainValue::Fixed { coefficient, scale }, DomainType::Fixed { scale: expected, min, max }) => {
            if scale != expected {
                issue(issues, "type_mismatch", path, "fixed-point default uses a different scale than its schema");
            }
            check_integer_bounds(*coefficient, min.as_ref(), max.as_ref(), path, issues);
            true
        }
        (DomainValue::String(value), DomainType::String { max_bytes }) => {
            if value.len() > *max_bytes as usize {
                issue(issues, "value_limit", path, "string default exceeds its UTF-8 byte limit");
            }
            true
        }
        (DomainValue::Enum(symbol), DomainType::Enum { values, .. }) => {
            if !values.contains(symbol) {
                issue(issues, "invalid_enum_value", path, "enum default is not in the declared value set");
            }
            true
        }
        (DomainValue::Entity(_), DomainType::Entity { .. }) => true,
        (DomainValue::List(values), DomainType::List { element, max_items })
        | (DomainValue::List(values), DomainType::Vector { element, max_items }) => {
            if values.len() > *max_items as usize {
                issue(issues, "value_limit", path, "list default exceeds its item limit");
            }
            for (index, item) in values.iter().enumerate() {
                validate_value(item, element, &format!("{path}[{index}]"), package, issues, depth + 1);
            }
            true
        }
        (DomainValue::List(rows), DomainType::Matrix { element, max_rows, max_columns }) => {
            if rows.len() > *max_rows as usize {
                issue(issues, "value_limit", path, "matrix default exceeds its row limit");
            }
            for (row_index, row) in rows.iter().enumerate() {
                let DomainValue::List(columns) = row else {
                    issue(issues, "type_mismatch", format!("{path}[{row_index}]"), "matrix rows must be lists");
                    continue;
                };
                if columns.len() > *max_columns as usize {
                    issue(issues, "value_limit", format!("{path}[{row_index}]"), "matrix row exceeds its column limit");
                }
                for (column_index, item) in columns.iter().enumerate() {
                    validate_value(item, element, &format!("{path}[{row_index}][{column_index}]"), package, issues, depth + 2);
                }
            }
            true
        }
        (DomainValue::Record(values), DomainType::Record { fields }) => {
            for (field_id, value) in values {
                match fields.get(field_id) {
                    Some(field_type) => validate_value(value, field_type, &format!("{path}.{field_id}"), package, issues, depth + 1),
                    None => issue(issues, "unknown_field", format!("{path}.{field_id}"), "record default contains an undeclared field"),
                }
            }
            for field_id in fields.keys() {
                if !values.contains_key(field_id) {
                    issue(issues, "missing_field", format!("{path}.{field_id}"), "record default is missing a declared field");
                }
            }
            true
        }
        (DomainValue::Null, _) => {
            issue(issues, "invalid_null", path, "null is valid only for an optional type");
            false
        }
        _ => {
            issue(issues, "type_mismatch", path, "configuration default does not match its declared type");
            false
        }
    };
    let _ = valid;
}

fn infer_expression_type(
    expression: &RuleExpression,
    path: &str,
    capability: Option<&CapabilitySchema>,
    transition: Option<&TransitionRule>,
    package: &RulePackage,
    issues: &mut Vec<ValidationIssue>,
    depth: u32,
) -> Option<DomainType> {
    infer_expression_type_inner(expression, path, capability, transition, None, package, issues, depth)
}

fn infer_expression_type_inner(
    expression: &RuleExpression,
    path: &str,
    capability: Option<&CapabilitySchema>,
    transition: Option<&TransitionRule>,
    observed_collection: Option<&CollectionSchema>,
    package: &RulePackage,
    issues: &mut Vec<ValidationIssue>,
    depth: u32,
) -> Option<DomainType> {
    if depth > package.domain.max_expression_depth {
        issue(issues, "expression_depth_limit", path, "rule expression exceeds the configured maximum depth");
        return None;
    }
    match expression {
        RuleExpression::CurrentTick => Some(DomainType::Integer {
            min: Some(0),
            max: Some(i64::from(package.termination.max_ticks)),
        }),
        RuleExpression::Literal(value) => Some(type_of_literal(value, package)),
        RuleExpression::IntentArgument(index) => {
            let Some(capability) = capability else {
                issue(issues, "missing_intent_context", path, "intent argument cannot be read by a rule without a capability context");
                return None;
            };
            capability.arguments.get(*index as usize).map(|argument| argument.value_type.clone()).or_else(|| {
                issue(issues, "invalid_intent_argument", path, format!("argument index {index} is outside the capability signature"));
                None
            })
        }
        RuleExpression::Field { target, field } => {
            if matches!(target, EntitySelector::ObservedEntity) {
                let Some(collection) = observed_collection else {
                    issue(issues, "missing_observed_entity_context", path, "observed entity fields can only be read inside a collection filter");
                    return None;
                };
                return collection.visible_fields.get(field).map(|schema| schema.value_type.clone()).or_else(|| {
                    issue(issues, "hidden_collection_field_access", format!("{path}.field"), "collection filter reads a field absent from its visible-field allowlist");
                    None
                });
            }
            let type_id = selector_type(target, capability, transition, package, path, issues)?;
            package.world.entity_types.get(&type_id).and_then(|entity| entity.fields.get(field)).map(|field_schema| {
                if capability.is_some() && !capability_can_read_field(target, capability.unwrap(), field_schema.visibility) {
                    issue(issues, "hidden_capability_precondition", path, "capability expression reads a field hidden from the issuing side");
                }
                field_schema.value_type.clone()
            }).or_else(|| {
                issue(issues, "unknown_field", format!("{path}.field"), "field expression references a field absent from the selected entity type");
                None
            })
        }
        RuleExpression::GlobalField(field) => package.world.global_fields.get(field).map(|field_schema| {
            if capability.is_some() && field_schema.visibility != Visibility::Public {
                issue(issues, "hidden_capability_precondition", path, "capability expression reads a non-public global field");
            }
            field_schema.value_type.clone()
        }).or_else(|| {
            issue(issues, "unknown_global_field", path, "expression references an undeclared global field");
            None
        }),
        RuleExpression::AddInteger { left, right } | RuleExpression::SubtractInteger { left, right } => {
            let left_type = infer_expression_type_inner(left, &format!("{path}.left"), capability, transition, observed_collection, package, issues, depth + 1);
            let right_type = infer_expression_type_inner(right, &format!("{path}.right"), capability, transition, observed_collection, package, issues, depth + 1);
            if !left_type.as_ref().is_some_and(is_integer) || !right_type.as_ref().is_some_and(is_integer) {
                issue(issues, "invalid_arithmetic_type", path, "integer arithmetic requires integer operands");
            }
            left_type
        }
        RuleExpression::AddFixed { left, right } => {
            let left_type = infer_expression_type_inner(left, &format!("{path}.left"), capability, transition, observed_collection, package, issues, depth + 1);
            let right_type = infer_expression_type_inner(right, &format!("{path}.right"), capability, transition, observed_collection, package, issues, depth + 1);
            if !left_type.as_ref().is_some_and(|ty| matches!(ty, DomainType::Fixed { .. })) || !left_type.as_ref().zip(right_type.as_ref()).is_some_and(|(left, right)| same_type(left, right)) {
                issue(issues, "invalid_arithmetic_type", path, "fixed-point addition requires equal fixed-point operand types");
            }
            left_type
        }
        RuleExpression::Equal { left, right } => {
            let left_type = infer_expression_type_inner(left, &format!("{path}.left"), capability, transition, observed_collection, package, issues, depth + 1);
            let right_type = infer_expression_type_inner(right, &format!("{path}.right"), capability, transition, observed_collection, package, issues, depth + 1);
            if left_type.as_ref().zip(right_type.as_ref()).is_some_and(|(left, right)| !same_type(left, right)) {
                issue(issues, "invalid_comparison_type", path, "equality operands must have the same type");
            }
            Some(DomainType::Bool)
        }
        RuleExpression::LessThan { left, right } => {
            let left_type = infer_expression_type_inner(left, &format!("{path}.left"), capability, transition, observed_collection, package, issues, depth + 1);
            let right_type = infer_expression_type_inner(right, &format!("{path}.right"), capability, transition, observed_collection, package, issues, depth + 1);
            if left_type.as_ref().zip(right_type.as_ref()).is_some_and(|(left, right)| !same_type(left, right) || !orderable(left)) {
                issue(issues, "invalid_comparison_type", path, "less-than operands must have the same orderable scalar type");
            }
            Some(DomainType::Bool)
        }
        RuleExpression::And(items) | RuleExpression::Or(items) => {
            if items.is_empty() {
                issue(issues, "empty_logic", path, "logical expressions must have at least one operand");
            }
            for (index, item) in items.iter().enumerate() {
                let ty = infer_expression_type_inner(item, &format!("{path}[{index}]"), capability, transition, observed_collection, package, issues, depth + 1);
                if ty.as_ref().is_some_and(|ty| !is_bool(ty)) {
                    issue(issues, "invalid_logic_type", format!("{path}[{index}]"), "logical operands must be boolean");
                }
            }
            Some(DomainType::Bool)
        }
        RuleExpression::Not(inner) => {
            let ty = infer_expression_type_inner(inner, &format!("{path}.value"), capability, transition, observed_collection, package, issues, depth + 1);
            if ty.as_ref().is_some_and(|ty| !is_bool(ty)) {
                issue(issues, "invalid_logic_type", path, "not operand must be boolean");
            }
            Some(DomainType::Bool)
        }
    }
}

fn capability_can_read_field(selector: &EntitySelector, capability: &CapabilitySchema, visibility: Visibility) -> bool {
    match visibility {
        Visibility::Public => true,
        Visibility::Internal => false,
        Visibility::OwningSide => match selector {
            EntitySelector::IntentActor => capability.actor_argument.is_some(),
            EntitySelector::IntentTarget => capability.target_owner == TargetOwnerConstraint::OwnSide,
            EntitySelector::ByIntentArgument(index) => {
                capability.actor_argument == Some(*index)
                    || (capability.target_argument == Some(*index) && capability.target_owner == TargetOwnerConstraint::OwnSide)
            }
            _ => false,
        },
        Visibility::EnemyVisible => match selector {
            EntitySelector::IntentTarget => capability.target_owner == TargetOwnerConstraint::OtherSide,
            EntitySelector::ByIntentArgument(index) => {
                capability.target_argument == Some(*index) && capability.target_owner == TargetOwnerConstraint::OtherSide
            }
            _ => false,
        },
    }
}

fn selector_type(
    selector: &EntitySelector,
    capability: Option<&CapabilitySchema>,
    transition: Option<&TransitionRule>,
    package: &RulePackage,
    path: &str,
    issues: &mut Vec<ValidationIssue>,
) -> Option<TypeId> {
    match selector {
        EntitySelector::IntentActor => {
            let Some(capability) = capability else {
                issue(issues, "missing_intent_context", path, "intent actor selector requires a capability context");
                return None;
            };
            capability.actor_argument.and_then(|index| entity_argument_type(capability, index, path, issues)).or_else(|| {
                issue(issues, "unbound_intent_actor", path, "capability does not declare a primary actor binding");
                None
            })
        }
        EntitySelector::IntentTarget => {
            let Some(capability) = capability else {
                issue(issues, "missing_intent_context", path, "intent target selector requires a capability context");
                return None;
            };
            capability.target_argument.and_then(|index| entity_argument_type(capability, index, path, issues)).filter(|type_id| {
                if capability.target_type.as_ref().is_some_and(|declared| declared != type_id) {
                    issue(issues, "target_type_mismatch", path, "capability target binding disagrees with its target_type");
                    false
                } else {
                    true
                }
            }).or_else(|| {
                issue(issues, "unbound_intent_target", path, "capability does not declare a typed primary entity");
                None
            })
        }
        EntitySelector::ByIntentArgument(index) => {
            let Some(capability) = capability else {
                issue(issues, "missing_intent_context", path, "intent argument selector requires a capability context");
                return None;
            };
            entity_argument_type(capability, *index, path, issues)
        }
        EntitySelector::ObservedEntity => {
            issue(issues, "missing_observed_entity_context", path, "observed entity selector is only valid inside a collection filter");
            None
        }
        EntitySelector::Fixed(id) => {
            if transition.is_some_and(|rule| rule.capability.is_some()) {
                issue(issues, "fixed_entity_in_capability", path, "capability transitions cannot depend on a fixed match entity");
            }
            package.world_initialization.entities.iter().find_map(|projection| {
                matches!(&projection.entity_id, EntityIdProjection::Fixed(projected_id) if projected_id == id)
                    .then(|| projection.entity_type.clone())
            }).or_else(|| {
                issue(issues, "unknown_fixed_entity", path, "fixed entity selector is not produced by initial world projection");
                None
            })
        }
        EntitySelector::ByProjectionKey { projection_id, entity_type, owner, key } => {
            package.world_initialization.entities.iter().find_map(|projection| {
                if &projection.projection_id != projection_id || &projection.entity_type != entity_type || !owner_matches_projection(*owner, projection) {
                    return None;
                }
                let key_type = match &projection.entity_id {
                    EntityIdProjection::ConstantKey(value) => {
                        if key != &DomainValue::String(value.clone()) { return None; }
                        Some(DomainType::String { max_bytes: value.len() as u32 })
                    }
                    EntityIdProjection::ConfigurationKey { root, path } => configuration_path_type(&package.domain, root, path),
                    EntityIdProjection::ConfigurationItemKey { path } => match &projection.source {
                        EntityProjectionSource::EachConfigurationItem { field } => configuration_item_path_type(&package.domain, field, path),
                        EntityProjectionSource::Singleton => None,
                    },
                    EntityIdProjection::Fixed(_) => return None,
                };
                let key_matches = key_type.as_ref().is_some_and(|ty| {
                    let mut key_issues = Vec::new();
                    validate_value(key, ty, path, package, &mut key_issues, 0);
                    key_issues.is_empty()
                });
                key_matches.then(|| projection.entity_type.clone())
            }).or_else(|| {
                issue(issues, "unknown_projection_selector", path, "projection key selector does not match a declared entity projection and key type");
                None
            })
        }
    }
}

fn entity_argument_type(capability: &CapabilitySchema, index: u16, path: &str, issues: &mut Vec<ValidationIssue>) -> Option<TypeId> {
    match capability.arguments.get(index as usize).map(|argument| &argument.value_type) {
        Some(DomainType::Entity { entity_type: Some(type_id) }) => Some(type_id.clone()),
        Some(DomainType::Entity { entity_type: None }) => {
            issue(issues, "unbounded_entity_type", path, "entity intent arguments must declare a concrete entity type");
            None
        }
        Some(_) => {
            issue(issues, "invalid_entity_selector", path, "entity selector argument must have an Entity type");
            None
        }
        None => {
            issue(issues, "invalid_intent_argument", path, format!("argument index {index} is outside the capability signature"));
            None
        }
    }
}

fn require_integer_expression(expression: &RuleExpression, path: &str, capability: Option<&CapabilitySchema>, rule: &TransitionRule, package: &RulePackage, issues: &mut Vec<ValidationIssue>) {
    let ty = infer_expression_type(expression, path, capability, Some(rule), package, issues, 0);
    if ty.as_ref().is_some_and(|ty| !is_integer(ty)) {
        issue(issues, "invalid_numeric_expression", path, "integer addition amount must be an integer");
    }
}

fn type_of_literal(value: &DomainValue, package: &RulePackage) -> DomainType {
    match value {
        DomainValue::Null => DomainType::Optional(Box::new(DomainType::Bool)),
        DomainValue::Bool(_) => DomainType::Bool,
        DomainValue::Integer(value) => DomainType::Integer { min: Some(*value), max: Some(*value) },
        DomainValue::Fixed { coefficient, scale } => DomainType::Fixed { scale: *scale, min: Some(*coefficient), max: Some(*coefficient) },
        DomainValue::String(value) => DomainType::String { max_bytes: value.len() as u32 },
        DomainValue::Enum(symbol) => {
            let domain = package.domain.symbol_domains.iter().find_map(|(domain, values)| values.contains(symbol).then_some(domain.clone())).unwrap_or_else(|| SymbolDomainId::new("unresolved_literal"));
            let values = package.domain.symbol_domains.get(&domain).cloned().unwrap_or_else(|| [symbol.clone()].into_iter().collect());
            DomainType::Enum { domain, values }
        }
        DomainValue::Entity(_) => DomainType::Entity { entity_type: None },
        DomainValue::List(values) => {
            let element = values.first().map(|value| type_of_literal(value, package)).unwrap_or(DomainType::Bool);
            DomainType::List { element: Box::new(element), max_items: values.len() as u32 }
        }
        DomainValue::Record(values) => DomainType::Record { fields: values.iter().map(|(id, value)| (id.clone(), type_of_literal(value, package))).collect() },
    }
}

fn check_integer_bounds(value: i64, min: Option<&i64>, max: Option<&i64>, path: &str, issues: &mut Vec<ValidationIssue>) {
    if min.is_some_and(|min| value < *min) || max.is_some_and(|max| value > *max) {
        issue(issues, "value_out_of_range", path, "value is outside the declared finite numeric bounds");
    }
}

fn is_bool(ty: &DomainType) -> bool { matches!(ty, DomainType::Bool) }
fn is_integer(ty: &DomainType) -> bool { matches!(ty, DomainType::Integer { .. }) }
fn orderable(ty: &DomainType) -> bool { matches!(ty, DomainType::Bool | DomainType::Integer { .. } | DomainType::Fixed { .. } | DomainType::String { .. } | DomainType::Enum { .. } | DomainType::Entity { .. }) }
fn same_type(left: &DomainType, right: &DomainType) -> bool {
    match (left, right) {
        (DomainType::Integer { .. }, DomainType::Integer { .. }) => true,
        (DomainType::Fixed { scale: left, .. }, DomainType::Fixed { scale: right, .. }) => left == right,
        (DomainType::String { .. }, DomainType::String { .. }) => true,
        (DomainType::Enum { domain: left, .. }, DomainType::Enum { domain: right, .. }) => left == right,
        (DomainType::Entity { entity_type: left }, DomainType::Entity { entity_type: right }) => left == right || left.is_none() || right.is_none(),
        (DomainType::Optional(left), DomainType::Optional(right)) => same_type(left, right),
        (left, right) => left == right,
    }
}

fn issue(issues: &mut Vec<ValidationIssue>, code: impl Into<String>, path: impl Into<String>, message: impl Into<String>) {
    issues.push(ValidationIssue::new(code, path, message));
}
