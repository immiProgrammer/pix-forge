import type { Dispatch, SetStateAction } from "react";
import {
  ArrowRight,
  CaseLower,
  ChevronDown,
  Folder,
  LockKeyhole,
  Sparkles,
} from "lucide-react";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverTitle,
} from "./Popover";
import { AppSelect } from "./Controls";
import type { NamingAction, NamingOptions } from "./model";

interface Props {
  naming: boolean;
  setNaming: (open: boolean) => void;
  scope: "all" | "selected";
  setScope: (scope: "all" | "selected") => void;
  imageCount: number;
  selectedCount: number;
  namingOptions: NamingOptions;
  setNamingOptions: Dispatch<SetStateAction<NamingOptions>>;
  runNaming: (action: NamingAction) => void;
}

export default function RenamePopover({
  naming,
  setNaming,
  scope,
  setScope,
  imageCount,
  selectedCount,
  namingOptions,
  setNamingOptions,
  runNaming,
}: Props) {
  return (
    <div className="naming-anchor">
      <Popover open={naming} onOpenChange={setNaming}>
        <PopoverTrigger
          className={`text-button ${naming ? "pressed" : ""}`}
          disabled={!imageCount}
        >
          <CaseLower size={18} /> Rename <ChevronDown size={12} />
        </PopoverTrigger>
        <PopoverContent className="naming-popover" align="center">
          <div className="popover-title">
            <PopoverTitle className="rename-title">Batch rename</PopoverTitle>
          </div>
          <label className="field-label">
            Apply to
            <AppSelect<"all" | "selected">
              label="Naming scope"
              value={scope}
              onValueChange={setScope}
              options={[
                {
                  value: "all",
                  label: `All images (${imageCount})`,
                },
                {
                  value: "selected",
                  label: `Selected images (${selectedCount})`,
                },
              ]}
            />
          </label>
          <div className="naming-numbers">
            <label>
              Start at
              <input
                type="number"
                min={0}
                value={namingOptions.start}
                onChange={(e) =>
                  setNamingOptions((v) => ({
                    ...v,
                    start: Math.max(0, +e.target.value),
                  }))
                }
              />
            </label>
            <label>
              Padding
              <input
                type="number"
                min={1}
                max={8}
                value={namingOptions.padding}
                onChange={(e) =>
                  setNamingOptions((v) => ({
                    ...v,
                    padding: Math.max(1, Math.min(8, +e.target.value)),
                  }))
                }
              />
            </label>
            <label>
              Separator
              <AppSelect
                label="Filename separator"
                value={namingOptions.separator}
                onValueChange={(separator) =>
                  setNamingOptions((v) => ({ ...v, separator }))
                }
                options={[
                  { value: "-", label: "Dash ( - )" },
                  { value: "_", label: "Underscore" },
                  { value: " ", label: "Space" },
                  { value: "", label: "None" },
                ]}
              />
            </label>
          </div>
          <button className="naming-action" onClick={() => runNaming("folder")}>
            <Folder size={16} />
            <span>
              Folder name + index
              <small>shoes-001, shoes-002</small>
            </span>
            <ArrowRight size={15} />
          </button>
          <label className="field-label">
            Custom name
            <input
              value={namingOptions.custom}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  e.stopPropagation();
                  if (!e.repeat) runNaming("custom");
                }
              }}
              onChange={(e) =>
                setNamingOptions((v) => ({
                  ...v,
                  custom: e.target.value,
                }))
              }
            />
          </label>
          <button className="naming-action" onClick={() => runNaming("custom")}>
            <CaseLower size={17} />
            <span>
              Custom name + index
              <small>
                {namingOptions.custom}
                {namingOptions.separator}
                {String(namingOptions.start).padStart(
                  namingOptions.padding,
                  "0",
                )}
              </small>
            </span>
            <ArrowRight size={15} />
          </button>
          <button className="naming-action" onClick={() => runNaming("slug")}>
            <Sparkles size={16} />
            <span>
              Slugify current names
              <small>Summer Photo → summer-photo</small>
            </span>
            <ArrowRight size={15} />
          </button>
          <p className="popover-hint">
            <LockKeyhole size={12} /> Excluded images keep their names.
          </p>
        </PopoverContent>
      </Popover>
    </div>
  );
}
