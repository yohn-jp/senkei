use crate::VerifiedWorld;
use senkei_model::WorldIdentityRef;
use std::collections::BTreeMap;

/// In-memory content-addressed resolver for sealed compiler artifacts.
/// Inserting an artifact copies its identity and immutable projections; callers
/// can only resolve an exact paired World reference.
#[derive(Clone, Debug, Default)]
pub struct WorldResolver {
    worlds: BTreeMap<String, VerifiedWorld>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum WorldResolveError {
    MissingWorld,
    IdentityConflict,
    IdentityMismatch,
}

impl std::fmt::Display for WorldResolveError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::MissingWorld => f.write_str("referenced World artifact is not available"),
            Self::IdentityConflict => f.write_str("different World artifacts claim the same paired identity"),
            Self::IdentityMismatch => f.write_str("resolved World does not match the complete requested identity"),
        }
    }
}

impl std::error::Error for WorldResolveError {}

impl WorldResolver {
    pub fn insert(&mut self, world: VerifiedWorld) -> Result<(), WorldResolveError> {
        let key = identity_key(&world.identity().to_model_ref());
        if let Some(existing) = self.worlds.get(&key) {
            if existing != &world {
                return Err(WorldResolveError::IdentityConflict);
            }
            return Ok(());
        }
        self.worlds.insert(key, world);
        Ok(())
    }

    pub fn resolve(&self, reference: &WorldIdentityRef) -> Result<&VerifiedWorld, WorldResolveError> {
        let Some(world) = self.worlds.get(&identity_key(reference)) else {
            let same_named_artifact = self.worlds.values().any(|world| {
                let identity = world.identity().to_model_ref();
                identity.world_id == reference.world_id
                    && identity.schema_version == reference.schema_version
            });
            return Err(if same_named_artifact {
                WorldResolveError::IdentityMismatch
            } else {
                WorldResolveError::MissingWorld
            });
        };
        if world.identity().to_model_ref() != *reference {
            return Err(WorldResolveError::IdentityMismatch);
        }
        Ok(world)
    }
}

fn identity_key(identity: &WorldIdentityRef) -> String {
    // Struct fields and Version values have canonical declaration order.
    serde_json::to_string(identity).expect("WorldIdentityRef is serializable")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn world() -> VerifiedWorld {
        crate::compile_json(include_bytes!("../fixtures/initial-battlefield.json")).unwrap()
    }

    #[test]
    fn resolver_requires_exact_paired_identity_and_never_falls_back() {
        let artifact = world();
        let reference = artifact.identity().to_model_ref();
        let compiler_reference = reference.clone();
        let mut resolver = WorldResolver::default();
        assert_eq!(resolver.resolve(&reference), Err(WorldResolveError::MissingWorld));
        resolver.insert(artifact).unwrap();
        assert!(resolver.resolve(&reference).is_ok());

        let mut mismatch = reference.clone();
        mismatch.presentation_digest = senkei_model::ContentDigest::new("0".repeat(64));
        assert_eq!(resolver.resolve(&mismatch), Err(WorldResolveError::IdentityMismatch));
        let mut compiler_mismatch = compiler_reference;
        compiler_mismatch.compiler_version = senkei_model::Version::new(99, 0, 0);
        assert_eq!(resolver.resolve(&compiler_mismatch), Err(WorldResolveError::IdentityMismatch));
        let mut missing = reference;
        missing.world_id = "another-world".into();
        assert_eq!(resolver.resolve(&missing), Err(WorldResolveError::MissingWorld));
    }
}
