# BasaBridge integration development handoff

This enhancement package is based on the saved **Phase 6** source snapshot, not verified latest GitHub `main`. For implementation inventory and limitations, read [Implementation Audit](litera-reading-checks/IMPLEMENTATION-AUDIT.md). For complete Windows startup, QA and suggested Git checkpoints, read [Windows development and verification](litera-reading-checks/DEVELOPMENT.md).

Keep the original `voice/tree.py`, backend evidence scoring and grade-specific activity IDs intact when merging this package into a newer checkout.

## Guided practice audio

The root integrated app renders the guided quests through `frontend/src/practice/PracticeJourney.tsx`. The listening component uses the browser [SpeechSynthesis interface](https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis) and subscribes to [voice list changes](https://developer.mozilla.org/en-US/docs/Web/API/SpeechSynthesis/voiceschanged_event). It chooses an on-device Philippine English voice if available, followed by an on-device English default and then any other on-device English voice. Voice availability, rate and pronunciation depend on the browser and device. Test the words on the actual classroom device with a teacher. The model speaks whole words and authored sentences. The CVCC blending cues remain teacher-led. Some existing text-only practice prompts overlap with Form B words. The new spoken phonics models use different words with the same ending pattern to avoid adding audio exposure to scored items. Have the teacher check prior exposure when choosing a fresh form.

### Windows 11 startup

1. Install Python 3.11 or 3.12 and Node.js 22.12 or newer. In PowerShell, open the folder that contains `Start-Litera.cmd`, `frontend`, and `backend`.
2. If needed, run `Copy-Item .env.example .env` and `notepad .env`. Enter the existing Gmail sign-in and teacher settings, then save. Use a fictional learner and a consenting adult voice for the demo.
3. Run `.\Start-Litera.cmd`. Open `http://127.0.0.1:8765` in Chrome and repeat the checks in Edge. If port 8765 is in use, close the previous Litera server with Ctrl+C or set another port in `.env` and open that port.
4. If no English voice appears, install an English speech voice through Windows language settings, restart the browser, and reopen the quest. Use live teacher modeling when an on-device English voice is unavailable or sounds unsuitable. On a phone, use an HTTPS site for microphone access.

### Verification checklist

| Route | Checks |
| --- | --- |
| Word Village | Play the guide word, play it slowly, replay, and stop. Click Listen twice. Start recording while a voice is playing and verify the voice stops before the microphone opens. Stop and replay the clip. Leaving the step clears it. Confirm a choice-step follow-up word appears as a model only after feedback. |
| Story Forest | Choose the whole story, a sentence, and a target word. Changing the selection or leaving the practice step should cancel the previous playback. |
| Meaning Mountain | Play the story and the activity instructions. Confirm that the answer explanation becomes available after an answer attempt. |
| Assessments | Open phonics, oral reading, and comprehension assessments. Confirm the reading-model controls are absent and compare the teacher-validated skill profile before and after guided practice. |
| Accessibility | Tab through the input and buttons with visible focus. Use Enter or Space to play. Check the messages for missing voices, denied microphone permission, and speech errors. Check touch controls and overflow at 360px and 390px. |

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
