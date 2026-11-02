// Minimal fake of @minecraft/server-ui for unit tests, swapped in by vitest.config.ts. Each
// show() takes the next queued response; with nothing queued it stays open until a test
// answers it through openForms.

export const FormCancelationReason = { UserBusy: "UserBusy", UserClosed: "UserClosed" } as const;
export type FormCancelationReason = (typeof FormCancelationReason)[keyof typeof FormCancelationReason];

export interface FakeResponse {
  canceled: boolean;
  cancelationReason?: FormCancelationReason;
  selection?: number;
}

interface OpenForm {
  form: FakeForm;
  player: { name: string };
  respond(response: FakeResponse): void;
  reject(error: Error): void;
}

const queued: (FakeResponse | Error)[] = [];
/** Forms waiting for an answer, oldest first. */
export const openForms: OpenForm[] = [];
/** Every form shown, in order. */
export const shownForms: FakeForm[] = [];
/** Names of players whose forms were closed with uiManager.closeAllForms. */
export const closedFor: string[] = [];

/** Queues the answers for the next show() calls; an Error makes show() reject. */
export function queueFormResponses(...responses: (FakeResponse | Error)[]): void {
  queued.push(...responses);
}

export function resetForms(): void {
  queued.length = 0;
  openForms.length = 0;
  shownForms.length = 0;
  closedFor.length = 0;
  liveForms.length = 0;
  liveFormOptions.rejectImages = false;
}

class FakeForm {
  titleText = "";
  bodyText = "";
  readonly buttons: string[] = [];
  /** Each button's icon path, in the same order (undefined for buttons without one). */
  readonly icons: (string | undefined)[] = [];

  title(text: string): this {
    this.titleText = text;
    return this;
  }

  body(text: string): this {
    this.bodyText = text;
    return this;
  }

  button(text: string, iconPath?: string): this {
    this.buttons.push(text);
    this.icons.push(iconPath);
    return this;
  }

  show(player: { name: string }): Promise<FakeResponse> {
    shownForms.push(this);
    const next = queued.shift();
    if (next instanceof Error) return Promise.reject(next);
    if (next) return Promise.resolve(next);
    return new Promise((respond, reject) => openForms.push({ form: this, player, respond, reject }));
  }
}

export class ActionFormData extends FakeForm {}

// ---- Data-driven (live) forms -----------------------------------------------------------

export const DataDrivenScreenClosedReason = { ClientClosed: "ClientClosed", ServerClosed: "ServerClosed", UserBusy: "UserBusy" } as const;
export type DataDrivenScreenClosedReason = (typeof DataDrivenScreenClosedReason)[keyof typeof DataDrivenScreenClosedReason];

class Observable<T> {
  private data: T;

  constructor(data: T) {
    this.data = data;
  }

  getData(): T {
    return this.data;
  }

  setData(data: T): void {
    this.data = data;
  }
}

export class ObservableString extends Observable<string> {}
export class ObservableBoolean extends Observable<boolean> {}
export class ObservableNumber extends Observable<number> {}

type Text = string | ObservableString;
const read = (text: Text) => (typeof text === "string" ? text : text.getData());

interface LivePart {
  kind: "label" | "header" | "divider" | "button" | "image";
  text?: Text;
  onClick?: () => void;
  disabled?: boolean | ObservableBoolean;
  src?: string;
  pack?: string;
}

/** Every live form made, oldest first. */
export const liveForms: CustomForm[] = [];
/** When true, show() rejects for a form with an image, as a client that can't show it might. */
export const liveFormOptions = { rejectImages: false };

export class CustomForm {
  readonly player: { name: string };
  readonly title: Text;
  readonly parts: LivePart[] = [];
  private open = false;
  private finish: ((reason: DataDrivenScreenClosedReason) => void) | undefined;

  constructor(player: { name: string }, title: Text) {
    this.player = player;
    this.title = title;
    liveForms.push(this);
  }

  label(text: Text): this {
    this.parts.push({ kind: "label", text });
    return this;
  }

  header(text: Text): this {
    this.parts.push({ kind: "header", text });
    return this;
  }

  divider(): this {
    this.parts.push({ kind: "divider" });
    return this;
  }

  image(src: string, pack: string): this {
    this.parts.push({ kind: "image", src, pack });
    return this;
  }

  button(text: Text, onClick: () => void, options: { disabled?: boolean | ObservableBoolean } = {}): this {
    this.parts.push({ kind: "button", text, onClick, disabled: options.disabled });
    return this;
  }

  isShowing(): boolean {
    return this.open;
  }

  show(): Promise<DataDrivenScreenClosedReason> {
    if (liveFormOptions.rejectImages && this.parts.some((part) => part.kind === "image")) return Promise.reject(new Error("cannot show the image"));
    this.open = true;
    return new Promise((resolve) => (this.finish = resolve));
  }

  close(): void {
    if (!this.open) throw new Error("FormVisibilityError: the form isn't showing");
    this.end(DataDrivenScreenClosedReason.ServerClosed);
  }

  // ---- Test helpers ----

  /** The player closes it. */
  dismiss(): void {
    this.end(DataDrivenScreenClosedReason.ClientClosed);
  }

  /** Every text on it now, in order (labels, headers and buttons). */
  texts(): string[] {
    return this.parts.filter((part) => part.text !== undefined).map((part) => read(part.text!));
  }

  /** Clicks the button whose text includes `text` (enabled ones only). */
  click(text: string): void {
    const button = this.parts.find((part) => part.kind === "button" && read(part.text!).includes(text));
    if (!button) throw new Error(`no button "${text}" on the form: ${this.texts().join(" | ")}`);
    const disabled = typeof button.disabled === "object" ? button.disabled.getData() : button.disabled;
    if (!disabled) button.onClick?.();
  }

  private end(reason: DataDrivenScreenClosedReason): void {
    this.open = false;
    const finish = this.finish;
    this.finish = undefined;
    finish?.(reason);
  }
}

/** The live form open for a player now, if any (the newest). */
export function openLiveForm(name: string): CustomForm | undefined {
  return [...liveForms].reverse().find((form) => form.player.name === name && form.isShowing());
}

export const uiManager = {
  /** Records the call and closes that player's open forms, which then resolve as closed. */
  closeAllForms(player: { name: string }): void {
    closedFor.push(player.name);
    for (const open of openForms.filter((form) => form.player.name === player.name)) {
      openForms.splice(openForms.indexOf(open), 1);
      open.respond({ canceled: true, cancelationReason: FormCancelationReason.UserClosed });
    }
  },
};
