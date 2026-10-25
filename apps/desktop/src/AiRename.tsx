import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  ArrowLeft,
  Copy,
  WandSparkles,
  X,
} from "lucide-react";
import Modal from "./Modal";
import { AppSelect } from "./Controls";
import { aiRenamePrompt, renameManifest, reviewAiMapping } from "./ai-renaming";
import type { Asset, Settings } from "./model";

export default function AiRename({
  assets,
  selected,
  settings,
  roots,
  onApply,
  onClose,
}: {
  assets: Asset[];
  selected: ReadonlySet<string>;
  settings: Settings;
  roots: Record<string, string>;
  onApply: (next: Asset[], count: number) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"prompt" | "mapping">("prompt");
  const [scope, setScope] = useState<"all" | "selected">(
    selected.size ? "selected" : "all",
  );
  const [base, setBase] = useState<"folder" | "custom">("folder");
  const [product, setProduct] = useState("");
  const [instructions, setInstructions] = useState("");
  const [mapping, setMapping] = useState("");
  const [copiedPrompt, setCopiedPrompt] = useState("");
  const [copyError, setCopyError] = useState("");
  const [page, setPage] = useState(0);
  const promptInput = useRef<HTMLTextAreaElement>(null);
  const copyResetTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  useEffect(() => () => clearTimeout(copyResetTimer.current), []);
  const targets = useMemo(() => {
    try {
      const ids =
        scope === "all" ? new Set(assets.map((asset) => asset.id)) : selected;
      return {
        manifest: renameManifest(assets, ids, settings, roots),
        error: "",
      };
    } catch (error) {
      return { manifest: [], error: String((error as Error).message) };
    }
  }, [assets, selected, settings, roots, scope]);
  const prompt = aiRenamePrompt(targets.manifest, {
    base,
    product,
    instructions,
  });
  const copied = copiedPrompt === prompt;
  const review = useMemo(() => {
    if (!mapping.trim() || targets.error) return { plan: undefined, error: "" };
    try {
      return {
        plan: reviewAiMapping(
          mapping,
          targets.manifest,
          assets,
          settings,
          roots,
        ),
        error: "",
      };
    } catch (error) {
      return { plan: undefined, error: (error as Error).message };
    }
  }, [mapping, targets, assets, settings, roots]);
  const plan = review.plan;
  const maxPage = Math.max(0, Math.ceil((plan?.changes.length || 0) / 50) - 1);
  const currentPage = Math.min(page, maxPage);
  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopiedPrompt(prompt);
      clearTimeout(copyResetTimer.current);
      copyResetTimer.current = setTimeout(() => setCopiedPrompt(""), 3000);
      setCopyError("");
    } catch {
      promptInput.current?.focus();
      promptInput.current?.select();
      setCopyError(
        "Copy is unavailable here. The prompt is selected; press Ctrl/Cmd+C to copy it.",
      );
    }
  }
  return (
    <Modal
      className="dialog ai-rename-dialog"
      label="AI rename"
      onClose={onClose}
    >
      <header>
        <h2>
          <WandSparkles size={18} /> AI rename
        </h2>
        <button
          className="icon-button"
          aria-label="Close AI rename"
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </header>
      <div className="ai-rename-fields">
        <label className="field-label">
          Apply to
          <AppSelect
            label="AI naming scope"
            value={scope}
            onValueChange={setScope}
            options={[
              { value: "all", label: `All images (${assets.length})` },
              {
                value: "selected",
                label: `Selected images (${selected.size})`,
                disabled: !selected.size,
              },
            ]}
          />
        </label>
        {tab === "prompt" && (
          <label className="field-label">
            Naming base
            <AppSelect
              label="AI naming base"
              value={base}
              onValueChange={setBase}
              options={[
                { value: "folder", label: "Folder name" },
                { value: "custom", label: "Custom / current names" },
              ]}
            />
          </label>
        )}
      </div>
      <p className="ai-rename-hint">
        {targets.manifest.length} images eligible. Excluded images stay
        unchanged.
      </p>
      {targets.error && (
        <p className="error-note" role="alert">
          {targets.error}
        </p>
      )}
      {tab === "prompt" ? (
        <>
          {base === "custom" && (
            <label className="field-label">
              Product name (optional)
              <input
                value={product}
                placeholder="Leave empty to clean up current names"
                onChange={(event) => {
                  setProduct(event.target.value);
                  setCopiedPrompt("");
                }}
              />
            </label>
          )}
          <label className="field-label">
            Additional instructions (optional)
            <textarea
              rows={3}
              value={instructions}
              placeholder="For example: keep model numbers, use underscores instead of hyphens…"
              onChange={(event) => {
                setInstructions(event.target.value);
                setCopiedPrompt("");
              }}
            />
          </label>
          <div className="field-label">
            <label htmlFor="ai-rename-prompt">Prompt</label>
            <div className="ai-prompt-field">
              <textarea
                id="ai-rename-prompt"
                className="ai-rename-code"
                ref={promptInput}
                rows={10}
                readOnly
                value={prompt}
              />
              <button
                className="ai-prompt-copy"
                aria-label={copied ? "Prompt copied" : "Copy prompt"}
                title={copied ? "Copied" : "Copy prompt"}
                disabled={!targets.manifest.length || !!targets.error}
                onClick={() => void copyPrompt()}
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
              </button>
            </div>
          </div>
          <p className="ai-rename-hint">
            Copy this prompt into your preferred AI tool, then paste its JSON
            response in Import mapping. Only filenames and folder names are
            included; images are not sent.
          </p>
          {copyError && (
            <p className="error-note" role="status">
              {copyError}
            </p>
          )}
        </>
      ) : (
        <>
          <label className="field-label">
            JSON mapping
            <textarea
              className="ai-rename-code"
              rows={8}
              value={mapping}
              spellCheck={false}
              placeholder={'{"folder/source.jpg":"new-product-name"}'}
              onChange={(event) => {
                setMapping(event.target.value);
                setPage(0);
              }}
            />
          </label>
          <p className="ai-rename-hint">
            Match exact source paths. Use filename stems without extensions.
            Order does not matter; omitted paths keep their current names.
          </p>
          {review.error && (
            <p className="error-note" role="alert">
              {review.error}
            </p>
          )}
          {plan && (
            <div className="ai-rename-review">
              <p role="status">
                {plan.matched} matched · {plan.changes.length} changes ·{" "}
                {plan.unchanged} unchanged ({plan.missing} omitted)
              </p>
              <div className="ai-rename-changes">
                {plan.changes
                  .slice(currentPage * 50, (currentPage + 1) * 50)
                  .map((change) => (
                    <div className="ai-rename-change" key={change.id}>
                      <code title={change.path}>{change.path}</code>
                      <span className="selectable-text">
                        {change.before}{" "}
                        <ArrowRight size={12} aria-hidden="true" />{" "}
                        <strong>{change.after}</strong>
                      </span>
                    </div>
                  ))}
              </div>
              {maxPage > 0 && (
                <div className="ai-rename-pagination">
                  <button
                    disabled={currentPage === 0}
                    onClick={() => setPage(currentPage - 1)}
                  >
                    Previous
                  </button>
                  <span>
                    {currentPage + 1} / {maxPage + 1}
                  </span>
                  <button
                    disabled={currentPage === maxPage}
                    onClick={() => setPage(currentPage + 1)}
                  >
                    Next
                  </button>
                </div>
              )}
            </div>
          )}
        </>
      )}
      <footer>
        <button onClick={onClose}>Cancel</button>
        {tab === "prompt" ? (
          <div className="ai-rename-actions">
            <button
              disabled={!targets.manifest.length || !!targets.error}
              onClick={() => void copyPrompt()}
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}{" "}
              {copied ? "Copied" : "Copy prompt"}
            </button>
            <button className="primary" onClick={() => setTab("mapping")}>
              Import mapping <ArrowRight size={14} />
            </button>
          </div>
        ) : (
          <div className="ai-rename-actions">
            <button onClick={() => setTab("prompt")}>
              <ArrowLeft size={14} /> Back to prompt
            </button>
            <button
              className="primary"
              disabled={!plan?.changes.length || !!targets.error}
              onClick={() => {
                if (plan) onApply(plan.next, plan.changes.length);
              }}
            >
              Apply {plan?.changes.length || 0} names
            </button>
          </div>
        )}
      </footer>
    </Modal>
  );
}
