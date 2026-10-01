#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use std::{io, net::{TcpListener, TcpStream, Shutdown, SocketAddr}, path::Path, sync::{Arc, Mutex, atomic::{AtomicBool, Ordering}, mpsc}, time::Duration};
use tauri::{Emitter, Manager};
use serde_json::json;

#[derive(Default)]
struct Control {
    busy: AtomicBool,
    stop: AtomicBool,
    socket: Mutex<Option<TcpStream>>,
    approval: Mutex<Option<mpsc::Sender<bool>>>,
}
type Shared = Arc<Control>;
fn event(app: &tauri::AppHandle, value: serde_json::Value) { let _ = app.emit("transfer", value); }
fn stop(control: &Control) {
    control.stop.store(true, Ordering::SeqCst);
    if let Some(socket) = control.socket.lock().unwrap().take() { let _ = socket.shutdown(Shutdown::Both); }
    if let Some(answer) = control.approval.lock().unwrap().take() { let _ = answer.send(false); }
}
fn finish(app: &tauri::AppHandle, control: &Control, result: Result<(), String>) {
    control.socket.lock().unwrap().take(); control.approval.lock().unwrap().take();
    control.busy.store(false, Ordering::SeqCst);
    event(app, json!({"type":"idle", "error": result.err()}));
}

#[tauri::command]
async fn choose(folder: bool) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let dialog = rfd::FileDialog::new();
        (if folder { dialog.pick_folder() } else { dialog.pick_file() })
            .map(|path| path.to_string_lossy().into_owned())
    }).await.map_err(|e| e.to_string())
}
#[tauri::command]
fn cancel(control: tauri::State<'_, Shared>) { stop(&control); }
#[tauri::command]
fn approve(accepted: bool, control: tauri::State<'_, Shared>) {
    if let Some(answer) = control.approval.lock().unwrap().take() { let _ = answer.send(accepted); }
}
#[tauri::command]
fn receive(directory: String, address: String, app: tauri::AppHandle, control: tauri::State<'_, Shared>) -> Result<(), String> {
    let address: SocketAddr = address.parse::<SocketAddr>().map_err(|e| e.to_string())?;
    if !kdrop_native::local_ip(address.ip()) { return Err("Enter this computer’s LAN IP and port".into()); }
    if control.busy.swap(true, Ordering::SeqCst) { return Err("Stop the current session first".into()); }
    control.stop.store(false, Ordering::SeqCst);
    let control = control.inner().clone();
    std::thread::spawn(move || {
        let result = (|| -> kdrop_native::Result<()> {
            let listener = TcpListener::bind(address)?; listener.set_nonblocking(true)?;
            let (pairing, config) = kdrop_native::identity(listener.local_addr()?)?;
            let uri = pairing.encode()?;
            let qr = qrcode::QrCode::new(uri.as_bytes())?.render::<qrcode::render::svg::Color>().min_dimensions(260,260).build();
            event(&app, json!({"type":"pairing", "uri":uri,"qr":qr}));
            while !control.stop.load(Ordering::SeqCst) {
                let (socket, peer) = match listener.accept() {
                    Ok(pair) => pair,
                    Err(e) if e.kind() == io::ErrorKind::WouldBlock => { std::thread::sleep(Duration::from_millis(100)); continue; },
                    Err(e) => return Err(e.into()),
                };
                if !kdrop_native::local_ip(peer.ip()) { continue; }
                *control.socket.lock().unwrap() = Some(socket.try_clone()?);
                let result = (|| -> kdrop_native::Result<_> {
                    let mut stream = kdrop_native::accept(socket, config.clone())?;
                    kdrop_native::receive_file(&mut stream, &pairing.token, Path::new(&directory), |offer| {
                        if control.stop.load(Ordering::SeqCst) { return false; }
                        let (tx, rx) = mpsc::channel(); *control.approval.lock().unwrap() = Some(tx);
                        event(&app, json!({"type":"offer", "name":offer.name,"size":offer.size}));
                        let accepted = rx.recv_timeout(Duration::from_secs(120)).unwrap_or(false);
                        control.approval.lock().unwrap().take();
                        accepted && !control.stop.load(Ordering::SeqCst)
                    }, |progress| event(&app, json!({"type":"progress","progress":progress})))
                })();
                control.socket.lock().unwrap().take();
                match result {
                    Ok(path) => event(&app, json!({"type":"complete", "path":path})),
                    Err(e) => event(&app, json!({"type":"error", "message":e.to_string()})),
                }
            }
            Ok(())
        })().map_err(|e| e.to_string());
        finish(&app, &control, result);
    });
    Ok(())
}
#[tauri::command]
fn send(pairing: String, path: String, app: tauri::AppHandle, control: tauri::State<'_, Shared>) -> Result<(), String> {
    let pairing = kdrop_native::Pairing::decode(&pairing).map_err(|e| e.to_string())?;
    if control.busy.swap(true, Ordering::SeqCst) { return Err("Stop the current session first".into()); }
    control.stop.store(false, Ordering::SeqCst); let control = control.inner().clone();
    std::thread::spawn(move || {
        let result = (|| -> kdrop_native::Result<()> {
            event(&app, json!({"type":"status", "message":"Connecting, hashing file and waiting for approval…"}));
            let mut stream = kdrop_native::connect(&pairing)?;
            *control.socket.lock().unwrap() = Some(stream.sock.try_clone()?);
            if control.stop.load(Ordering::SeqCst) { return Err("Cancelled".into()); }
            kdrop_native::send_file(&mut stream, &pairing, Path::new(&path))?;
            event(&app, json!({"type":"complete", "path":"Receiver verified and saved the file"}));
            Ok(())
        })().map_err(|e| e.to_string());
        finish(&app, &control, result);
    });
    Ok(())
}
fn main() {
    tauri::Builder::default().manage(Arc::new(Control::default()))
        .invoke_handler(tauri::generate_handler![choose, cancel, approve, receive, send])
        .on_window_event(|window, event| if let tauri::WindowEvent::CloseRequested { .. } = event {
            stop(window.state::<Shared>().inner());
        })
        .run(tauri::generate_context!()).expect("KDrop desktop failed to start");
}
