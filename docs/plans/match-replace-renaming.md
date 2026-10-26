# Match-and-replace renaming

Status: implemented. The matching engine, cancellable worker, find/replace bar, workspace and comparison navigation, and naming-history integration are in place. Automated tests cover matching, replacement validation, wrapped navigation, and worker cancellation/timeouts. Production builds and frontend tests pass; visual/desktop interaction checks are not part of this automated verification.

## Interface

- Use a compact VS Code-style find widget at the top right inside the workspace, available in grid, list, and comparison views. Keep the image layout and settings accessible.
- Ctrl/Cmd+F opens the widget and focuses/selects the Match input. Repeating the shortcut focuses the existing widget. Prevent the WebView's native page-find action when handling this shortcut; do not hijack it while another modal dialog is active.
- Show Match, case-sensitivity and regex toggles, a current/total image counter (for example 3 of 12), Previous, Next, and Close. Provide a Count matches button to explicitly recalculate; debounce normal query changes and clearly mark pending results.
- Enter moves to the next matching image; Shift+Enter moves to the previous one. Buttons do the same. Follow current display order, wrap at either end, and disable navigation for zero results. Escape closes the widget and returns focus to the workspace.
- Navigating reveals and highlights the current matching card through the existing virtualizer, including when it was not mounted. In comparison mode, navigate the compared image instead. Do not filter, reorder, or replace the collection.
- Keep the active search result separate from selection. Finding an image must not change the selected batch, naming scope, or processing targets, and must not trigger extra processed previews in grid/list mode. Comparison navigation follows its existing preview behavior.
- A disclosure arrow expands Replace beneath Match. Ctrl/Cmd+H opens this expanded state. Permit an empty replacement to remove matched text; an empty replacement is intentional, not a missing required value.
- Provide Replace current and Replace all actions. Show the current before/after filename and the number of changed images before batch application; matched-but-unchanged names do not count as changes. Display extensions separately and keep them unchanged.
- Provide All images and Selected images scopes. Snapshot selected IDs when entering selected scope so search navigation cannot change the scope. Find may navigate excluded images, but replacement skips images excluded from batch renaming and explains why Replace current is unavailable for them.
- Invalidate stale counts and replacement candidates when fields, flags, scope, source names, or exclusions change. Preserve the active result by stable ID when still matched; otherwise choose the next available result consistently. Show No results for a nonempty query with no matches.
- Replacement is always explicit. Enter in Match or Replace navigates matches and never renames files. Provide visible focus, accessible button labels, loading/error states, and live announcements for the match count in both themes.

## Matching rules

- Operate on current output filename stems only, preserving folders, extensions, stable image IDs, and source paths.
- Literal mode replaces every occurrence of the exact Match text. Treat replacement characters such as `$1` literally in this mode.
- Regex mode uses Unicode JavaScript regex syntax without surrounding `/.../`. Replace every match and support replacement tokens such as `$1`, `$<name>`, `$&`, and `$$`. Flags are fixed to global/Unicode, with the Match case toggle controlling case insensitivity. Show validation errors for invalid patterns.
- Make case sensitivity explicit. Reset regex state for every filename so one filename cannot affect the next.
- Handle zero-width regex matches without hanging or repeatedly inserting at the same position. Follow JavaScript Unicode-aware replacement semantics.
- A blank Match field is an inactive search: no matches, no navigation, and no replacement. This follows the find-widget model and avoids implicit insertion into every name. A nonempty regex such as `^` can explicitly prepend text. Empty Replace removes matched text, as confirmed by the user.
- Do not slugify automatically: replacement text should remain as entered, subject to filename validation.

## Implementation

1. Add typed request/result definitions and pure naming logic in `match-replace.ts`. Return matched IDs, changed IDs, candidate names, and validation issues without mutating assets.
2. Run count/review jobs in a dedicated Web Worker. Arbitrary JavaScript regexes can block on pathological inputs; terminate a job on timeout, cancellation, widget close, or a newer request. Display an actionable error and keep the UI responsive. Include request IDs so stale results cannot overwrite current review data.
3. Add `FindReplaceBar.tsx` with Base UI controls and the existing focus styles and themes. Add a focused `useFilenameSearch` hook for query/results, active result ID, wrapped navigation, and worker lifecycle. Keep draft input state out of App's processing settings.
4. Wire shortcuts and the RenamePopover entry point through `App.tsx`. Add an explicit reveal/highlight API to `Workspace.tsx` using its virtualizer, independent of selected IDs. Use the same match IDs for comparison navigation. Reuse one calculation path for Count matches, review, and replacement so counts agree with applied names.
5. Validate the entire candidate export plan, including unchanged images, before applying: empty/unsafe/reserved/overlong stems and case-insensitive duplicate output paths. Show conflicts by image; block the whole operation until resolved.
6. Apply changed stems through the existing `commit(nextAssets)` history boundary. Replace all is one undo entry; each Replace current is its own entry and advances to the next remaining result. Preserve exclusions, selection, settings, folder structure, and processed previews; skip a no-op operation without adding history. Reject stale review snapshots if assets changed before Apply.
7. Keep the work entirely local in React/TypeScript. Rust and filesystem writes do not need changes because naming remains part of the export plan.

## Verification

- Literal text, repeated occurrences, case sensitivity, Unicode, regex metacharacters treated literally, and literal replacement dollar signs.
- Regex capture groups, named groups, escaped characters, invalid flags/patterns, zero-width matches, and empty replacement.
- Blank Match disables search/replacement; nonempty anchors allow explicit insertion; empty Replace removes matches.
- Selected/all scope, excluded images, matched-but-unchanged images, zero matches, and stale counts/reviews.
- Collisions with unchanged files, invalid/reserved/empty names, unchanged extensions and folder structure, and stable IDs.
- Exactly one undo step for Replace all or each Replace current; redo, redo-branch clearing, and no history for no-op/error/cancelled jobs.
- Ctrl/Cmd+F and H, Enter/Shift+Enter, Escape, wrapping, zero results, retained active IDs, and shortcut suppression while dialogs are open.
- Navigation to unmounted cards in both virtualized layouts, comparison navigation, unchanged selection/processing targets, and retained selected-scope IDs.
- Worker timeout and cancellation with a pathological regex; large-list review without rendering every row.
- Keyboard/focus behavior and both themes. Run desktop frontend tests and the production build; Rust is unaffected.

## Ready when

A user can enter literal text or a regex, count matching images, review safe output names, apply them in one undoable operation, and export without modifying originals. The operation stays responsive for large collections and erroneous regexes.
