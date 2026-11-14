import { useEffect, useRef, useState } from "react";
import { useSpeechPlayback } from "./useSpeechPlayback";
import type { PlaybackRate, PlaybackState } from "./playback";
import type { ListenTarget } from "../practice/pronunciation";

type PracticeLocation = { runId: string; step: number };
type BackendState = PlaybackState | "unavailable";

export function usePracticeSpeech(
  location: PracticeLocation,
  flushPractice: () => Promise<unknown>,
  onStart: (target: ListenTarget) => void,
) {
  const context = useRef<AudioContext>(null);
  const node = useRef<AudioBufferSourceNode>(null);
  const active = useRef<AbortController>(null);
  const deviceTarget = useRef<ListenTarget>(null);
  const cache = useRef(new Map<string, AudioBuffer>());
  const [backend, setBackend] = useState<BackendState>("idle");
  const [usingDevice, setUsingDevice] = useState(false);
  const device = useSpeechPlayback(() => {
    if (deviceTarget.current) onStart(deviceTarget.current);
  });

  function haltBackend() {
    active.current?.abort();
    active.current = null;
    if (node.current) {
      node.current.onended = null;
      node.current.stop();
      node.current.disconnect();
      node.current = null;
    }
  }

  const stopDevice = useRef(device.stop);
  stopDevice.current = device.stop;
  useEffect(() => {
    function stopOnLeave() {
      haltBackend();
      stopDevice.current();
      setBackend("stopped");
      setUsingDevice(false);
    }
    function stopWhenHidden() { if (document.hidden) stopOnLeave(); }
    document.addEventListener("visibilitychange", stopWhenHidden);
    window.addEventListener("pagehide", stopOnLeave);
    return () => {
      document.removeEventListener("visibilitychange", stopWhenHidden);
      window.removeEventListener("pagehide", stopOnLeave);
      haltBackend();
      if (context.current) void context.current.close().catch(() => undefined);
      context.current = null;
    };
  }, []);

  function stop() {
    haltBackend();
    device.stop();
    setBackend("stopped");
    setUsingDevice(false);
  }

  function playDevice(target: ListenTarget, rate: PlaybackRate) {
    stop();
    deviceTarget.current = target;
    setUsingDevice(true);
    device.play(target.text, rate);
  }

  async function play(target: ListenTarget, rate: PlaybackRate) {
    stop();
    if (!window.AudioContext) {
      if (device.voice) playDevice(target, rate);
      else setBackend("unavailable");
      return;
    }

    const request = new AbortController();
    active.current = request;
    setBackend("starting");
    const timeout = window.setTimeout(() => {
      if (active.current !== request) return;
      haltBackend();
      setBackend("unavailable");
    }, 12000);
    try {
      const player = context.current ??= new window.AudioContext();
      // Unlock audio during the tap so the response can play after synthesis.
      const ready = player.resume();
      const key = `${target.id}:${rate}`;
      const decode = async () => {
        const cached = cache.current.get(key);
        if (cached) return cached;
        await flushPractice();
        if (request.signal.aborted) return;
        const response = await fetch("/api/practice/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...location, targetId: target.id, speed: rate === 1 ? "normal" : "slow" }),
          signal: request.signal,
        });
        if (!response.ok || !response.headers.get("Content-Type")?.startsWith("audio/wav")) {
          throw new Error("Reading audio unavailable");
        }
        return player.decodeAudioData(await response.arrayBuffer());
      };
      const [, audio] = await Promise.all([ready, decode()]);
      if (!audio || active.current !== request) return;
      cache.current.set(key, audio);
      const source = player.createBufferSource();
      source.buffer = audio;
      source.connect(player.destination);
      source.onended = () => {
        if (node.current !== source) return;
        source.disconnect();
        node.current = null;
        setBackend("ended");
      };
      source.start();
      node.current = source;
      setBackend("playing");
      onStart(target);
    } catch {
      if (active.current === request) setBackend("unavailable");
    } finally {
      window.clearTimeout(timeout);
      if (active.current === request) active.current = null;
    }
  }

  return { state: usingDevice ? device.state : backend, play, playDevice, stop, deviceAvailable: Boolean(device.voice) };
}
