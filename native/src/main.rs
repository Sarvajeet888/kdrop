use kdrop_native::{accept, connect, identity, receive_file, send_file, Pairing, Result};
use std::{env, fs::OpenOptions, io::{self, Write}, net::{IpAddr, TcpListener, SocketAddr}, path::Path};

fn create_private(path: &Path, bytes: &[u8]) -> Result<()> {
    let mut options = OpenOptions::new(); options.write(true).create_new(true);
    #[cfg(unix)] {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(path)?; file.write_all(bytes)?; Ok(())
}

fn run() -> Result<()> {
    let args: Vec<String> = env::args().collect();
    match args.get(1).map(String::as_str) {
        Some("receive") if args.len() == 6 => {
            let directory = Path::new(&args[2]);
            let bind: SocketAddr = args[3].parse()?;
            let advertise: IpAddr = args[4].parse()?;
            let listener = TcpListener::bind(bind)?;
            let address = SocketAddr::new(advertise, listener.local_addr()?.port());
            let (pairing, config) = identity(address)?;
            let uri = pairing.encode()?;
            let output = Path::new(&args[5]);
            create_private(output, uri.as_bytes())?;
            let svg = qrcode::QrCode::new(uri.as_bytes())?.render::<qrcode::render::svg::Color>()
                .min_dimensions(320, 320).build();
            let svg_path = output.with_extension("svg");
            if let Err(e) = create_private(&svg_path, svg.as_bytes()) {
                eprintln!("Pairing text saved; QR could not be saved: {e}");
            }
            println!("Listening on {address}. Pairing text: {}", output.display());
            println!("QR: {}. Keep these private; share only with the sender.", svg_path.display());
            println!("Use receive on one computer and send on the other, on the same LAN or hotspot.");
            println!("Leave this process open to retry an interrupted transfer. Ctrl+C stops receiving.");
            for incoming in listener.incoming() {
                let socket = incoming?;
                let peer = socket.peer_addr()?;
                if !kdrop_native::local_ip(peer.ip()) { continue; }
                let result = (|| -> Result<_> {
                    let mut stream = accept(socket, config.clone())?;
                    receive_file(&mut stream, &pairing.token, directory, |offer| {
                        // Debug formatting escapes control characters supplied by remote filenames.
                        println!("\n{peer} offers {:?} ({} bytes). Accept? [y/N]", offer.name, offer.size);
                        let mut answer = String::new();
                        io::stdin().read_line(&mut answer).is_ok() && answer.trim().eq_ignore_ascii_case("y")
                    }, |p| {
                        println!("{:.1} MiB/s received | {} / {} bytes | {}",
                            p.bytes_per_second / 1048576.0, p.received, p.total, p.note);
                    })
                })();
                match result {
                    Ok(path) => println!("Verified and saved: {}", path.display()),
                    Err(error) => eprintln!("Transfer did not complete: {error}. Retry with the same source file and pairing text."),
                }
            }
        },
        Some("send") if args.len() == 4 => {
            // Read capability from a file, keeping it out of command history and process arguments.
            let pairing_path = Path::new(&args[2]);
            if pairing_path.metadata()?.len() > 16384 { return Err("Pairing file too large".into()); }
            let pairing = Pairing::decode(&std::fs::read_to_string(pairing_path)?)?;
            eprintln!("Hashing source, connecting and waiting for receiver approval…");
            let mut stream = connect(&pairing)?;
            send_file(&mut stream, &pairing, Path::new(&args[3]))?;
            println!("Complete: receiver verified and saved the file.");
        },
        _ => {
            println!("KDrop Native — local-transfer prototype\n\nReceive:\n  kdrop-native receive <folder> <bind-ip:port> <LAN-IP> <new-pairing-file>\n\nSend:\n  kdrop-native send <pairing-file> <file>\n\nExample:\n  kdrop-native receive ./received 0.0.0.0:45871 192.168.1.10 pairing.txt\n  kdrop-native send pairing.txt movie.mp4\n\nUse a fresh pairing filename for each receiver launch. No cloud service is required.");
        }
    }
    Ok(())
}

fn main() {
    if let Err(error) = run() { eprintln!("KDrop: {error}"); std::process::exit(1); }
}
