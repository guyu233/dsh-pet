//! Core data types ported from crafter-station/petdex (MIT License).
//! Sources: crates/petdex-core/src/animation.rs and
//! packages/petdex-desktop-native/src/hook_server.zig.
//! Copyright (c) 2026 Crafter Station. Adapted for DSH.

/// Nine-state sprite animation machine (petdex PetState).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[repr(u8)]
pub enum PetState {
    Idle = 0,
    RunningRight = 1,
    RunningLeft = 2,
    Waving = 3,
    Jumping = 4,
    Failed = 5,
    Waiting = 6,
    Running = 7,
    Review = 8,
}

impl PetState {
    pub const COUNT: usize = 9;
    pub const ALL: [PetState; 9] = [
        PetState::Idle, PetState::RunningRight, PetState::RunningLeft,
        PetState::Waving, PetState::Jumping, PetState::Failed,
        PetState::Waiting, PetState::Running, PetState::Review,
    ];

    pub fn from_u8(v: u8) -> Option<Self> {
        if v < 9 { Some(PetState::ALL[v as usize]) } else { None }
    }

    pub fn from_slug(s: &str) -> Option<Self> {
        PetState::ALL.into_iter().find(|p| p.slug() == s)
    }

    pub const fn slug(self) -> &'static str {
        match self {
            PetState::Idle => "idle",
            PetState::RunningRight => "running-right",
            PetState::RunningLeft => "running-left",
            PetState::Waving => "waving",
            PetState::Jumping => "jumping",
            PetState::Failed => "failed",
            PetState::Waiting => "waiting",
            PetState::Running => "running",
            PetState::Review => "review",
        }
    }

    pub const fn next(self) -> Self {
        Self::ALL[(self as usize + 1) % 9]
    }
}

/// Per-frame timing (petdex FrameSpec / sprite.zig).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FrameSpec {
    pub col: u64,
    pub dur_ms: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StateDef {
    pub row: u64,
    pub frames: &'static [FrameSpec],
}

const fn uniform<const N: usize>(dur_ms: u32, last_ms: u32) -> [FrameSpec; N] {
    let mut frames = [FrameSpec { col: 0, dur_ms: 0 }; N];
    let mut i = 0;
    while i < N {
        frames[i] = FrameSpec {
            col: i as u64,
            dur_ms: if i == N - 1 { last_ms } else { dur_ms },
        };
        i += 1;
    }
    frames
}

// Exact timings from petdex packages/petdex-desktop-native/src/sprite.zig.
const IDLE_FRAMES: [FrameSpec; 6] = [
    FrameSpec { col: 0, dur_ms: 280 }, FrameSpec { col: 1, dur_ms: 110 },
    FrameSpec { col: 2, dur_ms: 110 }, FrameSpec { col: 3, dur_ms: 140 },
    FrameSpec { col: 4, dur_ms: 140 }, FrameSpec { col: 5, dur_ms: 320 },
];
const RUN_R_FRAMES: [FrameSpec; 8] = uniform(120, 220);
const RUN_L_FRAMES: [FrameSpec; 8] = uniform(120, 220);
const WAVE_FRAMES: [FrameSpec; 4] = uniform(140, 280);
const JUMP_FRAMES: [FrameSpec; 5] = uniform(140, 280);
const FAILED_FRAMES: [FrameSpec; 8] = uniform(140, 240);
const WAIT_FRAMES: [FrameSpec; 6] = uniform(150, 260);
const RUN_FRAMES: [FrameSpec; 6] = uniform(120, 220);
const REVIEW_FRAMES: [FrameSpec; 6] = uniform(150, 280);

pub const fn state_def(state: PetState) -> StateDef {
    match state {
        PetState::Idle => StateDef { row: 0, frames: &IDLE_FRAMES },
        PetState::RunningRight => StateDef { row: 1, frames: &RUN_R_FRAMES },
        PetState::RunningLeft => StateDef { row: 2, frames: &RUN_L_FRAMES },
        PetState::Waving => StateDef { row: 3, frames: &WAVE_FRAMES },
        PetState::Jumping => StateDef { row: 4, frames: &JUMP_FRAMES },
        PetState::Failed => StateDef { row: 5, frames: &FAILED_FRAMES },
        PetState::Waiting => StateDef { row: 6, frames: &WAIT_FRAMES },
        PetState::Running => StateDef { row: 7, frames: &RUN_FRAMES },
        PetState::Review => StateDef { row: 8, frames: &REVIEW_FRAMES },
    }
}

/// Output frame selection (petdex FrameOutput).
#[derive(Debug, Clone, Copy)]
pub struct FrameOutput {
    pub state: PetState,
    pub row: u64,
    pub col: u64,
    pub frame_index: u32,
    pub frame_dur_ms: u32,
}

/// Animation engine — ported logic from petdex PetAnimationEngine.
#[derive(Debug, Clone)]
pub struct PetAnimationEngine {
    state: PetState,
    frame_index: usize,
    elapsed_ms: u32,
}

impl PetAnimationEngine {
    pub fn new() -> Self {
        Self { state: PetState::Idle, frame_index: 0, elapsed_ms: 0 }
    }

    pub fn with_state(state: PetState) -> Self {
        Self { state, frame_index: 0, elapsed_ms: 0 }
    }

    pub fn state(&self) -> PetState { self.state }

    /// Idempotent for the same state; resets to frame 0 on change.
    pub fn set_state(&mut self, state: PetState) {
        if state != self.state {
            self.state = state;
            self.frame_index = 0;
            self.elapsed_ms = 0;
        }
    }

    pub fn current_frame(&self) -> FrameOutput {
        let def = state_def(self.state);
        let frames = def.frames;
        let idx = self.frame_index.min(frames.len() - 1);
        FrameOutput {
            state: self.state,
            row: def.row,
            col: frames[idx].col,
            frame_index: idx as u32,
            frame_dur_ms: frames[idx].dur_ms,
        }
    }

    /// Advance by elapsed ms; may cross several frames at once.
    pub fn tick(&mut self, delta_ms: u32) -> FrameOutput {
        let frames = state_def(self.state).frames;
        self.elapsed_ms += delta_ms;
        loop {
            let dur = frames[self.frame_index].dur_ms;
            if self.elapsed_ms < dur { break }
            self.elapsed_ms -= dur;
            self.frame_index = (self.frame_index + 1) % frames.len();
        }
        self.current_frame()
    }
}

/// Session status shown in bubbles (petdex SessionStatus).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionStatus {
    Idle,
    NeedsInput,
    Running,
    Completed,
    Failed,
}

impl SessionStatus {
    pub fn badge(self) -> Option<&'static str> {
        match self {
            SessionStatus::NeedsInput => Some("INPUT"),
            SessionStatus::Running => Some("RUNNING"),
            SessionStatus::Completed => Some("DONE"),
            SessionStatus::Failed => Some("FAILED"),
            SessionStatus::Idle => None,
        }
    }
    pub fn summary(self) -> &'static str {
        match self {
            SessionStatus::NeedsInput => "Waiting for input",
            SessionStatus::Failed => "Session failed",
            SessionStatus::Running => "Working...",
            SessionStatus::Completed => "Completed",
            SessionStatus::Idle => "Idle",
        }
    }
}

/// One conversation/task card (concept from petdex hook_server Bubble/BubbleEntry).
#[derive(Debug, Clone)]
pub struct BubbleEntry {
    pub session_id: String,
    pub title: String,
    pub status: SessionStatus,
    pub created_ms: u64,
    pub completed_at_ms: u64,
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn idle_blink_timing_is_exact() {
        let mut e = PetAnimationEngine::new();
        assert_eq!(e.current_frame().col, 0);
        let _ = e.tick(279); assert_eq!(e.current_frame().col, 0);
        let _ = e.tick(1); assert_eq!(e.current_frame().col, 1);
        assert_eq!(e.current_frame().frame_dur_ms, 110);
    }
    #[test]
    fn state_change_resets_frame() {
        let mut e = PetAnimationEngine::new();
        let _ = e.tick(300);
        e.set_state(PetState::Waiting);
        assert_eq!(e.current_frame().row, 6);
        assert_eq!(e.current_frame().frame_index, 0);
    }
}
