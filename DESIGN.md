# HopeTDL Design System

## 1. Atmosphere & Identity

HopeTDL is a compact desktop operations console: calm, technical, and explicit about risk. Its signature is the persistent command preview, which makes every Telegram operation inspectable before execution.

## 2. Color

| Role | Token | Dark | Light | Usage |
|---|---|---|---|---|
| App surface | `--bg` | `#0f1117` | `#f5f7fa` | Window background |
| Panel surface | `--panel` | `#171a23` | `#ffffff` | Cards and primary panels |
| Raised surface | `--panel2` | `#202432` | `#f7f8fb` | Secondary controls and stats |
| Divider | `--line` | `#2e3445` | `#dcdfe6` | Borders and separators |
| Primary text | `--text` | `#eef1f8` | `#2e3445` | Titles and body copy |
| Secondary text | `--muted` | `#9aa3b8` | `#6c7a96` | Metadata and hints |
| Accent | `--blue` | `#6aa7ff` | `#409eff` | Primary actions and focus |
| Success | `--green` | `#74d99f` | `#67c23a` | Completed states |
| Error | `--red` | `#ff7d7d` | `#f56c6c` | Errors and destructive states |

Raw colors that remain in `src/style.css` are legacy component-state variants derived from these roles. New work extends the token table before adding a color.

## 3. Typography

Primary: `Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif`.

Monospace: `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`.

| Level | Size | Weight | Usage |
|---|---:|---:|---|
| Page title | 25px | 800 | Primary page heading |
| Section title | 16px | 750 | Card heading |
| Body | 14px | 400 | Forms and navigation |
| Caption | 12px | 400-700 | Metadata and logs |
| Micro | 11px | 400-800 | Badges and dense status |

## 4. Spacing & Layout

The base unit is 4px. Common steps are 8, 12, 16, 20, 24, 28, and 32px. The sidebar is 200px; content is capped at 1080px. The application uses a fixed desktop shell with independently scrollable content and log regions.

## 5. Components

### Card

- Structure: titled bordered panel containing a form, status, or history list.
- Spacing: 16-20px outer rhythm and 18px inner padding.
- States: normal and theme-adjusted; interaction belongs to contained controls.
- Accessibility: headings precede controls in source order.

### Command Preview

- Structure: monospace preformatted command block.
- Variants: single command or multi-step annotated workflow.
- States: read-only with selectable text.
- Accessibility: preserves wrapping so long paths remain readable.

### Chat Selector

- Structure: searchable selector plus explicit cache-refresh action.
- States: empty, loading, selected, refresh failure.
- Accessibility: keyboard behavior is provided by Naive UI controls.

### Task Status

- Structure: label, semantic status marker, summary, and contextual actions.
- States: queued, running, success, partial, failed, stopped, interrupted.
- Accessibility: status is expressed in text, never color alone.

## 6. Motion & Interaction

Micro feedback uses 150ms ease transitions; panel changes use 200-300ms. Motion is limited to opacity and transform. Every interactive element keeps visible hover and keyboard-focus feedback, and nonessential motion respects `prefers-reduced-motion`.

## 7. Depth & Surface

Strategy: borders-only. Cards and regions use the `--line` divider over tonal surfaces. Shadows are not introduced for new work; modal depth is delegated to Naive UI's existing overlay system.
