const get = id => document.getElementById(id);
const scoreButtons = [...document.querySelectorAll("[data-score]")];
const prompts = [
  {before: "I put the ", word: "tent", after: " in the bag.", skill: "phonics"},
  {before: "We can ", word: "rent", after: " a bike after lunch.", skill: "phonics"},
  {before: "She ", word: "bent", after: " the wire.", skill: "phonics"},
  {before: "Mia ", word: "sent", after: " a note.", skill: "phonics"},
  {before: "The can has a ", word: "dent", after: ".", skill: "phonics"},
  {before: "", word: "The class planted seeds by the garden gate.", after: "", skill: "oral"},
];
const skillNames = {phonics: "Phonics", oral: "Oral reading", comprehension: "Comprehension"};
const storageKey = "basabridge-english-voice-v1";
let checks = [];
let override = null;
let attempt = 0;
let planRequest = 0;
let playbackUrl;
const voiceScores = new Map();

try {
  const saved = JSON.parse(localStorage.getItem(storageKey) || "[]");
  if (Array.isArray(saved)) checks = saved;
} catch { /* A broken cache is safe to ignore in the demo. */ }

function save() {
  try { localStorage.setItem(storageKey, JSON.stringify(checks)); }
  catch { get("planStatus").textContent = "Browser storage unavailable. Results stay in this tab."; }
}
function skillList(skills) {
  return skills.map(skill => skillNames[skill]).join(", ") || "None";
}
function listItems(id, values) {
  get(id).replaceChildren(...values.map(value => {
    const item = document.createElement("li");
    item.textContent = value;
    return item;
  }));
}
async function refreshPlan() {
  const request = ++planRequest;
  get("planStatus").textContent = "Updating recommendation…";
  listItems("history", checks.map(check =>
    `${skillNames[check.skill]} · ${check.correct}/${check.total} · ${check.kind === "exit_item" ? "exit item" : "probe"}${check.assisted ? " · assisted" : ""}${!check.usable ? " · unusable" : ""}`
  ));
  try {
    const response = await fetch("/api/plan", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({checks, print_accessible: get("access").checked, override}),
    });
    if (!response.ok) throw new Error("Could not update the recommendation.");
    const data = await response.json();
    if (request !== planRequest) return;
    get("reason").textContent = data.reason;
    get("primary").textContent = data.primary;
    get("secondary").textContent = data.secondary;
    get("gaps").textContent = skillList(data.active_gaps);
    get("rawGaps").textContent = skillList(data.raw_below);
    get("pending").textContent = skillList(data.recheck);
    get("review").textContent = data.teacher_review ? "Teacher review recommended." : "";
    listItems("evidence", Object.entries(data.evidence).map(([skill, evidence]) =>
      `${skillNames[skill]}: ${evidence.score == null ? "—" : evidence.score.toFixed(1) + "%"} · ${evidence.note}`
    ));
    get("planStatus").textContent = "";
  } catch (error) {
    if (request === planRequest) get("planStatus").textContent = error.message;
  }
}

function addCheck(check) {
  if (checks.length >= 120) {
    get("planStatus").textContent = "Demo log full. Reset before adding more checks.";
    return false;
  }
  checks.push(check);
  save();
  refreshPlan();
  return true;
}
function refreshVoiceTally() {
  get("voiceTally").textContent = `Scored phonics prompts: ${voiceScores.size}/5.`;
  get("saveVoiceProbe").disabled = voiceScores.size !== 5;
}
get("saveVoiceProbe").onclick = () => {
  const session = get("probe").elements.session.value.trim();
  if (!session) {
    get("score").textContent = "Enter a session ID before saving.";
    return;
  }
  if (checks.some(check => check.skill === "phonics" &&
      (check.form === "voice-phonics-a" || (check.session === session && check.kind !== "exit_item")))) {
    get("score").textContent = "This form or session already has a phonics probe. Use fresh material in a new session.";
    return;
  }
  const results = [...voiceScores.values()];
  if (addCheck({
    skill: "phonics", form: "voice-phonics-a", session,
    correct: results.reduce((sum, result) => sum + result.correct, 0), total: 5,
    assisted: results.some(result => result.assisted),
  })) {
    voiceScores.clear();
    refreshVoiceTally();
    get("score").textContent = "Teacher-confirmed phonics check saved.";
  }
};
get("probe").onsubmit = event => {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const correct = Number(data.get("correct"));
  const total = Number(data.get("total"));
  if (correct > total || !data.get("form").trim() || !data.get("session").trim()) {
    get("planStatus").textContent = "Check the counts, form ID, and session ID.";
    return;
  }
  addCheck({
    skill: data.get("skill"), correct, total,
    form: data.get("form").trim(), session: data.get("session").trim(),
    assisted: data.has("assisted"), usable: !data.has("limited"),
  });
};
get("access").onchange = refreshPlan;
get("override").onsubmit = event => {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  override = {activity: data.get("activity"), reason: data.get("reason")};
  refreshPlan();
};
get("clearOverride").onclick = () => { override = null; get("override").reset(); refreshPlan(); };
get("reset").onclick = () => {
  if (!window.confirm("Clear all demo reading checks?")) return;
  checks = [];
  voiceScores.clear();
  refreshVoiceTally();
  override = null;
  get("override").reset();
  get("access").checked = true;
  save();
  refreshPlan();
};

function showPrompt() {
  const {before, word, after} = prompts[get("prompt").value];
  const bold = document.createElement("strong");
  bold.textContent = word;
  get("target").replaceChildren(before, bold, after);
}
get("prompt").onchange = showPrompt;
function normalized(text) {
  return (text.toLowerCase().match(/[a-z]+/g) || []).join(" ");
}

get("record").onclick = async () => {
  get("record").disabled = true;
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({audio: true});
    const recorder = new MediaRecorder(stream);
    const prompt = prompts[get("prompt").value];
    const id = ++attempt;
    const chunks = [];
    let timer;
    scoreButtons.forEach(button => button.disabled = true);
    get("transcript").textContent = "—";
    get("signal").textContent = "";
    get("score").textContent = "";
    get("playback").hidden = true;
    get("prompt").disabled = true;
    recorder.ondataavailable = event => chunks.push(event.data);
    recorder.onstop = async () => {
      clearTimeout(timer);
      stream.getTracks().forEach(track => track.stop());
      get("record").disabled = false;
      get("stop").disabled = true;
      const clip = new Blob(chunks, {type: recorder.mimeType});
      if (!clip.size) {
        get("voiceStatus").textContent = "Empty recording. Try again.";
        get("prompt").disabled = false;
        return;
      }
      if (playbackUrl) URL.revokeObjectURL(playbackUrl);
      playbackUrl = URL.createObjectURL(clip);
      get("playback").src = playbackUrl;
      get("playback").hidden = false;
      scoreButtons.forEach(button => {
        button.disabled = false;
        button.onclick = () => {
          const score = button.dataset.score;
          if (score !== "retry" && !addCheck({
            skill: prompt.skill, form: crypto.randomUUID(),
            session: get("probe").elements.session.value.trim() || "1",
            correct: Number(score), total: 1, kind: "exit_item",
            assisted: get("probe").elements.assisted.checked,
          })) return;
          if (prompt.skill === "phonics" && score !== "retry") {
            voiceScores.set(prompt.word, {correct: Number(score), assisted: get("probe").elements.assisted.checked});
            refreshVoiceTally();
          }
          scoreButtons.forEach(choice => choice.disabled = true);
          get("prompt").disabled = false;
          get("score").textContent = score === "retry" ? "Retry requested. No score added." :
            `Teacher recorded: ${score === "1" ? "Correct" : "Needs practice"}.`;
        };
      });
      get("voiceStatus").textContent = "Transcribing… Replay and score while you wait.";
      const form = new FormData();
      form.append("clip", clip, "reading-attempt");
      try {
        const response = await fetch("/api/transcribe", {method: "POST", body: form});
        if (!response.ok) throw new Error("Transcription unavailable.");
        const {transcript} = await response.json();
        if (id !== attempt) return;
        const expected = normalized(prompt.word);
        const heard = normalized(transcript);
        const appears = ` ${heard} `.includes(` ${expected} `);
        get("transcript").textContent = transcript || "No speech recognized.";
        get("signal").textContent = appears ? "Target appears in the transcript. Replay to verify." :
          "Possible mismatch. Replay to check what was said.";
        get("voiceStatus").textContent = "Transcription complete.";
      } catch {
        if (id === attempt) get("voiceStatus").textContent = "Transcription unavailable. Replay and score manually.";
      }
    };
    const stop = () => { if (recorder.state === "recording") recorder.stop(); };
    recorder.start();
    get("stop").onclick = stop;
    get("stop").disabled = false;
    get("voiceStatus").textContent = "Recording…";
    timer = setTimeout(stop, 8000);
  } catch {
    stream?.getTracks().forEach(track => track.stop());
    get("record").disabled = false;
    get("prompt").disabled = false;
    get("voiceStatus").textContent = "Microphone unavailable. Check your browser permissions and retry.";
  }
};
showPrompt();
refreshPlan();

async function setupFixtures() {
  try {
    const response = await fetch("/fixtures.json");
    if (!response.ok) return;
    const fixtures = await response.json();
    const select = get("fixture");
    select.add(new Option("Select a synthetic learner", ""));
    fixtures.forEach((fixture, index) => select.add(new Option(fixture.label, index)));
    get("fixtureLabel").hidden = false;
    select.onchange = () => {
      if (select.value === "") return;
      if (checks.length && !window.confirm("Replace the current demo checks?")) {
        select.value = "";
        return;
      }
      checks = structuredClone(fixtures[Number(select.value)].checks);
      voiceScores.clear();
      refreshVoiceTally();
      override = null;
      get("access").checked = true;
      get("probe").elements.session.value = "2";
      save();
      refreshPlan();
      select.value = "";
    };
  } catch { /* Manual checks remain available. */ }
}
setupFixtures();
