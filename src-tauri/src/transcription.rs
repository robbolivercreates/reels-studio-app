// Video → audio → transcript pipeline for the "Editar vídeo pronto" mode.
//
// Two commands, both shelling out to local binaries (same candidate-list +
// PATH-override pattern as motions.rs / save_dialog.rs, since Tauri does not
// inherit the login shell PATH):
//
//   extract_audio(video_path)        → ffmpeg: video → 16kHz mono wav on disk
//   transcribe_whisper(audio_path)   → openai-whisper CLI → word-level JSON
//
// Work files live under <temp>/reels-edit/<stem>/ so repeated runs on the
// same source reuse the folder. The wav is what the app plays as its master
// audio track; the JSON is parsed on the frontend (transcriptImport.ts) into
// WordTimestamp[] + ScriptBlock[].

use std::path::{Path, PathBuf};
use std::process::Stdio;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

#[derive(Debug, serde::Serialize, Clone)]
pub struct TranscriptionProgress {
    pub stage: String, // "extracting" | "transcribing" | "done" | "error"
    pub message: String,
}

/// PATH passed to child processes so ffmpeg (which whisper also calls
/// internally to load audio) resolves regardless of how the app was launched.
const CHILD_PATH: &str = "/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin:/Library/Frameworks/Python.framework/Versions/3.13/bin";

fn first_existing(candidates: &[&str]) -> String {
    candidates
        .iter()
        .find(|&&p| !p.contains('/') || Path::new(p).exists())
        .copied()
        .unwrap_or(candidates[0])
        .to_string()
}

/// Per-source work directory: ~/Reels Studio/EditVideo/<file-stem>/
/// Lives under "Reels Studio" so the wav is inside the Tauri asset-protocol
/// scope ($HOME/Reels Studio/**) — the frontend can `convertFileSrc` it for
/// both the <audio> master and the fetch-decode that computes waveform peaks.
fn work_dir_for(video_path: &str) -> Result<PathBuf, String> {
    let stem = Path::new(video_path)
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "source".into());
    // Sanitize: no separators / traversal.
    let safe: String = stem
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect();
    let home = dirs::home_dir().ok_or_else(|| "Não consegui resolver o diretório home.".to_string())?;
    let dir = home.join("Reels Studio").join("EditVideo").join(safe);
    std::fs::create_dir_all(&dir).map_err(|e| format!("Falha ao criar pasta de trabalho: {e}"))?;
    Ok(dir)
}

/// Extract the audio track of `video_path` to a 16kHz mono WAV (the format
/// Whisper expects and a clean master for the app). Returns the wav path.
#[tauri::command]
pub async fn extract_audio(app: AppHandle, video_path: String) -> Result<String, String> {
    if !Path::new(&video_path).exists() {
        return Err(format!("Vídeo não encontrado: {video_path}"));
    }
    let dir = work_dir_for(&video_path)?;
    let wav_path = dir.join("audio.wav");
    let wav_str = wav_path.to_string_lossy().into_owned();

    let _ = app.emit("transcription://progress", TranscriptionProgress {
        stage: "extracting".into(),
        message: "Extraindo áudio do vídeo…".into(),
    });

    let ffmpeg = first_existing(&[
        "ffmpeg",
        "/opt/homebrew/bin/ffmpeg",
        "/usr/local/bin/ffmpeg",
        "/usr/bin/ffmpeg",
    ]);

    let output = Command::new(&ffmpeg)
        .env("PATH", CHILD_PATH)
        .args([
            "-y",
            "-i", &video_path,
            "-vn",                 // drop video
            "-ac", "1",            // mono
            "-ar", "16000",        // 16kHz — whisper's native rate
            "-c:a", "pcm_s16le",   // uncompressed wav
            &wav_str,
        ])
        .output()
        .await
        .map_err(|e| format!("ffmpeg não encontrado ou falhou ao iniciar: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("ffmpeg falhou ao extrair áudio:\n{stderr}"));
    }
    if !wav_path.exists() {
        return Err("ffmpeg terminou mas o wav não foi criado.".into());
    }
    Ok(wav_str)
}

/// Extract a HIGH-QUALITY playback master (44.1kHz stereo WAV) from
/// `video_path`. The 16kHz mono wav from `extract_audio` is what Whisper
/// wants, but as the app's playback master it sounds muffled (telephone
/// band). This one feeds the <audio> element / export mux instead.
#[tauri::command]
pub async fn extract_audio_playback(app: AppHandle, video_path: String) -> Result<String, String> {
    if !Path::new(&video_path).exists() {
        return Err(format!("Vídeo não encontrado: {video_path}"));
    }
    let dir = work_dir_for(&video_path)?;
    let wav_path = dir.join("audio_hq.wav");
    let wav_str = wav_path.to_string_lossy().into_owned();

    let _ = app.emit("transcription://progress", TranscriptionProgress {
        stage: "extracting".into(),
        message: "Extraindo áudio em alta qualidade…".into(),
    });

    let ffmpeg = first_existing(&[
        "ffmpeg",
        "/opt/homebrew/bin/ffmpeg",
        "/usr/local/bin/ffmpeg",
        "/usr/bin/ffmpeg",
    ]);

    let output = Command::new(&ffmpeg)
        .env("PATH", CHILD_PATH)
        .args([
            "-y",
            "-i", &video_path,
            "-vn",                 // drop video
            "-ac", "2",            // stereo
            "-ar", "44100",        // full-band playback quality
            "-c:a", "pcm_s16le",   // uncompressed wav
            &wav_str,
        ])
        .output()
        .await
        .map_err(|e| format!("ffmpeg não encontrado ou falhou ao iniciar: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("ffmpeg falhou ao extrair áudio HQ:\n{stderr}"));
    }
    if !wav_path.exists() {
        return Err("ffmpeg terminou mas o wav HQ não foi criado.".into());
    }
    Ok(wav_str)
}

/// Transcribe `audio_path` with the local openai-whisper CLI, producing
/// word-level timestamps. Returns the raw JSON (parsed on the frontend).
/// `model` defaults to "turbo" (downloads ~1.5GB on first use).
#[tauri::command]
pub async fn transcribe_whisper(
    app: AppHandle,
    audio_path: String,
    model: Option<String>,
    language: Option<String>,
) -> Result<String, String> {
    if !Path::new(&audio_path).exists() {
        return Err(format!("Áudio não encontrado: {audio_path}"));
    }
    let model = model.unwrap_or_else(|| "turbo".into());
    let out_dir = Path::new(&audio_path)
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| std::env::temp_dir());
    let out_dir_str = out_dir.to_string_lossy().into_owned();

    let _ = app.emit("transcription://progress", TranscriptionProgress {
        stage: "transcribing".into(),
        message: format!("Transcrevendo com Whisper ({model})… (1ª vez baixa o modelo)"),
    });

    let whisper = first_existing(&[
        "whisper",
        "/Library/Frameworks/Python.framework/Versions/3.13/bin/whisper",
        "/opt/homebrew/bin/whisper",
        "/usr/local/bin/whisper",
    ]);

    let mut cmd = Command::new(&whisper);
    cmd.env("PATH", CHILD_PATH)
        .arg(&audio_path)
        .args(["--model", &model])
        .args(["--word_timestamps", "True"])
        .args(["--output_format", "json"])
        .args(["--output_dir", &out_dir_str])
        .args(["--verbose", "False"]);
    if let Some(lang) = language.as_ref() {
        if !lang.is_empty() && lang != "auto" {
            cmd.args(["--language", lang]);
        }
    }
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("whisper não encontrado ou falhou ao iniciar: {e}. Instale com: pip install openai-whisper"))?;

    // Stream stderr lines as progress (whisper logs model download + segments there).
    if let Some(stderr) = child.stderr.take() {
        let app2 = app.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let trimmed = line.trim();
                if !trimmed.is_empty() {
                    let _ = app2.emit("transcription://progress", TranscriptionProgress {
                        stage: "transcribing".into(),
                        message: trimmed.chars().take(120).collect(),
                    });
                }
            }
        });
    }

    let status = child
        .wait()
        .await
        .map_err(|e| format!("whisper falhou durante a execução: {e}"))?;
    if !status.success() {
        return Err("whisper terminou com erro. Confira se o modelo baixou e se há áudio no vídeo.".into());
    }

    // Whisper writes <audio-stem>.json into out_dir.
    let stem = Path::new(&audio_path)
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "audio".into());
    let json_path = out_dir.join(format!("{stem}.json"));
    if !json_path.exists() {
        return Err("Transcrição terminou mas o JSON não foi encontrado.".into());
    }
    let json = std::fs::read_to_string(&json_path)
        .map_err(|e| format!("Falha ao ler o JSON da transcrição: {e}"))?;

    let _ = app.emit("transcription://progress", TranscriptionProgress {
        stage: "done".into(),
        message: "Transcrição pronta.".into(),
    });
    Ok(json)
}
