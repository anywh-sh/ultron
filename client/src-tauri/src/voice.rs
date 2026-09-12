// Voice: native audio recording (cpal) + local transcription (whisper-rs).
// No audio is sent to any external service, no API cost.
//
// The Whisper model isn't downloaded automatically here yet (avoids pulling
// in an HTTP dependency just for that at this functional-validation stage)
// — the user downloads it once and we just check whether the file exists.

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use rubato::{Resampler, SincFixedIn, SincInterpolationParameters, SincInterpolationType, WindowFunction};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::Manager;
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

// "small" instead of "base": in the user's real-world test, "base" got a
// short phrase wrong with an English word mixed in ("digite echo teste" ->
// "de gite, ecotece") — "small" is noticeably more accurate in that kind of
// case, and the client's hardware handles it fine.
const MODEL_FILENAME: &str = "whisper-ggml-small.bin";
const MODEL_DOWNLOAD_URL: &str = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin";
const WHISPER_SAMPLE_RATE: u32 = 16_000;

pub struct VoiceState {
    buffer: Arc<Mutex<Vec<f32>>>,
    should_stop: Arc<AtomicBool>,
    input_sample_rate: Arc<Mutex<u32>>,
    input_channels: Arc<Mutex<u16>>,
    recording_thread: Mutex<Option<std::thread::JoinHandle<()>>>,
    active_device_name: Arc<Mutex<Option<String>>>,
    recording_started_at: Mutex<Option<std::time::Instant>>,
}

impl Default for VoiceState {
    fn default() -> Self {
        Self {
            buffer: Arc::new(Mutex::new(Vec::new())),
            should_stop: Arc::new(AtomicBool::new(false)),
            input_sample_rate: Arc::new(Mutex::new(WHISPER_SAMPLE_RATE)),
            input_channels: Arc::new(Mutex::new(1)),
            recording_thread: Mutex::new(None),
            active_device_name: Arc::new(Mutex::new(None)),
            recording_started_at: Mutex::new(None),
        }
    }
}

#[tauri::command]
pub fn list_input_devices() -> Result<Vec<String>, String> {
    let host = cpal::default_host();
    let devices = host.input_devices().map_err(|e| e.to_string())?;
    Ok(devices.filter_map(|d| d.name().ok()).collect())
}

#[tauri::command]
pub fn start_recording(
    device_name: Option<String>,
    state: tauri::State<VoiceState>,
) -> Result<(), String> {
    state.buffer.lock().map_err(|e| e.to_string())?.clear();
    state.should_stop.store(false, Ordering::SeqCst);
    *state.recording_started_at.lock().map_err(|e| e.to_string())? = Some(std::time::Instant::now());

    let buffer = Arc::clone(&state.buffer);
    let should_stop = Arc::clone(&state.should_stop);
    let sample_rate_out = Arc::clone(&state.input_sample_rate);
    let channels_out = Arc::clone(&state.input_channels);
    let active_device_name_out = Arc::clone(&state.active_device_name);

    // cpal::Stream isn't Send on every platform, so it needs to be born,
    // live, and die entirely inside this dedicated thread — it can't be
    // returned to the caller.
    let handle = std::thread::spawn(move || {
        let host = cpal::default_host();
        let device = match &device_name {
            Some(wanted) => host
                .input_devices()
                .ok()
                .and_then(|mut devices| devices.find(|d| d.name().ok().as_deref() == Some(wanted.as_str())))
                .or_else(|| {
                    eprintln!("[voice] device '{wanted}' not found, using the default");
                    host.default_input_device()
                }),
            None => host.default_input_device(),
        };
        let device = match device {
            Some(d) => d,
            None => {
                eprintln!("[voice] no audio input device found");
                return;
            }
        };

        *active_device_name_out.lock().unwrap() = device.name().ok();

        let config = match device.default_input_config() {
            Ok(c) => c,
            Err(e) => {
                eprintln!("[voice] failed to get input config: {e}");
                return;
            }
        };

        *sample_rate_out.lock().unwrap() = config.sample_rate().0;
        *channels_out.lock().unwrap() = config.channels();

        let err_fn = |err: cpal::StreamError| eprintln!("[voice] audio stream error: {err}");
        let stream_buffer = Arc::clone(&buffer);

        let stream = match config.sample_format() {
            cpal::SampleFormat::F32 => device.build_input_stream(
                &config.into(),
                move |data: &[f32], _| {
                    stream_buffer.lock().unwrap().extend_from_slice(data);
                },
                err_fn,
                None,
            ),
            cpal::SampleFormat::I16 => device.build_input_stream(
                &config.into(),
                move |data: &[i16], _| {
                    let mut buf = stream_buffer.lock().unwrap();
                    buf.extend(data.iter().map(|s| *s as f32 / i16::MAX as f32));
                },
                err_fn,
                None,
            ),
            other => {
                eprintln!("[voice] unsupported sample format: {other:?}");
                return;
            }
        };

        let stream = match stream {
            Ok(s) => s,
            Err(e) => {
                eprintln!("[voice] failed to open input stream: {e}");
                return;
            }
        };

        if let Err(e) = stream.play() {
            eprintln!("[voice] failed to start recording: {e}");
            return;
        }

        while !should_stop.load(Ordering::SeqCst) {
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        // `stream` is dropped here on scope exit, stopping the capture.
    });

    *state.recording_thread.lock().map_err(|e| e.to_string())? = Some(handle);
    Ok(())
}

#[tauri::command]
pub fn stop_recording_and_transcribe(
    app: tauri::AppHandle,
    state: tauri::State<VoiceState>,
) -> Result<String, String> {
    state.should_stop.store(true, Ordering::SeqCst);
    if let Some(handle) = state.recording_thread.lock().map_err(|e| e.to_string())?.take() {
        handle.join().map_err(|_| "thread de gravação travou".to_string())?;
    }

    let raw_samples = state.buffer.lock().map_err(|e| e.to_string())?.clone();
    if raw_samples.is_empty() {
        let device = state
            .active_device_name
            .lock()
            .map_err(|e| e.to_string())?
            .clone()
            .unwrap_or_else(|| "desconhecido".to_string());
        let elapsed = state
            .recording_started_at
            .lock()
            .map_err(|e| e.to_string())?
            .map(|t| t.elapsed().as_secs_f32())
            .unwrap_or(0.0);
        return Err(format!(
            "nenhum áudio foi capturado (dispositivo: \"{device}\", gravou por {elapsed:.1}s) — \
             tente escolher outro microfone no seletor, ou verifique a permissão de microfone do Windows pro app"
        ));
    }

    let channels = *state.input_channels.lock().map_err(|e| e.to_string())?;
    let source_rate = *state.input_sample_rate.lock().map_err(|e| e.to_string())?;

    let mono = to_mono(&raw_samples, channels);
    let resampled = resample(&mono, source_rate, WHISPER_SAMPLE_RATE)?;

    transcribe(&app, &resampled)
}

fn to_mono(samples: &[f32], channels: u16) -> Vec<f32> {
    if channels <= 1 {
        return samples.to_vec();
    }
    let channels = channels as usize;
    samples
        .chunks(channels)
        .map(|frame| frame.iter().sum::<f32>() / frame.len() as f32)
        .collect()
}

/// High-quality resampling (sinc/windowed-sinc) via `rubato`, instead of the
/// simple linear interpolation from the first version — which likely
/// contributed to wrong transcriptions like "digite echo teste" turning into
/// "de gite, ecotece".
fn resample(samples: &[f32], from_rate: u32, to_rate: u32) -> Result<Vec<f32>, String> {
    if from_rate == to_rate || samples.is_empty() {
        return Ok(samples.to_vec());
    }

    let params = SincInterpolationParameters {
        sinc_len: 256,
        f_cutoff: 0.95,
        oversampling_factor: 256,
        interpolation: SincInterpolationType::Cubic,
        window: WindowFunction::BlackmanHarris2,
    };

    let chunk_size = 1024;
    let mut resampler = SincFixedIn::<f32>::new(
        to_rate as f64 / from_rate as f64,
        2.0,
        params,
        chunk_size,
        1,
    )
    .map_err(|e| format!("falha ao criar resampler: {e}"))?;

    let mut output = Vec::new();
    let mut offset = 0;
    while offset < samples.len() {
        let end = (offset + chunk_size).min(samples.len());
        let mut chunk = samples[offset..end].to_vec();
        chunk.resize(chunk_size, 0.0); // last chunk: pad with silence
        offset = end;

        let processed = resampler
            .process(&[chunk], None)
            .map_err(|e| format!("falha ao reamostrar áudio: {e}"))?;
        output.extend_from_slice(&processed[0]);
    }

    Ok(output)
}

fn model_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("não achei o diretório de dados do app: {e}"))?;
    Ok(dir.join(MODEL_FILENAME))
}

fn transcribe(app: &tauri::AppHandle, samples: &[f32]) -> Result<String, String> {
    let path = model_path(app)?;
    if !path.exists() {
        return Err(format!(
            "modelo do Whisper não encontrado em {}. Baixe uma vez de {} e salve nesse caminho.",
            path.display(),
            MODEL_DOWNLOAD_URL
        ));
    }

    let ctx = WhisperContext::new_with_params(
        path.to_str().ok_or("caminho do modelo com caracteres inválidos")?,
        WhisperContextParameters::default(),
    )
    .map_err(|e| format!("falha ao carregar modelo Whisper: {e}"))?;

    let mut whisper_state = ctx
        .create_state()
        .map_err(|e| format!("falha ao criar estado do Whisper: {e}"))?;

    let mut params = FullParams::new(SamplingStrategy::BeamSearch {
        beam_size: 5,
        patience: 1.0,
    });
    params.set_print_progress(false);
    params.set_print_special(false);
    params.set_print_realtime(false);
    params.set_print_timestamps(false);
    params.set_language(Some("pt"));

    whisper_state
        .full(params, samples)
        .map_err(|e| format!("falha ao rodar transcrição: {e}"))?;

    let num_segments = whisper_state.full_n_segments();

    let mut text = String::new();
    for i in 0..num_segments {
        let segment = whisper_state
            .get_segment(i)
            .ok_or_else(|| format!("segmento {i} não encontrado"))?
            .to_str()
            .map_err(|e| format!("falha ao ler texto do segmento: {e}"))?
            .to_string();
        text.push_str(&segment);
    }

    Ok(text.trim().to_string())
}
