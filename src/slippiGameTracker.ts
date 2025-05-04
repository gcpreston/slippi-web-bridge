import { SlpStream, SlpStreamMode } from "@slippi/slippi-js";

class SlippiGameTracker {
  private readonly slpStream = new SlpStream({ mode: SlpStreamMode.AUTO });
  private eventPayloads?: Buffer;
  private gameStart?: Buffer;

  constructor() {

  }

  public write(b: Buffer) {
    this.slpStream.write(b);
  }
}
