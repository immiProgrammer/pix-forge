import { Popover as Primitive } from "@base-ui/react/popover";

export const Popover = Primitive.Root;
export const PopoverTrigger = Primitive.Trigger;
export const PopoverClose = Primitive.Close;
export const PopoverTitle = Primitive.Title;

type ContentProps = Primitive.Popup.Props &
  Pick<
    Primitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset"
  >;
export function PopoverContent({
  className = "",
  align = "end",
  alignOffset = 0,
  side = "bottom",
  sideOffset = 6,
  ...props
}: ContentProps) {
  return (
    <Primitive.Portal>
      <Primitive.Positioner
        className="ui-popover-positioner"
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        collisionPadding={8}
      >
        <Primitive.Popup
          data-slot="popover-content"
          className={`ui-popover-content ${className}`}
          {...props}
        />
      </Primitive.Positioner>
    </Primitive.Portal>
  );
}
