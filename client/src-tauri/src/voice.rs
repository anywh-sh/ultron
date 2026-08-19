// Voz: gravação de áudio nativa (cpal) + transcrição local (whisper-rs) —
// decisão registrada em docs/07-voz-whisper-local.md. Sem envio de áudio
// pra nenhum serviço externo, sem custo de API.
//
// Modelo Whisper não é baixado automaticamente aqui ainda (evita puxar uma
// dependência HTTP só pra isso nesta fase de validação funcional) — o
// usuário baixa uma vez e a gente só checa se o arquivo existe.

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::Manager;
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

const MODEL_FILENAME: &str = "whisper-ggml-base.bin";
const MODEL_DOWNLOAD_URL: &str = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin";
const WHISPER_SAMPLE_RATE: u32 = 16_000;

pub struct VoiceState {
    buffer: Arc<Mutex<Vec<f32>>>,
    should_stop: Arc<AtomicBool>,
    input_sample_rate: Arc<Mutex<u32>>,
    input_channels: Arc<Mutex<u16>>,
    recording_thread: Mutex<Option<std::thread::JoinHandle<()>>>,
}

impl Default for VoiceState {
    fn default() -> Self {
        Self {
            buffer: Arc::new(Mutex::new(Vec::new())),
            should_stop: Arc::new(AtomicBool::new(false)),
            input_sample_rate: Arc::new(Mutex::new(WHISPER_SAMPLE_RATE)),
            input_channels: Arc::new(Mutex::new(1)),
            recording_thread: Mutex::new(None),
        }
    }
}

#[tauri::command]
pub fn start_recording(state: tauri::State<VoiceState>) -> Result<(), String> {
    state.buffer.lock().map_err(|e| e.to_string())?.clear();
    state.should_stop.store(false, Ordering::SeqCst);

    let buffer = Arc::clone(&state.buffer);
    let should_stop = Arc::clone(&state.should_stop);
    let sample_rate_out = Arc::clone(&state.input_sample_rate);
    let channels_out = Arc::clone(&state.input_channels);

    // cpal::Stream não é Send em todas as plataformas, então ela precisa
    // nascer, viver e morrer inteiramente dentro dessa thread dedicada —
    // não dá pra devolver o Stream pro chamador.
    let handle = std::thread::spawn(move || {
        let host = cpal::default_host();
        let device = match host.default_input_device() {
            Some(d) => d,
            None => {
                eprintln!("[voice] nenhum dispositivo de entrada de áudio encontrado");
                return;
            }
        };
        let config = match device.default_input_config() {
            Ok(c) => c,
            Err(e) => {
                eprintln!("[voice] falha ao obter config de entrada: {e}");
                return;
            }
        };

        *sample_rate_out.lock().unwrap() = config.sample_rate().0;
        *channels_out.lock().unwrap() = config.channels();

        let err_fn = |err: cpal::StreamError| eprintln!("[voice] erro no stream de áudio: {err}");
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
                eprintln!("[voice] formato de amostra não suportado: {other:?}");
                return;
            }
        };

        let stream = match stream {
            Ok(s) => s,
            Err(e) => {
                eprintln!("[voice] falha ao abrir stream de entrada: {e}");
                return;
            }
        };

        if let Err(e) = stream.play() {
            eprintln!("[voice] falha ao iniciar gravação: {e}");
            return;
        }

        while !should_stop.load(Ordering::SeqCst) {
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
        // `stream` é dropado aqui ao sair do escopo, parando a captura.
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
        return Err("nenhum áudio foi capturado".to_string());
    }

    let channels = *state.input_channels.lock().map_err(|e| e.to_string())?;
    let source_rate = *state.input_sample_rate.lock().map_err(|e| e.to_string())?;

    let mono = to_mono(&raw_samples, channels);
    let resampled = resample_linear(&mono, source_rate, WHISPER_SAMPLE_RATE);

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

fn resample_linear(samples: &[f32], from_rate: u32, to_rate: u32) -> Vec<f32> {
    if from_rate == to_rate || samples.is_empty() {
        return samples.to_vec();
    }
    let ratio = from_rate as f64 / to_rate as f64;
    let out_len = (samples.len() as f64 / ratio) as usize;
    (0..out_len)
        .map(|i| {
            let src_pos = i as f64 * ratio;
            let i0 = src_pos.floor() as usize;
            let i1 = (i0 + 1).min(samples.len() - 1);
            let frac = (src_pos - i0 as f64) as f32;
            samples[i0] * (1.0 - frac) + samples[i1] * frac
        })
        .collect()
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

    let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
    params.set_print_progress(false);
    params.set_print_special(false);
    params.set_print_realtime(false);
    params.set_print_timestamps(false);
    params.set_language(Some("pt"));

    whisper_state
        .full(params, samples)
        .map_err(|e| format!("falha ao rodar transcrição: {e}"))?;

    let num_segments = whisper_state
        .full_n_segments()
        .map_err(|e| format!("falha ao ler segmentos: {e}"))?;

    let mut text = String::new();
    for i in 0..num_segments {
        let segment = whisper_state
            .full_get_segment_text(i)
            .map_err(|e| format!("falha ao ler texto do segmento: {e}"))?;
        text.push_str(&segment);
    }

    Ok(text.trim().to_string())
}
