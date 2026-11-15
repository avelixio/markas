# ADR 0005: Rounds run in the host and account for every occurrence

- Status: accepted
- Date: 2026-11-11

## Context

A round is work a bot does on a schedule.
Scheduled work fails quietly in three common ways: the computer was asleep, the bot was still busy, or the app restarted in the middle.
A person who relies on a morning check needs to see which of those happened, not an empty history.

## Decision

The host owns the schedule, not the desktop window and not the operating system's task scheduler.

- Rounds and their run history live in `rounds.json` in the data folder, rewritten atomically.
- A schedule is one of three kinds: chosen weekdays at chosen times, a repeat every so many minutes (5 at the least), or once.
Times are the computer's local wall-clock time.
- The scheduler checks the clock every 30 seconds.
The same check catches up after sleep.
- Every scheduled time ends as exactly one run with one status: completed, failed, skipped or missed.
- When several occurrences were due at once, only the newest runs and the rest are recorded as missed.
- An occurrence more than 12 hours late is recorded as missed and is not run late.
- A round runs by putting its instruction in the bot's ordinary message queue.
It gets no separate path into the engine, so pausing, cancelling and stopping work the same as for a typed message.
- When the bot is busy, the round either waits in the queue or skips, as the person chose.
- A run that was still going when the host stopped is recorded as failed with the reason, because its result can no longer be followed.
- Turning a round back on, or changing its schedule, starts counting from that moment.
The time it was off is not made up.
- Deleting a bot deletes its rounds.

## Consequences

- Rounds run only while Markas is running, which the Rounds screen says in plain words.
Starting Markas at login is a separate, later change.
- The schedule logic is pure and has no host dependencies, so the interface reuses it to draw the coming week.
- Standing approvals (what a round may do without asking) are not part of this decision.
They depend on checkpoints, which are not built yet.
