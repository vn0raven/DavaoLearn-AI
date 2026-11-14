$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech

$engine = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
    $voice = $engine.GetInstalledVoices() |
        Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.TwoLetterISOLanguageName -eq 'en' } |
        Sort-Object { if ($_.VoiceInfo.Culture.Name -eq 'en-PH') { 0 } elseif ($_.VoiceInfo.Culture.Name -eq 'en-US') { 1 } else { 2 } } |
        Select-Object -First 1
    if (-not $voice) { throw 'Install an English Windows desktop speech voice.' }
    $engine.SelectVoice($voice.VoiceInfo.Name)
    if ($env:LITERA_TTS_SPEED -eq 'slow') { $engine.Rate = -3 }
    $engine.SetOutputToWaveFile((Join-Path (Get-Location).Path 'output.wav'))
    $engine.Speak([IO.File]::ReadAllText((Join-Path (Get-Location).Path 'input.txt')))
} finally {
    $engine.Dispose()
}
