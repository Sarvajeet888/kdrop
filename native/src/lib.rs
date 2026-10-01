//! Local transfer v1: TLS, capability pairing, checksummed frames and prefix-verified resume.
//! Prototype: one file per connection. This is not a 1 GB/s performance claim.
use base64::{engine::general_purpose::URL_SAFE_NO_PAD as B64, Engine};
use rand::{rngs::OsRng, RngCore};
use rustls::{pki_types::{CertificateDer, PrivatePkcs8KeyDer, ServerName},
    ClientConfig, ClientConnection, RootCertStore, ServerConfig, ServerConnection, StreamOwned};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{fs::{self, File, OpenOptions}, io::{self, Read, Write, Seek, SeekFrom},
    net::{IpAddr, SocketAddr, TcpStream}, path::{Path, PathBuf}, sync::Arc, time::{Duration, Instant}};

pub type Result<T> = std::result::Result<T, Box<dyn std::error::Error + Send + Sync>>;
pub const CHUNK: usize = 1024 * 1024;
const MAX_JSON: usize = 16 * 1024;
pub const MAX_FILE: u64 = 1024 * 1024 * 1024 * 1024;

fn invalid(message: &str) -> io::Error { io::Error::new(io::ErrorKind::InvalidData, message) }

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Pairing {
    pub version: u32,
    pub address: SocketAddr,
    pub certificate: String,
    pub token: String,
}

impl Pairing {
    pub fn encode(&self) -> Result<String> {
        Ok(format!("kdrop://pair/{}", B64.encode(serde_json::to_vec(self)?)))
    }
    pub fn decode(uri: &str) -> Result<Self> {
        if uri.len() > MAX_JSON { return Err(invalid("Pairing code too long").into()); }
        let encoded = uri.trim().strip_prefix("kdrop://pair/").ok_or_else(|| invalid("Not a KDrop pairing code"))?;
        let pairing: Self = serde_json::from_slice(&B64.decode(encoded)?)?;
        if pairing.version != 1 || B64.decode(&pairing.token)?.len() != 32 ||
            !local_ip(pairing.address.ip()) || pairing.address.port() == 0 {
            return Err(invalid("Unsupported pairing version, token or non-local address").into());
        }
        Ok(pairing)
    }
}

pub fn local_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => ip.is_private() || ip.is_loopback() || ip.is_link_local(),
        IpAddr::V6(ip) => ip.is_loopback() || ip.is_unique_local() || ip.is_unicast_link_local(),
    }
}

pub fn identity(address: SocketAddr) -> Result<(Pairing, Arc<ServerConfig>)> {
    if !local_ip(address.ip()) || address.port() == 0 { return Err(invalid("Advertise a LAN address").into()); }
    let rcgen::CertifiedKey { cert, key_pair } = rcgen::generate_simple_self_signed(vec!["kdrop.local".into()])?;
    let mut token = [0u8; 32]; OsRng.fill_bytes(&mut token);
    let pairing = Pairing { version: 1, address, certificate: B64.encode(cert.der()), token: B64.encode(token) };
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let config = ServerConfig::builder_with_provider(provider)
        .with_protocol_versions(&[&rustls::version::TLS13])?
        .with_no_client_auth().with_single_cert(vec![cert.der().clone()],
            PrivatePkcs8KeyDer::from(key_pair.serialize_der()).into())?;
    Ok((pairing, Arc::new(config)))
}

fn socket_options(socket: &TcpStream) -> Result<()> {
    socket.set_nodelay(true)?;
    // Receiver can spend time on human approval and prefix verification.
    socket.set_read_timeout(Some(Duration::from_secs(300)))?;
    socket.set_write_timeout(Some(Duration::from_secs(30)))?;
    Ok(())
}

pub fn connect(pairing: &Pairing) -> Result<StreamOwned<ClientConnection, TcpStream>> {
    let mut roots = RootCertStore::empty();
    // Trust only the certificate obtained through the out-of-band pairing code.
    roots.add(CertificateDer::from(B64.decode(&pairing.certificate)?))?;
    let config = ClientConfig::builder_with_provider(Arc::new(rustls::crypto::ring::default_provider()))
        .with_protocol_versions(&[&rustls::version::TLS13])?
        .with_root_certificates(roots).with_no_client_auth();
    let socket = TcpStream::connect_timeout(&pairing.address, Duration::from_secs(10))?;
    socket_options(&socket)?;
    Ok(StreamOwned::new(ClientConnection::new(Arc::new(config), ServerName::try_from("kdrop.local")?)?, socket))
}

pub fn accept(socket: TcpStream, config: Arc<ServerConfig>) -> Result<StreamOwned<ServerConnection, TcpStream>> {
    socket_options(&socket)?;
    Ok(StreamOwned::new(ServerConnection::new(config)?, socket))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Offer { pub name: String, pub size: u64, pub sha256: String }

#[derive(Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case", deny_unknown_fields)]
enum Message {
    Offer { token: String, file: Offer },
    Ready { offset: u64, prefix_sha256: String },
    Start { offset: u64 },
    Done { sha256: String, saved_as: String },
    Reject { reason: String },
}

fn put<S: Write>(stream: &mut S, message: &Message) -> Result<()> {
    let bytes = serde_json::to_vec(message)?;
    if bytes.len() > MAX_JSON { return Err(invalid("Control frame too large").into()); }
    stream.write_all(&(bytes.len() as u32).to_be_bytes())?;
    stream.write_all(&bytes)?; stream.flush()?; Ok(())
}
fn get<S: Read>(stream: &mut S) -> Result<Message> {
    let mut length = [0; 4]; stream.read_exact(&mut length)?;
    let length = u32::from_be_bytes(length) as usize;
    if length == 0 || length > MAX_JSON { return Err(invalid("Invalid control frame length").into()); }
    let mut bytes = vec![0; length]; stream.read_exact(&mut bytes)?;
    Ok(serde_json::from_slice(&bytes)?)
}
fn hash_prefix(file: &mut File, size: u64) -> Result<String> {
    file.seek(SeekFrom::Start(0))?;
    let mut hash = Sha256::new(); let mut remaining = size; let mut buf = vec![0; CHUNK];
    while remaining > 0 {
        let n = remaining.min(CHUNK as u64) as usize;
        file.read_exact(&mut buf[..n])?; hash.update(&buf[..n]); remaining -= n as u64;
    }
    Ok(format!("{:x}", hash.finalize()))
}
fn equal_secret(a: &str, b: &str) -> bool {
    let a = Sha256::digest(a.as_bytes()); let b = Sha256::digest(b.as_bytes());
    a.iter().zip(b.iter()).fold(0u8, |difference, (a, b)| difference | (a ^ b)) == 0
}
fn valid_offer(file: &Offer) -> bool {
    !file.name.is_empty() && file.name.len() <= 255 && file.size <= MAX_FILE &&
        file.sha256.len() == 64 && file.sha256.bytes().all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
}

/// Progress reports received/written bytes, not disk durability until Done.
#[derive(Debug, Clone, Serialize)]
pub struct Progress {
    pub received: u64, pub total: u64, pub bytes_per_second: f64,
    pub resumed_from: u64, pub write_fraction: f64, pub note: &'static str,
}

pub fn send_file<S: Read + Write>(stream: &mut S, pairing: &Pairing, path: &Path) -> Result<()> {
    let mut file = File::open(path)?;
    let metadata = file.metadata()?;
    if !metadata.is_file() || metadata.len() > MAX_FILE { return Err(invalid("Select a regular file up to 1 TiB").into()); }
    let size = metadata.len();
    let digest = hash_prefix(&mut file, size)?;
    let name = path.file_name().ok_or_else(|| invalid("File has no name"))?.to_string_lossy().into_owned();
    let offer = Offer { name, size, sha256: digest.clone() };
    if !valid_offer(&offer) { return Err(invalid("Unsupported filename or size").into()); }
    put(stream, &Message::Offer { token: pairing.token.clone(), file: offer })?;
    let (offset, prefix) = match get(stream)? {
        Message::Ready { offset, prefix_sha256 } if offset <= size => (offset, prefix_sha256),
        Message::Reject { reason } => return Err(invalid(&reason).into()),
        _ => return Err(invalid("Receiver sent an invalid response").into()),
    };
    // A stale or corrupted partial is restarted instead of trusting its length.
    let offset = if hash_prefix(&mut file, offset)? == prefix { offset } else { 0 };
    put(stream, &Message::Start { offset })?;
    file.seek(SeekFrom::Start(offset))?;
    let mut remaining = size - offset; let mut buf = vec![0; CHUNK];
    while remaining > 0 {
        let n = remaining.min(CHUNK as u64) as usize;
        file.read_exact(&mut buf[..n])?;
        stream.write_all(&(n as u32).to_be_bytes())?;
        stream.write_all(&Sha256::digest(&buf[..n]))?;
        stream.write_all(&buf[..n])?;
        remaining -= n as u64;
    }
    stream.flush()?;
    match get(stream)? {
        Message::Done { sha256, .. } if sha256 == digest => Ok(()),
        Message::Reject { reason } => Err(invalid(&reason).into()),
        _ => Err(invalid("No verified delivery receipt").into()),
    }
}

fn private_directory(path: &Path) -> Result<()> {
    match fs::symlink_metadata(path) {
        Ok(meta) if meta.file_type().is_symlink() || !meta.is_dir() => return Err(invalid("Unsafe partial directory").into()),
        Ok(_) => {},
        Err(e) if e.kind() == io::ErrorKind::NotFound => fs::create_dir(path)?,
        Err(e) => return Err(e.into()),
    }
    #[cfg(unix)] {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))?;
    }
    Ok(())
}

fn safe_name(name: &str) -> String {
    // Prefix on publication avoids Windows reserved basenames; never use remote paths.
    let clean: String = name.chars().map(|c| if c.is_control() || "<>:\"/\\|?*".contains(c) { '_' } else { c })
        .take(80).collect();
    let clean = clean.trim_matches(|c| c == '.' || c == ' ');
    if clean.is_empty() { "file".into() } else { clean.into() }
}

pub fn receive_file<S, A, P>(stream: &mut S, token: &str, directory: &Path,
    mut approve: A, mut progress: P) -> Result<PathBuf>
where S: Read + Write, A: FnMut(&Offer) -> bool, P: FnMut(Progress) {
    let offer = match get(stream)? {
        Message::Offer { token: supplied, file } if equal_secret(&supplied, token) && valid_offer(&file) => file,
        _ => { put(stream, &Message::Reject { reason: "Invalid pairing or offer".into() })?;
            return Err(invalid("Invalid pairing or offer").into()); }
    };
    if !approve(&offer) {
        put(stream, &Message::Reject { reason: "Receiver declined".into() })?;
        return Err(invalid("Receiver declined").into());
    }
    fs::create_dir_all(directory)?;
    let directory = directory.canonicalize()?;
    let partials = directory.join(".kdrop-partials"); private_directory(&partials)?;
    let part = partials.join(format!("{}.part", offer.sha256));
    if let Ok(meta) = fs::symlink_metadata(&part) {
        if !meta.is_file() || meta.file_type().is_symlink() { return Err(invalid("Unsafe partial file").into()); }
    }
    let mut output = OpenOptions::new().read(true).write(true).create(true).truncate(false).open(&part)?;
    let offset = output.metadata()?.len();
    let offset = if offset <= offer.size { offset } else { output.set_len(0)?; 0 };
    let prefix = hash_prefix(&mut output, offset)?;
    put(stream, &Message::Ready { offset, prefix_sha256: prefix })?;
    let offset = match get(stream)? {
        Message::Start { offset: start } if start == 0 || start == offset => start,
        _ => return Err(invalid("Invalid resume offset").into()),
    };
    output.set_len(offset)?; output.seek(SeekFrom::Start(offset))?;
    let start = Instant::now(); let mut last = Instant::now();
    let mut written = offset; let mut write_time = Duration::ZERO; let mut buf = vec![0; CHUNK];
    while written < offer.size {
        let mut n = [0; 4]; stream.read_exact(&mut n)?;
        let n = u32::from_be_bytes(n) as usize;
        if n == 0 || n > CHUNK || n as u64 > offer.size - written { return Err(invalid("Invalid chunk length").into()); }
        let mut digest = [0; 32]; stream.read_exact(&mut digest)?; stream.read_exact(&mut buf[..n])?;
        if Sha256::digest(&buf[..n])[..] != digest { return Err(invalid("Chunk checksum mismatch").into()); }
        let writing = Instant::now(); output.write_all(&buf[..n])?; write_time += writing.elapsed();
        written += n as u64;
        if last.elapsed() >= Duration::from_millis(500) || written == offer.size {
            let elapsed = start.elapsed().as_secs_f64().max(0.000001);
            let fraction = write_time.as_secs_f64() / elapsed;
            progress(Progress { received: written, total: offer.size, resumed_from: offset,
                bytes_per_second: (written - offset) as f64 / elapsed, write_fraction: fraction,
                note: if fraction >= 0.7 { "Measured storage writes occupy most receive time" }
                    else { "Direct TLS connection; no cloud relay. Maximum link capacity is not measured" } });
            last = Instant::now();
        }
    }
    output.sync_all()?;
    if hash_prefix(&mut output, offer.size)? != offer.sha256 {
        output.set_len(0)?; output.sync_all()?;
        put(stream, &Message::Reject { reason: "File checksum mismatch; retry from the start".into() })?;
        return Err(invalid("File checksum mismatch").into());
    }
    drop(output);
    // Same-volume hard link publishes without replacing any existing destination.
    let mut saved = None;
    for suffix in 0..1000 {
        let name = format!("kdrop-{}-{}-{}", &offer.sha256[..12], suffix, safe_name(&offer.name));
        let candidate = directory.join(name);
        match fs::hard_link(&part, &candidate) {
            Ok(_) => { saved = Some(candidate); break; },
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e.into()),
        }
    }
    let saved = saved.ok_or_else(|| invalid("Too many filename collisions"))?;
    fs::remove_file(&part)?;
    put(stream, &Message::Done { sha256: offer.sha256,
        saved_as: saved.file_name().unwrap().to_string_lossy().into_owned() })?;
    Ok(saved)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{net::TcpListener, thread};
    #[test]
    fn pairing_rejects_public_routes_and_bad_versions() {
        assert!(Pairing::decode("https://example.com").is_err());
        let (mut p, _) = identity("127.0.0.1:9000".parse().unwrap()).unwrap();
        assert!(Pairing::decode(&p.encode().unwrap()).is_ok());
        p.version = 2; assert!(Pairing::decode(&p.encode().unwrap()).is_err());
        p.version = 1; p.address = "8.8.8.8:9000".parse().unwrap();
        assert!(Pairing::decode(&p.encode().unwrap()).is_err());
    }
    #[test]
    fn oversized_control_frame_is_rejected() {
        assert!(get(&mut io::Cursor::new(u32::MAX.to_be_bytes())).is_err());
        assert_eq!(safe_name("../../bad:name"), "_.._bad_name");
    }
    fn transfer(size: usize, partial: Option<Vec<u8>>, approve: bool, wrong_token: bool) {
        let source = tempfile::tempdir().unwrap(); let target = tempfile::tempdir().unwrap();
        let bytes: Vec<u8> = (0..size).map(|i| (i.wrapping_mul(31) % 251) as u8).collect();
        let path = source.path().join("test.bin"); fs::write(&path, &bytes).unwrap();
        if let Some(data) = partial {
            let parts = target.path().join(".kdrop-partials"); fs::create_dir(&parts).unwrap();
            fs::write(parts.join(format!("{:x}.part", Sha256::digest(&bytes))), data).unwrap();
        }
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let (pairing, config) = identity(listener.local_addr().unwrap()).unwrap();
        let receiver_pairing = pairing.clone(); let directory = target.path().to_owned();
        let worker = thread::spawn(move || {
            let (socket, _) = listener.accept().unwrap();
            let mut stream = accept(socket, config).unwrap();
            receive_file(&mut stream, &receiver_pairing.token, &directory, |_| approve, |_| {})
        });
        let mut stream = connect(&pairing).unwrap(); let mut p = pairing.clone();
        if wrong_token { p.token = "wrong".into(); }
        let result = send_file(&mut stream, &p, &path);
        let received = worker.join().unwrap();
        if approve && !wrong_token {
            result.unwrap(); assert_eq!(fs::read(received.unwrap()).unwrap(), bytes);
        } else { assert!(result.is_err()); assert!(received.is_err()); }
    }
    #[test] fn tls_exact_bytes() { transfer(CHUNK * 3 + 71, None, true, false); }
    #[test] fn empty_file() { transfer(0, None, true, false); }
    #[test] fn resume_valid_prefix() {
        let partial = (0usize..12345).map(|i| (i * 31 % 251) as u8).collect();
        transfer(CHUNK * 2, Some(partial), true, false);
    }
    #[test] fn corrupted_partial_restarts() { transfer(CHUNK + 12, Some(vec![7; 9876]), true, false); }
    #[test] fn receiver_can_decline() { transfer(12, None, false, false); }
    #[test] fn wrong_pairing_token_fails() { transfer(12, None, true, true); }
    #[test]
    fn interrupted_tls_transfer_resumes() {
        let source = tempfile::tempdir().unwrap(); let target = tempfile::tempdir().unwrap();
        let bytes = vec![42u8; CHUNK * 2 + 17];
        let digest = format!("{:x}", Sha256::digest(&bytes));
        let path = source.path().join("resume.bin"); fs::write(&path, &bytes).unwrap();
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let (pairing, config) = identity(listener.local_addr().unwrap()).unwrap();
        let token = pairing.token.clone(); let directory = target.path().to_owned();
        let worker = thread::spawn(move || {
            let mut stream = accept(listener.accept().unwrap().0, config.clone()).unwrap();
            assert!(receive_file(&mut stream, &token, &directory, |_| true, |_| {}).is_err());
            let mut stream = accept(listener.accept().unwrap().0, config).unwrap();
            let mut resumed = 0;
            let saved = receive_file(&mut stream, &token, &directory, |_| true, |p| resumed = p.resumed_from).unwrap();
            assert_eq!(resumed, CHUNK as u64);
            saved
        });
        let mut stream = connect(&pairing).unwrap();
        put(&mut stream, &Message::Offer { token: pairing.token.clone(),
            file: Offer { name: "resume.bin".into(), size: bytes.len() as u64, sha256: digest } }).unwrap();
        assert!(matches!(get(&mut stream).unwrap(), Message::Ready { offset: 0, .. }));
        put(&mut stream, &Message::Start { offset: 0 }).unwrap();
        stream.write_all(&(CHUNK as u32).to_be_bytes()).unwrap();
        stream.write_all(&Sha256::digest(&bytes[..CHUNK])).unwrap();
        stream.write_all(&bytes[..CHUNK]).unwrap(); stream.flush().unwrap();
        drop(stream);
        let mut stream = connect(&pairing).unwrap(); send_file(&mut stream, &pairing, &path).unwrap();
        assert_eq!(fs::read(worker.join().unwrap()).unwrap(), bytes);
    }
}
