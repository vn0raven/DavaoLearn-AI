# Litera development

The repository root is the canonical integrated app. See the [integration audit](docs/UI-INTEGRATION.md) for the branch comparison. Older launchers are documented in [the legacy index](legacy/README.md).

## Guided practice audio

`POST /api/practice/tts` accepts `runId`, `step`, `targetId`, and `speed` (`normal` or `slow`). It authenticates the learner, resolves the current saved practice step, and reads only matching authored content. Phonics follow-up words and comprehension explanations require a recorded practice attempt on that step. The service returns PCM WAV, uses a bounded in-memory cache, and deletes temporary synthesis files. Practice listening is logged after playback starts. The microphone rehearsal stays in tab memory for that step.

On Windows, the engine uses Windows PowerShell 5.1 and an installed English desktop System.Speech voice. It prefers Philippine English, then US English, then another installed English voice. Slow speed is approximate and voice dependent. On Linux and macOS, use FFmpeg built with the `flite` filter. The test environment used the `slt` English voice and the `atempo` filter. Check availability with `ffmpeg -filters` and look for `flite`. When backend audio fails, **Use device voice** appears if the browser exposes a local English voice. The extra tap allows playback under browser user-activation rules. On devices without either engine, teachers can model the content live.

Pilot phonics words and practice narration need a teacher listening check on the demonstration device. For isolated sounds use teacher modeling or a packaged teacher recording. Some earlier text-only prompts overlap Form B items. New spoken models use other words with the same spelling pattern.

### Windows 11 startup

1. Install Python 3.11 or 3.12 and Node.js 22.12 or newer. In PowerShell, open the folder that contains `Start-Litera.cmd`, `frontend`, and `backend`.
2. If needed, run `Copy-Item .env.example .env` and `notepad .env`. Enter the existing Gmail sign-in and teacher settings, then save. Use a fictional learner and a consenting adult voice for the demo.
3. Run `.\Start-Litera.cmd`. Open `http://127.0.0.1:8765` in Chrome and repeat the checks in Edge. If port 8765 is in use, close the previous Litera server with Ctrl+C or set another port in `.env` and open that port.
4. If no English voice appears, install an English desktop speech voice through Windows language settings. Restart Litera and reopen the quest. Use live teacher modeling when an on-device English voice is unavailable or sounds unsuitable. On a phone, use an HTTPS site for microphone access.

### Verification checklist

| Route | Checks |
| --- | --- |
| Word Village | Play the guide word, play it slowly, replay, and stop. Click Listen twice. Start recording while a voice is playing and verify the voice stops before the microphone opens. Stop and replay the clip. Leaving the step clears it. Confirm a choice-step follow-up word appears as a model only after feedback. |
| Story Forest | Choose the whole story, a sentence, and a target word. Changing the selection or leaving the practice step should cancel the previous playback. |
| Meaning Mountain | Play the story and the activity instructions. Confirm that the answer explanation becomes available after an answer attempt. |
| Assessments | Open phonics, oral reading, and comprehension assessments. Confirm the reading-model controls are absent and compare the teacher-validated skill profile before and after guided practice. |
| Accessibility | Tab through the input and buttons with visible focus. Use Enter or Space to play. Check the messages for missing voices, denied microphone permission, and speech errors. Verify a backend request returns `200 audio/wav` in Network tools. Check touch controls and overflow at 360px and 390px. |

Run the automated checks from the repository root.

```powershell
npm --prefix frontend test
npm --prefix frontend run build
.\.venv\Scripts\python.exe -m pip install pytest httpx
.\.venv\Scripts\python.exe -m pytest -q
```

### Pack a teacher-recorded isolated sound

Use a short, teacher-approved recording with permission to distribute it. Put an MP3, WAV or Ogg file in `frontend/public/practice-audio/` and add an optional `soundModel` field to the appropriate phonics guide step in `frontend/src/practice/content.json`. Example: `"soundModel": {"label": "Teacher model of the final sounds", "file": "final-nt.wav"}`. Rebuild and restart. The recording appears alongside the word model in guided practice. Leave the field unset when the teacher will demonstrate live. No voice recordings ship with this update.

Audio model and narration use is stored in practice history as one entry per step and source type once playback starts. Rehearsal clips stay in tab memory until the step closes. The practice endpoint stores assistance metadata alongside hints and attempts and retains compatibility with saved runs created before this field existed. Assessment endpoints, evidence processing, and recommendation rules are unchanged.
