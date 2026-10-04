import { Api, type TelegramClient } from "telegram";
import type { Entity } from "./telegram";

const POLLS = 20;
const POLL_MS = 1500;

// telegram's speech-to-text for a voice message or video note. it answers "pending" first;
// asking again returns the finished text. needs premium, or one of the few free trials
export async function transcribe(client: TelegramClient, peer: Entity, msgId: number, who: string): Promise<string> {
  for (let i = 0; i < POLLS; i++) {
    let r: Api.messages.TranscribedAudio;
    try {
      r = await client.invoke(new Api.messages.TranscribeAudio({ peer, msgId }));
    } catch (err) {
      const code = (err as { errorMessage?: string }).errorMessage ?? "";
      if (/PREMIUM|TRIAL/.test(code)) throw new Error(`transcription needs telegram premium on ${who} (free trials used up)`);
      if (code === "MSG_ID_INVALID") throw new Error(`message #${msgId} isn't a voice message or video note`);
      throw err;
    }
    if (!r.pending) return r.text;
    await Bun.sleep(POLL_MS);
  }
  throw new Error("telegram is still transcribing — try again in a moment");
}
