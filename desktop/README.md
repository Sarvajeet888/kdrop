# KDrop Windows preview source

Tauri 2 interface over `../native`. It includes file/directory selection, private
QR pairing, explicit receiver approval, received-throughput explanations and
session cancellation. It does not use Render or the browser relay protocol.

On Windows install stable Rust, Visual Studio C++ Build Tools (Desktop development
with C++), and WebView2. Then from this folder:

```powershell
cargo install tauri-cli --version '^2' --locked
cargo tauri dev
# Installer:
cargo tauri build --bundles nsis
```

Select the destination and enter your computer's actual LAN IPv4 address and a
port, e.g. `192.168.1.10:45871`. The receiver binds that interface. Allow KDrop on
your private network in Windows Firewall. Scan its QR from Android or paste its
code into another desktop client. Approval expires after two minutes.

Stop receiving before sending. Each app runs one session at a time. Sender UI
reports phases and waits for verified completion; live receiver-confirmed speed
is currently displayed on the receiving device. It is not inferred from queued
sender bytes. Closing the window shuts down the active connection.

The current native storage engine requires hard-link support (NTFS recommended).
No installers were produced or tested in the authoring environment. Build checks
and artifact upload are configured in `.github/workflows/apps.yml`, but this
branch must be published before GitHub can run them. This is unverified preview
source, not a signed/released Windows product.
