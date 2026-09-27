# K-Drop interface update

The existing Bone / Graphite / Vermillion palette and flat visual identity are retained.

## What changed
- Larger editorial typography, clearer spacing, and a custom animated laptop-to-phone illustration.
- Desktop connection and transfer cards sit side by side; mobile uses a single column.
- Refined QR panel, buttons, inputs, file drop target, tabs, and empty states.
- Hover/press feedback, animated file movement, and connection-card highlights when selecting Send or Receive.
- Pause/resume motion control with a saved local preference, including the connection trace. System reduced-motion preferences take precedence for decorative animation.
- Skip-to-transfer link and arrow/Home/End keyboard navigation for enabled file/text tabs.
- Offline cache version and asset list updated. Privacy policy and its generator document the animation preference.

The new helper labels are English; existing translated controls continue to use the existing translations.

## Run locally on Windows
1. Extract the ZIP and open PowerShell inside the `kdrop` folder containing `package.json`.
2. Run `npm ci`.
3. Run `npm start`.
4. Open `http://localhost:3000`.

## Deploy the interface
Copy the updated project into your existing source repository and deploy through your existing hosting setup. Keep the current backend URL and deployment configuration. No new frontend dependencies are needed.

This archive does not itself update the live Vercel deployment. The app still needs the existing Node/WebSocket backend; Vercel static hosting alone does not replace that server. Refer to DEPLOY.md for the project's backend setup.

## Verification performed
- Started the existing Node server successfully.
- Chromium: desktop (1440px), tablet (768px), and phones (390px and 320px), with no horizontal overflow or uncaught page errors.
- Verified pairing code generation, receive-role selection, and motion toggle.
- Two browser sessions: verified file contents and text delivery. Subsequent explicit route checks showed relay fallback in this environment; actual direct WebRTC was not verified. See TRANSFER-FIXES.md.
- Verified keyboard tab switching and reduced-motion CSS behavior.
- Existing protocol and legal suites passed.

Production deployment and real physical-device/network testing have not been performed.
