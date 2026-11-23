//! Bubble window layout and spring animation — ported from
//! crafter-station/petdex (MIT) crates/petdex-windows/src/bubble_window.rs.

use crate::core::{BubbleEntry, SessionStatus};

pub const DEFAULT_BUBBLE_WIDTH: i32 = 248;
pub const DEFAULT_BUBBLE_HEIGHT: i32 = 72;
pub const DEFAULT_BUBBLE_GAP: i32 = 8;
pub const DECK_MAX_VISIBLE_CARDS: usize = 4;

pub const DECK_CARD_WIDTH: f32 = 248.0;
pub const DECK_CARD_HEIGHT: f32 = 64.0;
pub const DECK_CARD_RADIUS: f32 = 16.0;
pub const DECK_TAIL_HEIGHT: f32 = 8.0;
pub const DECK_LIP_OFFSET: f32 = 2.0;
pub const DECK_EXPANDED_STEP: f32 = 74.0;
pub const DECK_MARGIN_X: f32 = 20.0;
pub const DECK_MARGIN_TOP: f32 = 24.0;
pub const DECK_MARGIN_BOTTOM: f32 = 18.0;

pub const SPRING_STIFFNESS: f32 = 280.0;
pub const SPRING_DAMPING: f32 = 28.0;
pub const SPRING_MAX_SUBSTEP: f32 = 1.0 / 120.0;

#[derive(Debug, Clone, Copy)]
pub struct DeckCardLayout {
    pub index: usize,
    pub y: f32,
    pub scale: f32,
}

/// petdex compute_deck_card_layouts: cards fan upward from the front card.
pub fn compute_deck_card_layouts(count: usize, expand_progress: f32) -> Vec<DeckCardLayout> {
    let visible = count.min(DECK_MAX_VISIBLE_CARDS);
    let t = expand_progress.clamp(0.0, 1.0);
    (0..visible).map(|i| DeckCardLayout {
        index: i,
        y: -(i as f32) * DECK_EXPANDED_STEP * t,
        scale: 1.0 - (i as f32) * 0.04 * t,
    }).collect()
}

/// Full expansion canvas height for a stack of N cards (petdex parity).
pub fn deck_canvas_height(count: usize) -> u32 {
    let visible = count.min(DECK_MAX_VISIBLE_CARDS).max(1);
    (DECK_MARGIN_TOP
        + DECK_CARD_HEIGHT
        + DECK_TAIL_HEIGHT * visible as f32
        + DECK_MARGIN_BOTTOM).round() as u32
}

/// Place a bubble above (or below) the pet, clamped to the work area.
/// Petdex flips below the pet when there isn't room above, with hysteresis.
pub const fn compute_bubble_placement(
    pet_x: i32, pet_y: i32, pet_w: i32, pet_h: i32,
    bubble_w: i32, bubble_h: i32,
    work_left: i32, work_top: i32, work_right: i32, work_bottom: i32,
) -> (i32, i32) {
    let bw = if bubble_w < 1 { 1 } else { bubble_w };
    let bh = if bubble_h < 1 { 1 } else { bubble_h };
    let cx = pet_x + pet_w / 2;
    let mut x = cx - bw / 2;
    // Prefer above the pet.
    let mut y = pet_y - DEFAULT_BUBBLE_GAP - bh;
    // Flip below if there's no room above and there's room below.
    if y < work_top {
        let below = pet_y + pet_h + DEFAULT_BUBBLE_GAP;
        if below + bh <= work_bottom { y = below }
        else { y = work_top }
    }
    // Clamp horizontally.
    if x < work_left { x = work_left }
    let max_x = work_right.saturating_sub(bw);
    if x > max_x { x = max_x }
    // Clamp vertically.
    if y + bh > work_bottom { y = work_bottom - bh }
    if y < work_top { y = work_top }
    (x, y)
}

/// Spring state for expand/collapse animation (petdex BubbleSpringState).
#[derive(Debug, Clone, Copy)]
pub struct BubbleSpring {
    pub value: f32,
    pub velocity: f32,
}

impl BubbleSpring {
    pub fn new() -> Self { Self { value: 0.0, velocity: 0.0 } }

    /// Advance the spring toward `target` with fixed max substeps.
    pub fn step(&mut self, target: f32, dt_sec: f32) {
        if dt_sec <= 0.0 || !dt_sec.is_finite() { return }
        let steps = ((dt_sec / SPRING_MAX_SUBSTEP).ceil() as usize).max(1).min(16);
        let h = dt_sec / steps as f32;
        for _ in 0..steps {
            let accel = SPRING_STIFFNESS * (target - self.value) - SPRING_DAMPING * self.velocity;
            self.velocity += accel * h;
            self.value += self.velocity * h;
        }
        if self.value < 0.0 { self.value = 0.0; self.velocity = 0.0 }
        if self.value > 1.0 { self.value = 1.0; self.velocity = 0.0 }
    }
}

/// Front bubble content summary (petdex BubbleContent).
#[derive(Debug, Clone)]
pub struct BubbleContent {
    pub session_id: String,
    pub title: String,
    pub status: SessionStatus,
    pub extra_count: usize,
}

impl BubbleContent {
    pub fn from_bubbles(bubbles: &[BubbleEntry]) -> Option<Self> {
        let primary = bubbles.first()?;
        Some(Self {
            session_id: primary.session_id.clone(),
            title: primary.title.clone(),
            status: primary.status,
            extra_count: bubbles.len().saturating_sub(1),
        })
    }
    pub fn badge(&self) -> Option<&'static str> { self.status.badge() }
    pub fn summary(&self) -> &'static str { self.status.summary() }
}

/// Status indicator RGB (petdex status_dot_rgb).
pub const fn status_dot_rgb(status: SessionStatus) -> (u8, u8, u8) {
    match status {
        SessionStatus::NeedsInput => (250, 170, 48),   // amber: needs attention
        SessionStatus::Failed => (229, 72, 77),         // red
        SessionStatus::Running => (77, 107, 254),       // brand blue
        SessionStatus::Completed => (72, 187, 120),     // green
        SessionStatus::Idle => (128, 128, 128),         // gray
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn deck_layouts_fan_upward() {
        let layouts = compute_deck_card_layouts(3, 1.0);
        assert_eq!(layouts.len(), 3);
        assert_eq!(layouts[0].y, 0.0);
        assert!(layouts[1].y < 0.0);
        assert!(layouts[2].y < layouts[1].y);
    }
    #[test]
    fn deck_layouts_collapsed_when_not_expanded() {
        let layouts = compute_deck_card_layouts(4, 0.0);
        assert!(layouts.iter().all(|l| l.y == 0.0));
    }
    #[test]
    fn bubble_placement_prefers_above_then_flips() {
        let (x, y) = compute_bubble_placement(100, 300, 192, 208, 248, 72, 0, 0, 1920, 1080);
        assert_eq!(y, 300 - 8 - 72);
        assert_eq!(x, 100 + 96 - 124);
        // No room above -> flip below.
        let (_, y2) = compute_bubble_placement(100, 10, 192, 208, 248, 72, 0, 0, 1920, 1080);
        assert_eq!(y2, 10 + 208 + 8);
    }
    #[test]
    fn spring_converges_to_target() {
        let mut s = BubbleSpring::new();
        for _ in 0..240 { s.step(1.0, 1.0 / 60.0) }
        assert!((s.value - 1.0).abs() < 0.01);
        assert!(s.velocity.abs() < 0.1);
    }
    #[test]
    fn bubble_content_summary() {
        let b = vec![BubbleEntry {
            session_id: "s1".into(), title: "Chat".into(),
            status: SessionStatus::NeedsInput, created_ms: 0, completed_at_ms: 0,
        }];
        let c = BubbleContent::from_bubbles(&b).unwrap();
        assert_eq!(c.badge(), Some("INPUT"));
        assert_eq!(c.summary(), "Waiting for input");
    }
}
