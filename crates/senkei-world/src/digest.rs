use serde::Serialize;
use sha2::{Digest, Sha256};

/// Digest of the canonical topology, metric and terrain simulation projection.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
pub struct WorldLogicDigest(String);

impl WorldLogicDigest {
    pub fn as_str(&self) -> &str {
        &self.0
    }
    pub(crate) fn from_value<T: Serialize>(value: &T) -> Result<Self, serde_json::Error> {
        Ok(Self(hash(b"senkei.world.logic.v1\0", value)?))
    }
}

impl std::fmt::Display for WorldLogicDigest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

/// Digest of coordinates, paths, materials, lighting, regions and foliage.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
pub struct WorldPresentationDigest(String);

impl WorldPresentationDigest {
    pub fn as_str(&self) -> &str {
        &self.0
    }
    pub(crate) fn from_value<T: Serialize>(value: &T) -> Result<Self, serde_json::Error> {
        Ok(Self(hash(b"senkei.world.presentation.v1\0", value)?))
    }
}

impl std::fmt::Display for WorldPresentationDigest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

fn hash<T: Serialize>(domain: &[u8], value: &T) -> Result<String, serde_json::Error> {
    // Compiler outputs use BTreeMap and declaration-ordered structs. serde_json
    // emits stable object keys in this workspace, making this canonical bytes.
    let bytes = serde_json::to_vec(value)?;
    let mut hasher = Sha256::new();
    hasher.update(domain);
    hasher.update(bytes);
    Ok(format!("{:x}", hasher.finalize()))
}

/// Paired identity required to load a logic world with its approved view.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct WorldIdentity {
    pub world_id: String,
    pub schema_version: crate::Version,
    pub compatibility: crate::Compatibility,
    pub validation_profile: Option<crate::ValidationProfileRef>,
    pub logic_digest: WorldLogicDigest,
    pub presentation_digest: WorldPresentationDigest,
}

impl WorldIdentity {
    /// Copy the immutable paired identity into the shared runtime model.
    pub fn to_model_ref(&self) -> senkei_model::WorldIdentityRef {
        let version = |value: crate::Version| senkei_model::Version::new(value.major, value.minor, value.patch);
        senkei_model::WorldIdentityRef {
            world_id: self.world_id.clone(),
            schema_version: version(self.schema_version),
            minimum_compiler: version(self.compatibility.minimum_compiler),
            maximum_compiler_exclusive: self.compatibility.maximum_compiler_exclusive.map(version),
            validation_profile_id: self.validation_profile.as_ref().map(|p| p.id.clone()),
            validation_profile_version: self.validation_profile.as_ref().map(|p| version(p.version)),
            logic_digest: senkei_model::ContentDigest::new(self.logic_digest.as_str()),
            presentation_digest: senkei_model::ContentDigest::new(self.presentation_digest.as_str()),
        }
    }
}
