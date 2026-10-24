use serde::{Deserialize, Serialize};
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
