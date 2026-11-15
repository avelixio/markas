import { Match, Switch } from "solid-js";

export const SIGIL_COLORS = [
  "mint",
  "amber",
  "coral",
  "sky",
  "violet",
  "rose",
  "lime",
  "sand",
] as const;
export type SigilColor = (typeof SIGIL_COLORS)[number];

export const SIGIL_PATTERN_COUNT = 8;

interface SigilProps {
  /** 0 to 7. A bot is identified by its pattern and its colour together. */
  pattern: number;
  color: SigilColor;
  size?: number;
  class?: string;
}

/**
 * A bot's sigil: a signal-flag tile. Square tiles are bots; people are round monograms.
 * Drawn on a 100 unit grid so it stays crisp at every size.
 */
export function Sigil(props: SigilProps) {
  const size = () => props.size ?? 28;
  const pattern = () =>
    ((props.pattern % SIGIL_PATTERN_COUNT) + SIGIL_PATTERN_COUNT) % SIGIL_PATTERN_COUNT;
  const clipId = `sigil-clip-${Math.random().toString(36).slice(2, 9)}`;
  return (
    <svg
      data-component="Sigil"
      class={props.class}
      width={size()}
      height={size()}
      viewBox="0 0 100 100"
      aria-hidden="true"
    >
      <clipPath id={clipId}>
        <rect width="100" height="100" rx="28" />
      </clipPath>
      <g clip-path={`url(#${clipId})`}>
        <rect data-slot="tile" width="100" height="100" fill={`var(--mk-sigil-${props.color})`} />
        <g data-slot="mark" fill="var(--mk-sigil-ink)" opacity="0.86">
          <Switch>
            <Match when={pattern() === 0}>
              <rect y="33.3" width="100" height="33.4" />
            </Match>
            <Match when={pattern() === 1}>
              <circle cx="50" cy="50" r="21" />
            </Match>
            <Match when={pattern() === 2}>
              <rect width="50" height="50" />
              <rect x="50" y="50" width="50" height="50" />
            </Match>
            <Match when={pattern() === 3}>
              <path d="M0 100L100 0V100Z" />
            </Match>
            <Match when={pattern() === 4}>
              <rect y="39" width="100" height="22" />
              <rect x="39" width="22" height="100" />
            </Match>
            <Match when={pattern() === 5}>
              <path fill-rule="evenodd" d="M24 24H76V76H24ZM37 37V63H63V37Z" />
            </Match>
            <Match when={pattern() === 6}>
              <rect x="20" width="20" height="100" />
              <rect x="60" width="20" height="100" />
            </Match>
            <Match when={pattern() === 7}>
              <path d="M0 0L50 50L100 0V36L50 86L0 36Z" />
            </Match>
          </Switch>
        </g>
      </g>
    </svg>
  );
}
