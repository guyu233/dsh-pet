//! dsh-pet native core — ported from crafter-station/petdex (MIT).
//! Adapted for DeepSeek Harness by guyu233.

pub mod core;
pub mod physics;
pub mod menu;
pub mod bubble;
pub mod catalog;

pub use core::{
    BubbleEntry, FrameOutput, FrameSpec, PetAnimationEngine, PetState,
    SessionStatus, StateDef,
};
pub use physics::{PetPhysics, PhysicsStep};
