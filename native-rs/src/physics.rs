//! Drag physics ported from crafter-station/petdex (MIT)
//! crates/petdex-windows/src/physics.rs. Adapted for DSH.

use crate::core::PetState;

pub const SAMPLE_WINDOW_MS: u64 = 100;
pub const MAX_VELOCITY: f64 = 2600.0;
pub const THROW_THRESHOLD: f64 = 85.0;
pub const STOP_THRESHOLD: f64 = 18.0;
pub const DAMPING_BASE: f64 = 0.06;
pub const RESTITUTION: f64 = -0.58;

#[derive(Debug, Clone, Copy)]
struct DragSample { x: f64, y: f64, time_ms: u64 }

#[derive(Debug, Clone)]
pub struct PhysicsStep {
    pub x: f64,
    pub y: f64,
    pub suggested_state: Option<PetState>,
    pub finished: bool,
}

#[derive(Debug, Clone)]
pub struct PetPhysics {
    samples: Vec<DragSample>,
    vx: f64,
    vy: f64,
    throwing: bool,
}

impl Default for PetPhysics { fn default() -> Self { Self::new() } }

impl PetPhysics {
    pub fn new() -> Self {
        Self { samples: Vec::with_capacity(16), vx: 0.0, vy: 0.0, throwing: false }
    }
    pub fn is_throwing(&self) -> bool { self.throwing }
    pub fn stop(&mut self) {
        self.samples.clear(); self.vx = 0.0; self.vy = 0.0; self.throwing = false;
    }

    pub fn begin_drag(&mut self, x: f64, y: f64, now_ms: u64) {
        self.samples.clear(); self.vx = 0.0; self.vy = 0.0; self.throwing = false;
        self.samples.push(DragSample { x, y, time_ms: now_ms });
    }

    pub fn update_drag(&mut self, x: f64, y: f64, now_ms: u64) -> Option<PetState> {
        self.samples.push(DragSample { x, y, time_ms: now_ms });
        self.trim_samples(now_ms);
        let (vx, vy) = self.sample_velocity()?;
        if vy.abs() > 220.0 { return Some(PetState::Jumping) }
        if vx > 140.0 { return Some(PetState::RunningRight) }
        if vx < -140.0 { return Some(PetState::RunningLeft) }
        None
    }

    pub fn end_drag(&mut self, x: f64, y: f64, now_ms: u64) -> bool {
        self.samples.push(DragSample { x, y, time_ms: now_ms });
        self.trim_samples(now_ms);
        let velocity = self.sample_velocity();
        self.samples.clear();
        let Some((raw_vx, raw_vy)) = velocity else {
            self.vx = 0.0; self.vy = 0.0; self.throwing = false; return false;
        };
        let clamped_vx = raw_vx.clamp(-MAX_VELOCITY, MAX_VELOCITY);
        let clamped_vy = raw_vy.clamp(-MAX_VELOCITY, MAX_VELOCITY);
        if clamped_vx.hypot(clamped_vy) > THROW_THRESHOLD {
            self.vx = clamped_vx; self.vy = clamped_vy; self.throwing = true; true
        } else {
            self.vx = 0.0; self.vy = 0.0; self.throwing = false; false
        }
    }

    /// Step the throw; bounce off work-area edges with petdex restitution.
    pub fn step(
        &mut self, dt_sec: f64, x: f64, y: f64,
        width: i32, height: i32,
        work: (i32, i32, i32, i32),
    ) -> PhysicsStep {
        if !self.throwing || dt_sec <= 0.0 || !dt_sec.is_finite() {
            return PhysicsStep { x, y, suggested_state: None, finished: !self.throwing };
        }
        let mut nx = x + self.vx * dt_sec;
        let mut ny = y + self.vy * dt_sec;
        let damping = DAMPING_BASE.powf(dt_sec);
        self.vx *= damping; self.vy *= damping;

        let (left, top, right, bottom) = work;
        let min_x = left as f64;
        let max_x = (right - width.max(0)).max(left) as f64;
        let min_y = top as f64;
        let max_y = (bottom - height.max(0)).max(top) as f64;
        if nx < min_x { nx = min_x; if self.vx < 0.0 { self.vx *= RESTITUTION } }
        else if nx > max_x { nx = max_x; if self.vx > 0.0 { self.vx *= RESTITUTION } }
        if ny < min_y { ny = min_y; if self.vy < 0.0 { self.vy *= RESTITUTION } }
        else if ny > max_y { ny = max_y; if self.vy > 0.0 { self.vy *= RESTITUTION } }

        if self.vx.hypot(self.vy) < STOP_THRESHOLD {
            self.vx = 0.0; self.vy = 0.0; self.throwing = false;
            return PhysicsStep { x: nx, y: ny, suggested_state: None, finished: true };
        }
        let suggested = if self.vx > 90.0 { Some(PetState::RunningRight) }
            else if self.vx < -90.0 { Some(PetState::RunningLeft) }
            else if self.vy.abs() > 120.0 { Some(PetState::Jumping) }
            else { None };
        PhysicsStep { x: nx, y: ny, suggested_state: suggested, finished: false }
    }

    fn trim_samples(&mut self, now_ms: u64) {
        let cutoff = now_ms.saturating_sub(SAMPLE_WINDOW_MS);
        while self.samples.len() > 2 && self.samples[0].time_ms < cutoff {
            self.samples.remove(0);
        }
    }

    fn sample_velocity(&self) -> Option<(f64, f64)> {
        if self.samples.len() < 2 { return None }
        let first = *self.samples.first()?;
        let last = *self.samples.last()?;
        let dt_ms = last.time_ms.saturating_sub(first.time_ms);
        if dt_ms == 0 { return None }
        let dt_sec = dt_ms as f64 / 1000.0;
        Some(((last.x - first.x) / dt_sec, (last.y - first.y) / dt_sec))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn fast_drag_suggests_direction() {
        let mut p = PetPhysics::new();
        p.begin_drag(0.0, 0.0, 0);
        assert_eq!(p.update_drag(100.0, 0.0, 100), Some(PetState::RunningRight));
    }
    #[test]
    fn slow_drag_does_not_throw() {
        let mut p = PetPhysics::new();
        p.begin_drag(0.0, 0.0, 0);
        assert!(!p.end_drag(2.0, 0.0, 100));
    }
}
