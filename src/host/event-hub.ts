import type { SetupEvent } from "../shared/ipc";

export type HostEvent =
  | { channel: "agent"; payload: unknown }
  /** What setup is doing to an engine: installer output, and how a sign-in is going. */
  | { channel: "setup"; payload: SetupEvent };

const HEARTBEAT_MS = 15_000;
const encoder = new TextEncoder();

type Subscriber = ReadableStreamDefaultController<Uint8Array>;

/** Fans host events out to every connected web UI over server-sent events. */
export class EventHub {
  readonly #heartbeats = new Map<Subscriber, ReturnType<typeof setInterval>>();

  get subscriberCount(): number {
    return this.#heartbeats.size;
  }

  publish(event: HostEvent): void {
    const frame = encoder.encode(
      `event: ${event.channel}\ndata: ${JSON.stringify(event.payload)}\n\n`,
    );
    for (const subscriber of [...this.#heartbeats.keys()]) this.#send(subscriber, frame);
  }

  /** A stream that stays open until the client disconnects or the hub closes. */
  subscribe(): ReadableStream<Uint8Array> {
    let subscriber: Subscriber | null = null;
    return new ReadableStream<Uint8Array>({
      start: (controller) => {
        subscriber = controller;
        controller.enqueue(encoder.encode(": connected\n\n"));
        this.#heartbeats.set(
          controller,
          setInterval(
            () => this.#send(controller, encoder.encode(": keep-alive\n\n")),
            HEARTBEAT_MS,
          ),
        );
      },
      cancel: () => {
        if (subscriber) this.#release(subscriber);
      },
    });
  }

  close(): void {
    for (const subscriber of [...this.#heartbeats.keys()]) {
      this.#release(subscriber);
      try {
        subscriber.close();
      } catch {
        // The client already went away.
      }
    }
  }

  #send(subscriber: Subscriber, frame: Uint8Array): void {
    try {
      subscriber.enqueue(frame);
    } catch {
      this.#release(subscriber);
    }
  }

  #release(subscriber: Subscriber): void {
    clearInterval(this.#heartbeats.get(subscriber));
    this.#heartbeats.delete(subscriber);
  }
}
