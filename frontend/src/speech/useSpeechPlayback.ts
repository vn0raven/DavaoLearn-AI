import { useEffect, useRef, useState } from "react";
import { englishVoices, SpeechPlayback } from "./playback";
import type { PlaybackRate, PlaybackState } from "./playback";

export function useSpeechPlayback(onStart: () => void) {
  const supported = typeof window.speechSynthesis !== "undefined" &&
    typeof window.SpeechSynthesisUtterance === "function";
  const onStartRef = useRef(onStart);
  const playback = useRef<SpeechPlayback>(undefined);
  const [voice, setVoice] = useState<SpeechSynthesisVoice>();
  const [loadingVoices, setLoadingVoices] = useState(supported);
  const [state, setState] = useState<PlaybackState>("idle");

  useEffect(() => { onStartRef.current = onStart; }, [onStart]);
  useEffect(() => {
    if (!supported) return;
    const synth = window.speechSynthesis;
    function refreshVoices() {
      const available = synth.getVoices();
      setVoice(englishVoices(available)[0]);
      if (available.length) setLoadingVoices(false);
    }
    const player = new SpeechPlayback(synth, text => new SpeechSynthesisUtterance(text), setState,
      () => onStartRef.current());
    playback.current = player;
    refreshVoices();
    synth.addEventListener("voiceschanged", refreshVoices);
    const timer = setTimeout(() => setLoadingVoices(false), 1500);
    const stop = () => player.stop();
    const hide = () => { if (document.hidden) stop(); };
    window.addEventListener("pagehide", stop);
    document.addEventListener("visibilitychange", hide);
    return () => {
      clearTimeout(timer);
      synth.removeEventListener("voiceschanged", refreshVoices);
      window.removeEventListener("pagehide", stop);
      document.removeEventListener("visibilitychange", hide);
      player.stop(false);
      playback.current = undefined;
    };
  }, [supported]);

  function play(text: string, rate: PlaybackRate) {
    // Read the current list on the click too, in case a browser populated it without an event.
    if (!playback.current || !text.trim()) return;
    const available = englishVoices(window.speechSynthesis.getVoices());
    const selected = available.find(item => item.voiceURI === voice?.voiceURI) ?? available[0];
    setVoice(selected);
    setLoadingVoices(false);
    if (selected) playback.current.play(text, selected, rate);
    else playback.current.stop();
  }
  return { supported, voice, loadingVoices, state, play, stop: () => playback.current?.stop() };
}
