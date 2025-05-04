import { Command, SlpRawEventPayload, SlpStream, SlpStreamEvent, SlpStreamMode } from "@slippi/slippi-js";

export class SlippiGameTracker {
  private readonly slpStream = new SlpStream({ mode: SlpStreamMode.AUTO });
  private currentGame: Buffer[] | null = null;

  constructor() {
    this.slpStream.on(SlpStreamEvent.RAW, ({ command, payload }: SlpRawEventPayload) => {
      switch (command) {
        case Command.MESSAGE_SIZES:
          this.currentGame = [payload];
          break;
        case Command.GAME_END:
          this.currentGame = null;
          break;
        default:
          this.currentGame?.push(payload);
      }
    });
  }

  public write(b: Buffer) {
    this.slpStream.write(b);
  }

  public getCurrentGame(): Buffer | null {
    if (this.currentGame) {
      return Buffer.concat(this.currentGame);
    } else {
      return null;
    }
  }
}
