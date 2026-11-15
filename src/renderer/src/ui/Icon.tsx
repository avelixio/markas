import { For } from "solid-js";
import { ICONS, type IconName } from "./icons";

interface IconProps {
  name: IconName;
  /** Rendered size in px. The artwork is drawn on a 16 unit grid. */
  size?: number;
  class?: string;
  /** When set, the icon is announced with this label; otherwise it is decorative. */
  label?: string;
}

/** One icon from the Markas set, coloured by the surrounding text colour. */
export function Icon(props: IconProps) {
  const size = () => props.size ?? 16;
  return (
    <svg
      data-component="Icon"
      class={props.class}
      width={size()}
      height={size()}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width={size() < 16 ? 1.6 : 1.5}
      stroke-linecap="round"
      stroke-linejoin="round"
      role={props.label ? "img" : undefined}
      aria-label={props.label}
      aria-hidden={props.label ? undefined : "true"}
    >
      <For each={ICONS[props.name] as ReadonlyArray<string | readonly [number, number, number]>}>
        {(part) =>
          typeof part === "string" ? (
            <path d={part} />
          ) : (
            <circle cx={part[0]} cy={part[1]} r={part[2]} />
          )
        }
      </For>
    </svg>
  );
}
