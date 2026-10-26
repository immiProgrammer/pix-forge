# Match-and-replace renaming

Status: planned. The App component refactor is complete; the feature is not implemented.

## Interface

- Add a Match & replace action in `RenamePopover.tsx` that opens a dedicated Base UI dialog using the existing Modal component.
- Show two inputs: Match and Replace. Permit an empty replacement to remove matched text.
- Add a Regular expression toggle; literal matching is the default. Add case sensitivity (on by default) and regex flag controls with accessible labels and short examples.
- Provide All images and Selected images scopes. Respect the existing Exclude from batch renaming flag and show how many excluded images are skipped.
- Place a Count matches button beside Match. Count images with at least one match, rather than the number of occurrences. Show both matching-image and changed-image counts, since replacing text with itself changes nothing.
- Show a scrollable, virtualized before/after list in display order. Display extensions separately and keep them unchanged.
- Editing either field, flags, scope, source names, or exclusions invalidates the previous count and review. Never display an outdated result as current.
- Apply is explicit. Enter in a field must not apply unreviewed changes; Escape and outside interactions follow existing dialog conventions.

## Matching rules

- Operate on current output filename stems only, preserving folders, extensions, stable image IDs, and source paths.
- Literal mode replaces every occurrence of the exact Match text. Treat replacement characters such as `$1` literally in this mode.
- Regex mode uses JavaScript regex syntax without surrounding `/.../`. Replace every match and support replacement tokens such as `$1`, `$<name>`, `$&`, and `$$`. Show validation errors for invalid patterns or unsupported flags.
- Make case sensitivity explicit. Reset regex state for every filename so one filename cannot affect the next.
- Handle zero-width regex matches without hanging or repeatedly inserting at the same position. Follow JavaScript Unicode-aware replacement semantics.
- Empty Match semantics need the user's decision: replace each entire stem, prepend once, or no operation. This is separate from empty Replace, which always removes matched text. Document and test the chosen rule before implementation; do not accidentally apply JavaScript's implicit empty-string insertion behavior.
- Do not slugify automatically: replacement text should remain as entered, subject to filename validation.

## Implementation

1. Add typed request/result definitions and pure naming logic in `match-replace.ts`. Return matched IDs, changed IDs, candidate names, and validation issues without mutating assets.
2. Run count/review jobs in a dedicated Web Worker. Arbitrary JavaScript regexes can block on pathological inputs; terminate a job on timeout, cancellation, dialog close, or a newer request. Display an actionable error and keep the UI responsive. Include request IDs so stale results cannot overwrite current review data.
3. Add `MatchReplaceDialog.tsx` using Base UI controls and the existing Modal, focus styles, themes, filename presentation, and virtualized-list conventions. Keep its draft state local.
4. Wire the action through `RenamePopover.tsx` and `App.tsx`. Reuse one calculation path for Count matches, review, and Apply so counts agree with applied names.
5. Validate the entire candidate export plan, including unchanged images, before applying: empty/unsafe/reserved/overlong stems and case-insensitive duplicate output paths. Show conflicts by image; block the whole operation until resolved.
6. Apply changed stems through the existing `commit(nextAssets)` history boundary. One batch is one undo entry. Preserve exclusions, selection, settings, folder structure, and processed previews; skip a no-op operation without adding history. Reject stale review snapshots if assets changed before Apply.
7. Keep the work entirely local in React/TypeScript. Rust and filesystem writes do not need changes because naming remains part of the export plan.

## Verification

- Literal text, repeated occurrences, case sensitivity, Unicode, regex metacharacters treated literally, and literal replacement dollar signs.
- Regex capture groups, named groups, escaped characters, invalid flags/patterns, zero-width matches, and empty replacement.
- The agreed empty-Match rule, including empty Match and Replace together.
- Selected/all scope, excluded images, matched-but-unchanged images, zero matches, and stale counts/reviews.
- Collisions with unchanged files, invalid/reserved/empty names, unchanged extensions and folder structure, and stable IDs.
- Exactly one undo step for a batch; redo, redo-branch clearing, and no history for no-op/error/cancelled jobs.
- Worker timeout and cancellation with a pathological regex; large-list review without rendering every row.
- Keyboard/focus behavior and both themes. Run desktop frontend tests and the production build; Rust is unaffected.

## Ready when

A user can enter literal text or a regex, count matching images, review safe output names, apply them in one undoable operation, and export without modifying originals. The operation stays responsive for large collections and erroneous regexes.
