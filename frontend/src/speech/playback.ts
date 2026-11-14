export type PlaybackState = "idle" | "starting" | "playing" | "stopped" | "ended" | "error";
export type PlaybackRate = 1 | 0.75;

export function englishVoices(voices: readonly SpeechSynthesisVoice[]) {
  const local = voices.filter(voice => voice.localService && /^en(?:[-_]|$)/i.test(voice.lang));
  function rank(voice: SpeechSynthesisVoice) {
    if (/^en[-_]ph$/i.test(voice.lang)) return 0;
    return voice.default ? 1 : 2;
  }
  return local.sort((a, b) => rank(a) - rank(b));
}

export class SpeechPlayback {
  private current?: SpeechSynthesisUtterance;
  private timer?: ReturnType<typeof setTimeout>;

  constructor(
    private readonly synth: Pick<SpeechSynthesis, "speak" | "cancel">,
    private readonly makeUtterance: (text: string) => SpeechSynthesisUtterance,
    private readonly update: (state: PlaybackState) => void,
    private readonly started: () => void,
    private readonly startupTimeout = 5000,
  ) {}

  private detach() {
    clearTimeout(this.timer);
    if (this.current) {
      this.current.onstart = this.current.onend = this.current.onerror = null;
      this.current = undefined;
    }
  }

  stop(report = true) {
    this.detach();
    this.synth.cancel();
    if (report) this.update("stopped");
  }

  play(text: string, voice: SpeechSynthesisVoice, rate: PlaybackRate) {
    this.stop(false);
    const utterance = this.makeUtterance(text);
    this.current = utterance;
    utterance.voice = voice;
    utterance.lang = voice.lang;
    utterance.rate = rate;
    utterance.onstart = () => {
      if (this.current !== utterance) return;
      clearTimeout(this.timer);
      this.update("playing");
      this.started();
    };
    const finish = (state: "ended" | "error") => {
      if (this.current !== utterance) return;
      this.detach();
      this.update(state);
    };
    utterance.onend = () => finish("ended");
    utterance.onerror = () => finish("error");
    this.update("starting");
    this.timer = setTimeout(() => {
      if (this.current !== utterance) return;
      this.stop(false);
      this.update("error");
    }, this.startupTimeout);
    try {
      this.synth.speak(utterance);
    } catch {
      finish("error");
    }
  }
}
