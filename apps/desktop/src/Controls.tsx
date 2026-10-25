import { Select } from "@base-ui/react/select";
import { Checkbox } from "@base-ui/react/checkbox";
import { Switch } from "@base-ui/react/switch";
import { Check, ChevronDown } from "lucide-react";
import type { ReactNode } from "react";

interface SelectOption<Value extends string> {
  value: Value;
  label: string;
  disabled?: boolean;
}
export function AppSelect<Value extends string>({
  value,
  onValueChange,
  options,
  label,
  disabled = false,
  compact = false,
  icon,
  className = "",
  align = "start",
}: {
  value: Value;
  onValueChange: (value: Value) => void;
  options: SelectOption<Value>[];
  label: string;
  disabled?: boolean;
  compact?: boolean;
  icon?: ReactNode;
  className?: string;
  align?: "start" | "center" | "end";
}) {
  return (
    <Select.Root<Value>
      value={value}
      onValueChange={(next) => {
        if (next !== null) onValueChange(next);
      }}
      items={options}
      disabled={disabled}
      modal={false}
    >
      <Select.Trigger
        className={`ui-select-trigger ${compact ? "compact" : ""} ${className}`}
        aria-label={label}
      >
        {icon}
        <Select.Value className="ui-select-value" />
        <Select.Icon className="ui-select-icon">
          <ChevronDown size={13} />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Positioner
          className="ui-select-positioner"
          sideOffset={5}
          align={align}
          alignItemWithTrigger={false}
          collisionPadding={8}
        >
          <Select.Popup className="ui-select-popup">
            <Select.List className="ui-select-list">
              {options.map((option) => (
                <Select.Item
                  className="ui-select-item"
                  key={option.value}
                  value={option.value}
                  disabled={option.disabled}
                >
                  <Select.ItemIndicator className="ui-select-indicator">
                    <Check size={13} />
                  </Select.ItemIndicator>
                  <Select.ItemText>{option.label}</Select.ItemText>
                </Select.Item>
              ))}
            </Select.List>
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  );
}
interface ToggleProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}
export function AppCheckbox({
  checked,
  onCheckedChange,
  label,
  disabled = false,
  className = "",
}: ToggleProps & { className?: string }) {
  return (
    <Checkbox.Root
      className={`ui-checkbox ${className}`}
      aria-label={label}
      checked={checked}
      disabled={disabled}
      onCheckedChange={onCheckedChange}
    >
      <Checkbox.Indicator className="ui-checkbox-indicator">
        <Check size={12} strokeWidth={2.5} />
      </Checkbox.Indicator>
    </Checkbox.Root>
  );
}
export function AppSwitch({
  checked,
  onCheckedChange,
  label,
  disabled = false,
}: ToggleProps) {
  return (
    <Switch.Root
      className="ui-switch"
      aria-label={label}
      checked={checked}
      disabled={disabled}
      onCheckedChange={onCheckedChange}
    >
      <Switch.Thumb className="ui-switch-thumb" />
    </Switch.Root>
  );
}
