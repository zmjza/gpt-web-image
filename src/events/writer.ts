import { validateProgressEvent, type ProgressEvent, type ProgressEventInput } from "./schema.js";

export interface EventWriterOptions {
  stdout?: (line: string) => void;
  now?: () => Date;
  initialSequence?: number;
}

export class EventWriter {
  private sequence = 0;
  private readonly stdout: (line: string) => void;
  private readonly now: () => Date;

  public constructor(options: EventWriterOptions = {}) {
    this.stdout = options.stdout ?? ((line) => process.stdout.write(`${line}\n`));
    this.now = options.now ?? (() => new Date());
    this.sequence = options.initialSequence ?? 0;
  }

  public get currentSequence(): number { return this.sequence; }

  public write(input: ProgressEventInput): ProgressEvent {
    const event = { schemaVersion: "1", seq: ++this.sequence, timestamp: this.now().toISOString(), ...input } as ProgressEvent;
    validateProgressEvent(event);
    this.stdout(JSON.stringify(event));
    return event;
  }
}
