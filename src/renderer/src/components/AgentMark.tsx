import { Match, Switch } from "solid-js";
import { BOT_AVATAR_SHAPES, type BotAvatarShape } from "../../../shared/ipc";

/**
 * A bot's mark: a Markas sigil. Each stored avatar shape maps to one signal-flag pattern,
 * and the tile takes the surrounding text colour, which the avatar's colour class sets.
 */
export function AgentMark(props: { shape?: BotAvatarShape }) {
  const pattern = () => Math.max(0, BOT_AVATAR_SHAPES.indexOf(props.shape ?? "blob"));
  const clipId = `agent-mark-${Math.random().toString(36).slice(2, 9)}`;
  return (
    <svg
      data-component="AgentMark"
      aria-hidden="true"
      class="agent-mark"
      data-pattern={pattern()}
      viewBox="0 0 100 100"
    >
      <clipPath id={clipId}>
        <rect width="100" height="100" rx="28" />
      </clipPath>
      <g clip-path={`url(#${clipId})`}>
        <rect data-slot="tile" class="agent-mark__head" width="100" height="100" />
        <g data-slot="mark" class="agent-mark__face">
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
