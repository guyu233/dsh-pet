//! Right-click menu data, layout and hit-test — ported from
//! crafter-station/petdex (MIT) crates/petdex-windows/src/popup_menu.rs.

pub const POPUP_MENU_WIDTH: i32 = 212;
pub const POPUP_PADDING_X: i32 = 6;
pub const POPUP_PADDING_Y: i32 = 6;
pub const POPUP_ITEM_HEIGHT: i32 = 32;
pub const POPUP_SEPARATOR_HEIGHT: i32 = 9;

// Command ids (petdex parity).
pub const CMD_OPEN_SETTINGS: usize = 1000;
pub const CMD_CYCLE_STATE: usize = 1001;
pub const CMD_TOGGLE_TOPMOST: usize = 1002;
pub const CMD_RESET_POSITION: usize = 1003;
pub const CMD_QUIT: usize = 1004;
pub const CMD_SHUFFLE_PET: usize = 1005;
pub const CMD_TOGGLE_FOCUS_MODE: usize = 1006;
pub const CMD_SEND_TEST_BUBBLE: usize = 1007;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PopupMenuEntry {
    Item { command_id: usize, label: &'static str, checked: bool },
    Separator,
}

/// The exact petdex default menu, including separators.
pub fn build_default_menu_entries(always_on_top: bool, focus_mode: bool) -> Vec<PopupMenuEntry> {
    use PopupMenuEntry::*;
    vec![
        Item { command_id: CMD_OPEN_SETTINGS, label: "Settings...", checked: false },
        Item { command_id: CMD_SHUFFLE_PET, label: "Shuffle Pet", checked: false },
        Separator,
        Item { command_id: CMD_TOGGLE_TOPMOST, label: "Always on Top", checked: always_on_top },
        Item { command_id: CMD_TOGGLE_FOCUS_MODE, label: "Focus Mode", checked: focus_mode },
        Item { command_id: CMD_SEND_TEST_BUBBLE, label: "Send Test Bubble", checked: false },
        Separator,
        Item { command_id: CMD_CYCLE_STATE, label: "Cycle State", checked: false },
        Item { command_id: CMD_RESET_POSITION, label: "Reset Position", checked: false },
        Separator,
        Item { command_id: CMD_QUIT, label: "Quit dsh-pet", checked: false },
    ]
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PopupItemRect {
    pub left: i32,
    pub top: i32,
    pub right: i32,
    pub bottom: i32,
    pub clickable: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PopupMenuLayout {
    pub width: i32,
    pub height: i32,
    pub rects: Vec<PopupItemRect>,
}

impl PopupMenuLayout {
    pub fn hit_test(&self, x: i32, y: i32) -> Option<usize> {
        if x < 0 || y < 0 || x >= self.width || y >= self.height { return None }
        for (idx, r) in self.rects.iter().enumerate() {
            if r.clickable && x >= r.left && x < r.right && y >= r.top && y < r.bottom {
                return Some(idx)
            }
        }
        None
    }
}

/// Vertical stack layout: items are 32px, separators 9px, 6px padding.
pub fn compute_menu_layout(entries: &[PopupMenuEntry]) -> PopupMenuLayout {
    let mut y = POPUP_PADDING_Y;
    let mut rects = Vec::with_capacity(entries.len());
    for entry in entries {
        let (height, clickable) = match entry {
            PopupMenuEntry::Item { .. } => (POPUP_ITEM_HEIGHT, true),
            PopupMenuEntry::Separator => (POPUP_SEPARATOR_HEIGHT, false),
        };
        rects.push(PopupItemRect {
            left: POPUP_PADDING_X, top: y,
            right: POPUP_MENU_WIDTH - POPUP_PADDING_X, bottom: y + height,
            clickable,
        });
        y += height;
    }
    PopupMenuLayout { width: POPUP_MENU_WIDTH, height: y + POPUP_PADDING_Y, rects }
}

/// Keep the popup inside the work area (petdex compute_popup_origin).
pub const fn compute_popup_origin(
    cursor_x: i32, cursor_y: i32, width: i32, height: i32,
    work_left: i32, work_top: i32, work_right: i32, work_bottom: i32,
) -> (i32, i32) {
    let mut x = cursor_x;
    let mut y = cursor_y;
    let max_x = work_right.saturating_sub(width);
    let max_y = work_bottom.saturating_sub(height);
    if x > max_x { x = max_x }
    if y > max_y { y = max_y }
    if x < work_left { x = work_left }
    if y < work_top { y = work_top }
    (x, y)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn default_menu_has_all_petdex_entries() {
        let e = build_default_menu_entries(true, false);
        assert_eq!(e.len(), 11); // 8 items + 3 separators (petdex parity)
        assert_eq!(e[0], PopupMenuEntry::Item { command_id: CMD_OPEN_SETTINGS, label: "Settings...", checked: false });
        assert_eq!(e[3], PopupMenuEntry::Item { command_id: CMD_TOGGLE_TOPMOST, label: "Always on Top", checked: true });
        assert_eq!(e[10], PopupMenuEntry::Item { command_id: CMD_QUIT, label: "Quit dsh-pet", checked: false });
    }

    #[test]
    fn layout_hit_test_matches_petdex() {
        let e = build_default_menu_entries(true, false);
        let layout = compute_menu_layout(&e);
        // Outside
        assert_eq!(layout.hit_test(-1, 10), None);
        assert_eq!(layout.hit_test(POPUP_MENU_WIDTH, 10), None);
        assert_eq!(layout.hit_test(40, POPUP_PADDING_Y - 1), None);
        // First item
        assert_eq!(layout.hit_test(40, POPUP_PADDING_Y + 10), Some(0));
        // Separator (index 2) is not clickable
        let sep_y = POPUP_PADDING_Y + 2 * POPUP_ITEM_HEIGHT + 4;
        assert_eq!(layout.hit_test(40, sep_y), None);
        // Always on Top (index 3)
        let topmost_y = POPUP_PADDING_Y + 2 * POPUP_ITEM_HEIGHT + POPUP_SEPARATOR_HEIGHT + 12;
        assert_eq!(layout.hit_test(40, topmost_y), Some(3));
        // Quit is the last menu entry (index 10), as in petdex.
        let quit = layout.rects[10];
        assert_eq!(layout.hit_test(quit.left + 10, quit.top + 10), Some(10));
    }

    #[test]
    fn popup_origin_stays_in_work_area() {
        assert_eq!(compute_popup_origin(1900, 1000, 212, 300, 0, 0, 1920, 1080), (1708, 780));
        assert_eq!(compute_popup_origin(-5, -5, 212, 300, 0, 0, 1920, 1080), (0, 0));
    }
}
