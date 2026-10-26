import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  LoaderCircle,
  RefreshCw,
  Replace,
  ReplaceAll,
  X,
} from "lucide-react";
import { AppSelect } from "./Controls";
import { extension } from "./model";
import type { Asset, Settings } from "./model";
import { replacementPlan } from "./match-replace";
import { useFilenameSearch } from "./useFilenameSearch";

interface Props {
  assets: Asset[];
  selected: Set<string>;
  settings: Settings;
  roots: Record<string, string>;
  request: { serial: number; replace: boolean };
  onActive: (id: string | undefined) => void;
  onApply: (assets: Asset[], count: number) => void;
  onClose: () => void;
}
export default function FindReplaceBar({
  assets,
  selected,
  settings,
  roots,
  request,
  onActive,
  onApply,
  onClose,
}: Props) {
  const [expanded, setExpanded] = useState(request.replace);
  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [regex, setRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(true);
  const [selection, setSelection] = useState<Set<string> | null>(null);
  const [applyError, setApplyError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const options = { query, replacement, regex, caseSensitive };
  const images = assets
    .filter((a) => !selection || selection.has(a.id))
    .map(({ id, stem, excluded }) => ({ id, stem, excluded }));
  const search = useFilenameSearch(images, options);
  const current = search.matches.find((m) => m.id === search.activeId);
  const currentAsset = assets.find((a) => a.id === search.activeId);
  const plan = useMemo(
    () => replacementPlan(assets, search.matches, settings, roots),
    [assets, search.matches, settings, roots],
  );
  const singlePlan = useMemo(
    () => replacementPlan(assets, current ? [current] : [], settings, roots),
    [assets, current, settings, roots],
  );
  const inputKey = JSON.stringify({
    options,
    selection: selection ? [...selection] : null,
    images,
  });
  useEffect(() => setApplyError(""), [inputKey]);
  useEffect(() => {
    if (request.replace) setExpanded(true);
    const frame = requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.select();
    });
    return () => cancelAnimationFrame(frame);
  }, [request.serial]);
  useEffect(() => {
    onActive(search.activeId);
  }, [search.activeId, onActive]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (
        event.key !== "Escape" ||
        document.querySelector(
          '[role="dialog"],.ui-select-positioner,.ui-popover-positioner',
        )
      )
        return;
      event.preventDefault();
      event.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [onClose]);
  function apply(all: boolean) {
    if (search.pending || search.error) return;
    const next = all ? plan : singlePlan;
    if (next.errors.length) {
      setApplyError(next.errors.slice(0, 3).join(" · "));
      return;
    }
    if (!next.count) return;
    if (!all) search.navigate(1);
    onApply(next.assets, next.count);
  }
  const message = applyError || search.error;
  const excluded = search.matches.filter((m) => m.excluded).length;
  return (
    <section
      className="find-replace-bar"
      aria-label="Find and replace filenames"
      onKeyDown={(event) => {
        if (
          event.key === "Enter" &&
          !event.nativeEvent.isComposing &&
          !(event.target as HTMLElement).closest(
            'button,[role="combobox"],[role="option"]',
          )
        ) {
          event.preventDefault();
          event.stopPropagation();
          search.navigate(event.shiftKey ? -1 : 1);
        }
      }}
    >
      <div className="find-row">
        <button
          className="icon-button"
          aria-label={expanded ? "Hide replacement" : "Show replacement"}
          aria-expanded={expanded}
          title="Toggle replace (Ctrl/Cmd+H)"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        </button>
        <input
          ref={input}
          className="find-input"
          aria-label="Match filename"
          placeholder="Find in filenames"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-invalid={!!search.error}
        />
        <button
          className={`icon-button find-option ${caseSensitive ? "pressed" : ""}`}
          aria-label="Match case"
          aria-pressed={caseSensitive}
          title="Match case"
          onClick={() => setCaseSensitive(!caseSensitive)}
        >
          Aa
        </button>
        <button
          className={`icon-button find-option ${regex ? "pressed" : ""}`}
          aria-label="Use regular expression"
          aria-pressed={regex}
          title="Use regular expression (Unicode JavaScript syntax)"
          onClick={() => setRegex(!regex)}
        >
          .*
        </button>
        <span className="find-count" role="status" aria-live="polite">
          {search.pending ? (
            <LoaderCircle
              className="spin"
              size={13}
              aria-label="Counting matches"
            />
          ) : query ? (
            `${current ? search.matches.indexOf(current) + 1 : 0} of ${search.matches.length}`
          ) : (
            "0 of 0"
          )}
        </span>
        <button
          className="icon-button"
          aria-label="Count matches"
          title="Count matches"
          onClick={search.refresh}
          disabled={!query}
        >
          <RefreshCw size={14} />
        </button>
        <button
          className="icon-button"
          aria-label="Previous matching image"
          title="Previous match (Shift+Enter)"
          disabled={!search.matches.length}
          onClick={() => search.navigate(-1)}
        >
          <ArrowUp size={15} />
        </button>
        <button
          className="icon-button"
          aria-label="Next matching image"
          title="Next match (Enter)"
          disabled={!search.matches.length}
          onClick={() => search.navigate(1)}
        >
          <ArrowDown size={15} />
        </button>
        <button
          className="icon-button"
          aria-label="Close find"
          title="Close (Esc)"
          onClick={onClose}
        >
          <X size={15} />
        </button>
      </div>
      {expanded && (
        <>
          <div className="find-row replace-row">
            <input
              className="find-input"
              aria-label="Replacement filename text"
              placeholder="Replace (empty removes matched text)"
              value={replacement}
              onChange={(e) => setReplacement(e.target.value)}
            />
            <AppSelect
              label="Find and replace scope"
              value={selection ? "selected" : "all"}
              compact
              onValueChange={(value) =>
                setSelection(value === "selected" ? new Set(selected) : null)
              }
              options={[
                { value: "all", label: "All images" },
                {
                  value: "selected",
                  label: `Selected (${selection?.size ?? selected.size})`,
                  disabled: !selected.size && !selection,
                },
              ]}
            />
            <button
              className="icon-button"
              aria-label="Replace current filename"
              title={
                current?.excluded
                  ? "Excluded from batch renaming"
                  : "Replace current filename"
              }
              disabled={
                !current ||
                current.excluded ||
                !singlePlan.count ||
                search.pending ||
                !!search.error
              }
              onClick={() => apply(false)}
            >
              <Replace size={16} />
            </button>
            <button
              className="find-replace-all"
              disabled={!plan.count || search.pending || !!search.error}
              onClick={() => apply(true)}
            >
              <ReplaceAll size={15} /> Replace all ({plan.count})
            </button>
          </div>
          {current && currentAsset && (
            <div
              className="find-preview selectable-text"
              title={`${current.before} → ${current.after}`}
            >
              <span>{current.before}</span>
              <b aria-label="becomes">→</b>
              <span>{current.after || "(empty filename)"}</span>
              <small>.{extension(currentAsset, settings)}</small>
            </div>
          )}
          <p className="find-help">
            {regex
              ? "Regex: $1 and $<name> insert capture groups. "
              : "Replaces all literal occurrences. "}
            Empty Replace removes matched text.
            {excluded > 0
              ? ` ${excluded} excluded image${excluded === 1 ? " is" : "s are"} skipped.`
              : ""}
          </p>
          {!search.pending && plan.count > 0 && plan.errors.length > 0 && (
            <p className="find-error" role="status">
              {plan.errors.slice(0, 2).join(" · ")}
            </p>
          )}
        </>
      )}
      {message && (
        <p className="find-error" role="alert">
          {message}
        </p>
      )}
      {!expanded &&
        query &&
        !search.pending &&
        !search.error &&
        !search.matches.length && (
          <p className="find-help">No matching filenames.</p>
        )}
    </section>
  );
}
