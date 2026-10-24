use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fmt;

macro_rules! string_id {
    ($name:ident) => {
        #[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
        #[serde(transparent)]
        pub struct $name(String);

        impl $name {
            pub fn new(value: impl Into<String>) -> Self {
                Self(value.into())
            }

            pub fn as_str(&self) -> &str {
                &self.0
            }

            pub fn into_string(self) -> String {
                self.0
            }
        }

        impl From<&str> for $name {
            fn from(value: &str) -> Self {
                Self::new(value)
            }
        }

        impl From<String> for $name {
            fn from(value: String) -> Self {
                Self::new(value)
            }
        }

        impl fmt::Display for $name {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                f.write_str(&self.0)
            }
        }
    };
}

string_id!(ActionId);
string_id!(ArtifactId);
string_id!(CapabilityId);
string_id!(CollectionId);
string_id!(CostOperationId);
string_id!(CostScheduleId);
string_id!(DiagnosticCode);
string_id!(EntityId);
string_id!(EventId);
string_id!(FieldId);
string_id!(MatchId);
string_id!(ObservationPath);
string_id!(ParameterId);
string_id!(PhaseId);
string_id!(PrimitiveSetId);
string_id!(ProjectionId);
string_id!(RevisionId);
string_id!(RuleId);
string_id!(RulesetId);
string_id!(ScenarioId);
string_id!(StateId);
string_id!(SymbolDomainId);
string_id!(SymbolId);
string_id!(TypeId);

/// A lowercase hexadecimal SHA-256 digest. The digest is computed from the
/// canonical serialization owned by the producing component.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct ContentDigest(pub String);

impl ContentDigest {
    pub fn new(value: impl Into<String>) -> Self {
        Self(value.into())
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }

    pub fn has_sha256_shape(&self) -> bool {
        self.0.len() == 64
            && self
                .0
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    }
}

impl fmt::Display for ContentDigest {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

/// Derives a per-snapshot entity ID from a schema-declared stable key.
/// Keys are limited to string and entity values to keep ID inputs explicit.
pub fn derive_projected_entity_id(
    ruleset_digest: &ContentDigest,
    projection_id: &ProjectionId,
    entity_type: &TypeId,
    owner: Option<crate::CombatantSide>,
    stable_key: &crate::DomainValue,
) -> Result<EntityId, crate::ApiError> {
    let (key_tag, key_bytes) = match stable_key {
        crate::DomainValue::String(value) => (b"string".as_slice(), value.as_bytes()),
        crate::DomainValue::Entity(value) => (b"entity".as_slice(), value.as_str().as_bytes()),
        _ => {
            return Err(crate::ApiError::new(
                crate::ApiErrorCode::InvalidSnapshot,
                "projected entity keys must be strings or entity IDs",
            ));
        }
    };
    let owner = match owner {
        Some(crate::CombatantSide::Attacker) => b"attacker".as_slice(),
        Some(crate::CombatantSide::Defender) => b"defender".as_slice(),
        None => b"unowned".as_slice(),
    };
    let digest = hash_identity(
        b"senkei.projected-entity.v1",
        &[
            ruleset_digest.as_str().as_bytes(),
            projection_id.as_str().as_bytes(),
            entity_type.as_str().as_bytes(),
            owner,
            key_tag,
            key_bytes,
        ],
    );
    Ok(EntityId::new(format!("prj:{digest}")))
}

/// Derives a battle-created entity ID independent of host order or randomness.
pub fn derive_invocation_entity_id(
    match_id: &MatchId,
    tick: u32,
    side: crate::CombatantSide,
    rule_id: &RuleId,
    accepted_intent_ordinal: u32,
    operation_index: u32,
) -> EntityId {
    let tick = tick.to_be_bytes();
    let intent_ordinal = accepted_intent_ordinal.to_be_bytes();
    let operation_index = operation_index.to_be_bytes();
    let side = match side {
        crate::CombatantSide::Attacker => b"attacker".as_slice(),
        crate::CombatantSide::Defender => b"defender".as_slice(),
    };
    let digest = hash_identity(
        b"senkei.runtime-entity.v1",
        &[
            match_id.as_str().as_bytes(),
            &tick,
            side,
            rule_id.as_str().as_bytes(),
            &intent_ordinal,
            &operation_index,
        ],
    );
    EntityId::new(format!("run:{digest}"))
}

fn hash_identity(namespace: &[u8], parts: &[&[u8]]) -> String {
    let mut hasher = Sha256::new();
    update_length_prefixed(&mut hasher, namespace);
    for part in parts {
        update_length_prefixed(&mut hasher, part);
    }
    let digest = hasher.finalize();
    let mut hex = String::with_capacity(digest.len() * 2);
    for byte in digest {
        use fmt::Write as _;
        let _ = write!(&mut hex, "{byte:02x}");
    }
    hex
}

fn update_length_prefixed(hasher: &mut Sha256, bytes: &[u8]) {
    hasher.update((bytes.len() as u64).to_be_bytes());
    hasher.update(bytes);
}
