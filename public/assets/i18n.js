/**
 * K-Drop internationalisation.
 *
 * Strings live here, keyed by a dotted path. Markup carries data-i18n
 * attributes and is filled in at load, so adding a language means adding one
 * object below — no template changes.
 *
 * Language is chosen in this order:
 *   1. ?lang= in the URL
 *   2. a previous choice saved in this browser
 *   3. the browser's own language setting
 *   4. English
 *
 * TRANSLATION STATUS
 *   en  English  — source of truth
 *   hi  Hindi    — complete
 *
 * Spanish, Portuguese, French, German, Japanese, Korean and Arabic are not
 * here yet, and that is deliberate. The infrastructure supports them — copy
 * the `en` block, translate the values, and it appears in the language menu;
 * right-to-left layout is already handled. But these pages make specific
 * claims about what happens to people's files, and a translation of a privacy
 * claim should come from someone who speaks the language rather than from a
 * guess. A wrong one is worse than none.
 */

export const RTL = new Set(['ar', 'he', 'fa', 'ur']);

const STRINGS = {
  /* ------------------------------------------------------------ English */
  en: {
    _name: 'English',
    nav: { how: 'How it works', docs: 'Docs', connecting: 'Connecting', online: 'Online', offline: 'Reconnecting' },

    hero: {
      eyebrow: 'Free file transfer',
      title: 'Send files between devices.',
      lead: 'No account. No installation. No complicated setup.',
      send: 'Send files',
      receive: 'Receive files',
    },

    env: {
      noWebrtc: 'This browser cannot make direct connections between devices, so K-Drop will not work here. Chrome, Edge, Firefox and Safari all support it.',
      insecure: 'This page is not on a secure connection, so the PIN encryption and the save-to-folder picker are switched off. Transfers still work and are still encrypted by the browser itself. This is normal when testing on a local address — a deployed site over https has everything on.',
      noCrypto: 'This browser does not provide the encryption K-Drop uses for the fallback route. Direct transfers still work.',
      noStreaming: 'This browser holds an incoming file in memory before saving, so very large files may fail. Chrome and Edge write to disk as data arrives.',
    },

    role: {
      sending: 'You are sending.',
      receiving: 'You are receiving.',
      swap: 'Switch',
      swapToReceive: 'Receive instead',
      swapToSend: 'Send instead',
      orShowYours: 'or let the other device scan your code instead',
      sendPairTitle: 'Connect the device you are sending to',
      receivePairTitle: 'Connect the device sending to you',
      readyTitle: 'Ready to receive',
      readyBody: 'Nothing to do here. When the other device sends something, you will be asked whether to accept it.',
    },

    pair: {
      step: '01',
      title: 'Connect your other device',
      titlePhone: 'Connect your computer',
      waiting: 'Waiting',
      connected: 'Connected',
      code: 'Code',
      gettingCode: 'Getting a code…',
      pin: 'PIN',
      qrHere: 'QR code appears here',
      copyLink: 'Copy link',
      copied: 'Copied',
      orEnter: 'or enter the code and PIN from another device',
      joinPlaceholder: 'Code, then PIN',
      connect: 'Connect',
      newCode: 'New code',
      rename: 'Name this device',
      measurement: 'Measurement',
      resolved: 'Resolved',
      notConnected: 'Not connected',
      direct: 'Direct',
      relayed: 'Relayed',
    },

    send: {
      step: '02',
      title: 'Choose what to send',
      firstStep: 'Step 1 first',
      ready: 'Ready',
      files: 'Files',
      text: 'Text',
      drop: 'Drop files here',
      dropSubLocked: 'Connect the other device first',
      dropSubDirect: 'Straight to the other device — nothing touches a server',
      dropSubRelay: 'Encrypted through the relay — the server cannot read it',
      choose: 'Choose files',
      chooseFolder: 'Choose a folder',
      notePlaceholder: "A link, an address, a Wi-Fi password — anything you'd rather not retype on the other device.",
      sendText: 'Send text',
      devices: 'Devices',
      noDevices: 'No other device yet.',
      scanPrompt: 'Scan the code above with your phone.',
      transfers: 'Transfers',
      nothingSent: 'Nothing sent yet.',
      queued: 'Queued',
      preparing: 'Looking at the files…',
      waitingAccept: 'Waiting for the other device',
      sending: 'Sending',
      sent: 'Sent',
      failed: 'Failed',
      cancelled: 'Cancelled',
      declined: 'Declined',
      paused: 'Paused',
      resuming: 'Resuming',
      interrupted: 'Connection lost — waiting to resume',
      pause: 'Pause',
      resume: 'Resume',
      cancel: 'Cancel',
      save: 'Save',
      history: 'Recent transfers',
      noHistory: 'Nothing yet. Transfers you make are remembered on this device only.',
      clearHistory: 'Clear history',
      today: 'Today',
      yesterday: 'Yesterday',
      earlier: 'Earlier',
    },

    how: {
      eyebrow: 'How it works',
      title: 'The file goes between your devices, not through ours.',
      lead: 'Most transfer tools upload your file to a datacentre and download it again. K-Drop opens a connection between the two browsers instead. On the same Wi-Fi, the bytes never leave the building.',
      s1t: 'Open K-Drop',
      s1b: 'Open the website on both devices. Nothing to install, nothing to sign up for.',
      s2t: 'Connect',
      s2b: 'Scan the QR code, or type the code and PIN shown on the other device.',
      s3t: 'Send',
      s3b: 'Choose your files. They move directly, and are checked on arrival.',
    },

    why: {
      title: 'Why K-Drop',
      fastT: 'Fast',
      fastB: 'Direct device-to-device transfers whenever the network allows it.',
      privateT: 'Private',
      privateB: 'No permanent storage. Your files are never written to our disks.',
      simpleT: 'Simple',
      simpleB: 'No accounts, no software, no settings to work through.',
      everywhereT: 'Everywhere',
      everywhereB: 'Computers, phones and tablets, in any modern browser.',
    },

    devices: { title: 'Works on' },

    faq: {
      title: 'Questions',
      lead: 'Short answers. The full detail is in the',
      docsLink: 'documentation',
      q1: 'Is K-Drop free?',
      a1: 'Yes. No account, no paid tier, no advertising. It is free to use and the code is open.',
      q2: 'Do I need an account?',
      a2: 'No. There is nothing to sign up for. Open the page on two devices and match the code.',
      q3: 'Are my files stored?',
      a3: 'No. On the direct route your file never reaches our server at all. When a network blocks that route, the file passes through our relay encrypted on your own device, and is forwarded without ever being written to disk.',
      q4: 'What is the maximum file size?',
      a4: 'On Chrome and Edge there is no practical limit — files are written to your disk as they arrive. On Safari and Firefox the file must fit in the browser\u2019s memory first, so very large files can fail there.',
      q5: 'Does it work between iPhone and Windows?',
      a5: 'Yes. K-Drop runs in the browser, so any combination of Windows, macOS, Linux, Android, iPhone and iPad works.',
      q6: 'Do I need to install an app?',
      a6: 'No. You can add K-Drop to your home screen so it opens like an app, but that is optional and installs nothing.',
      q7: 'Do both devices need the same Wi-Fi?',
      a7: 'No, but it is faster if they do. Across different networks it still works; on some restrictive networks it falls back to a slower relayed route, and the page tells you when that happens.',
      q8: 'What happens if I close the tab?',
      a8: 'The transfer stops. K-Drop is not storage — there is no mailbox holding your file for later. Both devices must stay open until it finishes.',
    },

    toast: {
      joined: 'joined',
      left: 'left',
      accepted: 'Accepted — sending now.',
      declined: 'The other device declined.',
      sent: 'Sent.',
      received: 'Received.',
      failed: 'That transfer failed. Try again.',
      corrupt: 'Some files arrived corrupted.',
      textSent: 'Text sent.',
      textReceived: 'Text received.',
      noDevice: 'No device connected yet.',
      oneAtATime: 'One transfer at a time — let this one finish.',
      needPin: 'Enter the code and the PIN together — both are shown on the other device.',
      needPinLong: 'Enter the six-character code followed by the four-character PIN.',
      badCode: 'That code has expired or was mistyped.',
      full: 'That session is full.',
      rateLimited: 'Too many sessions started from here. Try again in a little while.',
      tooMany: 'Too many tabs open from this network. Close a few and reload.',
      expired: 'Session expired after 30 minutes. Starting a new one.',
      newCode: 'New code.',
      copyManually: 'Press Ctrl+C to copy the link.',
      historyCleared: 'History cleared.',
      shareQueued: 'ready to send — connect your other device.',
      shareReady: 'Shared text is ready to send.',
      shareFailed: 'Could not read the shared files.',
      resumingReturn: 'Welcome back — picking the transfer up where it stopped.',
      pickFolder: 'Choose a folder when asked — a large file arrives much faster written straight to disk.',
      stale: 'Both devices need to reload — one of them is running an older version of K-Drop.',
      keepOpen: 'Keep K-Drop open — a transfer is running and will stop if this device sleeps.',
      resuming: 'Connection back — resuming from',
      blocked: 'Too many requests from this network. Try again shortly.',
    },

    scan: {
      start: 'Scan a QR code',
      cancel: 'Cancel',
      aim: 'Point the camera at the code on the other device',
      denied: 'Camera access was declined. You can type the code and PIN instead.',
      noCamera: 'No camera available. Type the code and PIN instead.',
      notKdrop: 'That code is not a K-Drop pairing code.',
    },

    trust: {
      title: 'Trusted devices',
      localOnly: 'Stored on this device only',
      offer: 'transfer worked. Remember this device and skip the prompt next time?',
      remember: 'Remember it',
      notNow: 'Not now',
      saved: 'Device remembered.',
      forget: 'Forget',
      forgotten: 'Device forgotten.',
      autoAccept: 'accept without asking',
      recognised: 'recognised, and it proved it',
      autoAccepted: 'trusted, accepting automatically',
      thisDevice: 'This device',
      tick: 'trusted',
    },

    summary: {
      files: 'Files', size: 'Size', time: 'Took', speed: 'Speed', route: 'Route',
    },

    install: {
      offer: 'That worked. Add K-Drop to your home screen so it opens like an app?',
      add: 'Add it',
      notNow: 'Not now',
      done: 'Installed. It will open from your home screen.',
    },

    verify: {
      label: 'Both devices should show this code',
      match: 'They match',
      why: 'What is this?',
      explain: 'This code is worked out from the encryption keys your two devices agreed. If the codes on the two screens are different, something is interfering with the connection — stop, and do not send anything private. Checking is optional; most transfers do not need it.',
      confirmed: 'Verified. This device will not ask again for this session.',
      verified: 'verified',
    },

    diag: {
      title: 'Connection details',
      noConnection: 'Connect a device to see the numbers.',
      route: 'Route',
      rtt: 'Round trip',
      path: 'Network path',
      encryption: 'Encryption',
      sessionKey: 'Session key agreed',
      browserOnly: 'Handled by the browser',
      frame: 'Frame size',
      toDisk: 'Writes to disk',
      yes: 'yes',
      no: 'held in memory',
      copy: 'Copy for a bug report',
      copied: 'Copied. Paste it wherever you are reporting the problem.',
      sameWifi: 'These devices are taking a long route to each other. Putting both on the same Wi-Fi is usually much faster.',
      turn: 'This connection is going through a relay. A TURN server would make more transfers direct.',
    },

    notify: {
      sentTitle: 'Sent',
      receivedTitle: 'Received',
    },

    ask: {
      title: 'Incoming files',
      accept: 'Accept',
      decline: 'Decline',
      onlyKnown: 'Only accept from a device you recognise in the list.',
      wants: 'wants to send',
      aFile: 'a file',
      files: 'files',
      inTotal: 'in total',
      renamed: 'name was cleaned up',
      runnable: 'runs when opened',
    },

    foot: { docs: 'Docs', privacy: 'Privacy', terms: 'Terms', project: 'a Kalman project' },
  },

  /* -------------------------------------------------------------- Hindi */
  hi: {
    _name: 'हिन्दी',
    nav: { how: 'यह कैसे काम करता है', docs: 'दस्तावेज़', connecting: 'जुड़ रहा है', online: 'ऑनलाइन', offline: 'फिर से जुड़ रहा है' },
    hero: {
      eyebrow: 'मुफ़्त फ़ाइल ट्रांसफ़र',
      title: 'डिवाइस के बीच फ़ाइलें भेजें।',
      lead: 'कोई खाता नहीं। कोई इंस्टॉलेशन नहीं। कोई जटिल सेटअप नहीं।',
      send: 'फ़ाइलें भेजें',
      receive: 'फ़ाइलें प्राप्त करें',
    },
    env: {
      noWebrtc: 'यह ब्राउज़र डिवाइस के बीच सीधा कनेक्शन नहीं बना सकता, इसलिए K-Drop यहाँ काम नहीं करेगा। Chrome, Edge, Firefox और Safari सभी इसका समर्थन करते हैं।',
      insecure: 'यह पेज सुरक्षित कनेक्शन पर नहीं है, इसलिए पिन एन्क्रिप्शन और फ़ोल्डर पिकर बंद हैं। ट्रांसफ़र फिर भी काम करता है और ब्राउज़र द्वारा एन्क्रिप्टेड रहता है। लोकल पते पर परीक्षण करते समय यह सामान्य है — https पर तैनात साइट पर सब कुछ चालू रहता है।',
      noCrypto: 'यह ब्राउज़र वह एन्क्रिप्शन नहीं देता जो K-Drop फ़ॉलबैक रास्ते के लिए उपयोग करता है। सीधे ट्रांसफ़र फिर भी काम करते हैं।',
      noStreaming: 'यह ब्राउज़र आने वाली फ़ाइल को सहेजने से पहले मेमोरी में रखता है, इसलिए बहुत बड़ी फ़ाइलें विफल हो सकती हैं। Chrome और Edge आते ही डिस्क पर लिखते हैं।',
    },

    role: {
      sending: 'आप भेज रहे हैं।', receiving: 'आप प्राप्त कर रहे हैं।', swap: 'बदलें',
      swapToReceive: 'इसके बजाय प्राप्त करें', swapToSend: 'इसके बजाय भेजें',
      sendPairTitle: 'जिस डिवाइस को भेज रहे हैं उसे जोड़ें',
      receivePairTitle: 'जो डिवाइस भेज रहा है उसे जोड़ें',
      readyTitle: 'प्राप्त करने के लिए तैयार',
      readyBody: 'यहाँ कुछ नहीं करना है। जब दूसरा डिवाइस कुछ भेजेगा, आपसे स्वीकार करने के लिए पूछा जाएगा।',
    },

    pair: {
      step: '01', title: 'अपना दूसरा डिवाइस जोड़ें', titlePhone: 'अपना कंप्यूटर जोड़ें',
      waiting: 'प्रतीक्षा में', connected: 'जुड़ गया', code: 'कोड', gettingCode: 'कोड मिल रहा है…',
      pin: 'पिन', qrHere: 'QR कोड यहाँ दिखेगा', copyLink: 'लिंक कॉपी करें', copied: 'कॉपी हो गया',
      orEnter: 'या दूसरे डिवाइस से कोड और पिन दर्ज करें', joinPlaceholder: 'कोड, फिर पिन',
      connect: 'जोड़ें', newCode: 'नया कोड', rename: 'इस डिवाइस को नाम दें',
      measurement: 'मापन', resolved: 'सुलझा हुआ', notConnected: 'जुड़ा नहीं', direct: 'सीधा', relayed: 'रिले के ज़रिए',
    },
    send: {
      step: '02', title: 'क्या भेजना है चुनें', firstStep: 'पहले चरण 1', ready: 'तैयार',
      files: 'फ़ाइलें', text: 'टेक्स्ट', drop: 'फ़ाइलें यहाँ छोड़ें',
      dropSubLocked: 'पहले दूसरा डिवाइस जोड़ें',
      dropSubDirect: 'सीधे दूसरे डिवाइस पर — किसी सर्वर से नहीं गुज़रता',
      dropSubRelay: 'रिले के ज़रिए एन्क्रिप्टेड — सर्वर इसे पढ़ नहीं सकता',
      choose: 'फ़ाइलें चुनें', chooseFolder: 'फ़ोल्डर चुनें',
      notePlaceholder: 'कोई लिंक, पता, या Wi-Fi पासवर्ड — जो भी आप दूसरे डिवाइस पर दोबारा टाइप नहीं करना चाहते।',
      sendText: 'टेक्स्ट भेजें', devices: 'डिवाइस', noDevices: 'अभी कोई दूसरा डिवाइस नहीं।',
      scanPrompt: 'ऊपर दिए कोड को अपने फ़ोन से स्कैन करें।',
      transfers: 'ट्रांसफ़र', nothingSent: 'अभी कुछ नहीं भेजा गया।',
      queued: 'क़तार में', preparing: 'फ़ाइलें देखी जा रही हैं…', waitingAccept: 'दूसरे डिवाइस की प्रतीक्षा', sending: 'भेजा जा रहा है',
      sent: 'भेज दिया', failed: 'विफल', cancelled: 'रद्द', declined: 'मना कर दिया',
      paused: 'रुका हुआ', resuming: 'फिर से शुरू', interrupted: 'कनेक्शन टूटा — फिर जुड़ने की प्रतीक्षा',
      pause: 'रोकें', resume: 'जारी रखें', cancel: 'रद्द करें', save: 'सहेजें',
      history: 'हाल के ट्रांसफ़र', noHistory: 'अभी कुछ नहीं। आपके ट्रांसफ़र सिर्फ़ इसी डिवाइस पर याद रखे जाते हैं।',
      clearHistory: 'इतिहास मिटाएँ', today: 'आज', yesterday: 'कल', earlier: 'पहले',
    },
    how: {
      eyebrow: 'यह कैसे काम करता है',
      title: 'फ़ाइल आपके डिवाइस के बीच जाती है, हमारे सर्वर से नहीं।',
      lead: 'ज़्यादातर टूल आपकी फ़ाइल किसी डेटा सेंटर पर अपलोड करके वापस डाउनलोड करते हैं। K-Drop इसके बजाय दोनों ब्राउज़र के बीच सीधा कनेक्शन बनाता है। एक ही Wi-Fi पर, डेटा इमारत से बाहर जाता ही नहीं।',
      s1t: 'K-Drop खोलें', s1b: 'दोनों डिवाइस पर वेबसाइट खोलें। कुछ इंस्टॉल नहीं करना, कोई साइन-अप नहीं।',
      s2t: 'जोड़ें', s2b: 'QR कोड स्कैन करें, या दूसरे डिवाइस पर दिख रहा कोड और पिन टाइप करें।',
      s3t: 'भेजें', s3b: 'अपनी फ़ाइलें चुनें। वे सीधे जाती हैं और पहुँचने पर जाँची जाती हैं।',
    },
    why: {
      title: 'K-Drop क्यों',
      fastT: 'तेज़', fastB: 'जहाँ नेटवर्क अनुमति दे, सीधे डिवाइस से डिवाइस ट्रांसफ़र।',
      privateT: 'निजी', privateB: 'कोई स्थायी भंडारण नहीं। आपकी फ़ाइलें हमारी डिस्क पर कभी नहीं लिखी जातीं।',
      simpleT: 'सरल', simpleB: 'कोई खाता नहीं, कोई सॉफ़्टवेयर नहीं, कोई सेटिंग नहीं।',
      everywhereT: 'हर जगह', everywhereB: 'कंप्यूटर, फ़ोन और टैबलेट, किसी भी आधुनिक ब्राउज़र में।',
    },
    devices: { title: 'इन पर काम करता है' },
    faq: {
      title: 'सवाल', lead: 'छोटे जवाब। पूरी जानकारी', docsLink: 'दस्तावेज़ों',
      q1: 'क्या K-Drop मुफ़्त है?', a1: 'हाँ। कोई खाता नहीं, कोई भुगतान नहीं, कोई विज्ञापन नहीं। यह मुफ़्त है और इसका कोड खुला है।',
      q2: 'क्या मुझे खाता चाहिए?', a2: 'नहीं। कुछ भी साइन-अप नहीं करना। दो डिवाइस पर पेज खोलें और कोड मिलाएँ।',
      q3: 'क्या मेरी फ़ाइलें संग्रहित होती हैं?', a3: 'नहीं। सीधे रास्ते पर आपकी फ़ाइल हमारे सर्वर तक पहुँचती ही नहीं। जब नेटवर्क वह रास्ता रोकता है, तो फ़ाइल आपके ही डिवाइस पर एन्क्रिप्ट होकर रिले से गुज़रती है और कभी डिस्क पर नहीं लिखी जाती।',
      q4: 'फ़ाइल का अधिकतम आकार क्या है?', a4: 'Chrome और Edge पर कोई व्यावहारिक सीमा नहीं — फ़ाइलें आते ही डिस्क पर लिखी जाती हैं। Safari और Firefox पर फ़ाइल पहले ब्राउज़र की मेमोरी में आनी होती है, इसलिए बहुत बड़ी फ़ाइलें वहाँ विफल हो सकती हैं।',
      q5: 'क्या यह iPhone और Windows के बीच काम करता है?', a5: 'हाँ। K-Drop ब्राउज़र में चलता है, इसलिए Windows, macOS, Linux, Android, iPhone और iPad का कोई भी संयोजन काम करता है।',
      q6: 'क्या ऐप इंस्टॉल करनी होगी?', a6: 'नहीं। आप K-Drop को होम स्क्रीन पर जोड़ सकते हैं ताकि यह ऐप जैसा खुले, पर यह वैकल्पिक है और कुछ इंस्टॉल नहीं करता।',
      q7: 'क्या दोनों डिवाइस पर एक ही Wi-Fi चाहिए?', a7: 'नहीं, पर एक ही Wi-Fi पर यह तेज़ होता है। अलग नेटवर्क पर भी काम करता है; कुछ प्रतिबंधित नेटवर्क पर यह धीमे रिले रास्ते पर चला जाता है, और पेज आपको बता देता है।',
      q8: 'अगर मैं टैब बंद कर दूँ तो?', a8: 'ट्रांसफ़र रुक जाता है। K-Drop भंडारण नहीं है — आपकी फ़ाइल बाद के लिए कहीं नहीं रखी जाती। दोनों डिवाइस खुले रहने चाहिए।',
    },
    toast: {
      joined: 'जुड़ गया', left: 'चला गया', accepted: 'स्वीकृत — भेजा जा रहा है।',
      declined: 'दूसरे डिवाइस ने मना कर दिया।', sent: 'भेज दिया गया।', received: 'प्राप्त हुआ।',
      failed: 'ट्रांसफ़र विफल रहा। दोबारा कोशिश करें।', corrupt: 'कुछ फ़ाइलें ख़राब पहुँचीं।',
      textSent: 'टेक्स्ट भेजा गया।', textReceived: 'टेक्स्ट मिला।',
      noDevice: 'अभी कोई डिवाइस जुड़ा नहीं है।', oneAtATime: 'एक बार में एक ट्रांसफ़र — इसे पूरा होने दें।',
      needPin: 'कोड और पिन दोनों दर्ज करें — दोनों दूसरे डिवाइस पर दिखते हैं।',
      needPinLong: 'छह अक्षरों का कोड और फिर चार अक्षरों का पिन दर्ज करें।',
      badCode: 'यह कोड समाप्त हो गया या ग़लत टाइप हुआ।', full: 'यह सत्र भरा हुआ है।',
      rateLimited: 'यहाँ से बहुत सारे सत्र शुरू हुए। थोड़ी देर बाद कोशिश करें।',
      tooMany: 'इस नेटवर्क से बहुत सारे टैब खुले हैं। कुछ बंद करके पेज दोबारा लोड करें।',
      expired: '30 मिनट बाद सत्र समाप्त हुआ। नया शुरू किया जा रहा है।',
      newCode: 'नया कोड।', copyManually: 'लिंक कॉपी करने के लिए Ctrl+C दबाएँ।', historyCleared: 'इतिहास मिटा दिया गया।',
    },
    scan: {
      start: 'QR कोड स्कैन करें', cancel: 'रद्द करें',
      aim: 'कैमरे को दूसरे डिवाइस के कोड पर रखें',
      denied: 'कैमरा अनुमति नहीं मिली। आप कोड और पिन टाइप कर सकते हैं।',
      noCamera: 'कोई कैमरा उपलब्ध नहीं। कोड और पिन टाइप करें।',
      notKdrop: 'यह K-Drop पेयरिंग कोड नहीं है।',
    },

    trust: {
      title: 'भरोसेमंद डिवाइस', localOnly: 'केवल इसी डिवाइस पर सहेजा गया',
      offer: 'ट्रांसफ़र सफल रहा। इस डिवाइस को याद रखें और अगली बार न पूछें?',
      remember: 'याद रखें', notNow: 'अभी नहीं', saved: 'डिवाइस याद रखा गया।',
      forget: 'भूल जाएँ', forgotten: 'डिवाइस भुला दिया गया।',
      autoAccept: 'बिना पूछे स्वीकार करें', recognised: 'पहचाना गया, और इसने प्रमाण दिया',
      autoAccepted: 'भरोसेमंद, स्वतः स्वीकार', thisDevice: 'यह डिवाइस', tick: 'भरोसेमंद',
    },

    summary: { files: 'फ़ाइलें', size: 'आकार', time: 'समय', speed: 'गति', route: 'रास्ता' },

    install: {
      offer: 'यह काम कर गया। K-Drop को होम स्क्रीन पर जोड़ें ताकि यह ऐप की तरह खुले?',
      add: 'जोड़ें', notNow: 'अभी नहीं', done: 'इंस्टॉल हो गया।',
    },

    verify: {
      label: 'दोनों डिवाइस पर यही कोड दिखना चाहिए', match: 'ये मेल खाते हैं', why: 'यह क्या है?',
      explain: 'यह कोड आपके दोनों डिवाइस की एन्क्रिप्शन कुंजियों से निकाला गया है। अगर दोनों स्क्रीन पर कोड अलग हैं, तो कनेक्शन में कोई हस्तक्षेप कर रहा है — रुकें और कुछ भी निजी न भेजें। जाँचना वैकल्पिक है।',
      confirmed: 'सत्यापित। इस सत्र में दोबारा नहीं पूछा जाएगा।', verified: 'सत्यापित',
    },

    diag: {
      title: 'कनेक्शन विवरण', noConnection: 'संख्याएँ देखने के लिए डिवाइस जोड़ें।',
      route: 'रास्ता', rtt: 'राउंड ट्रिप', path: 'नेटवर्क पथ', encryption: 'एन्क्रिप्शन',
      sessionKey: 'सत्र कुंजी तय हुई', browserOnly: 'ब्राउज़र द्वारा', frame: 'फ़्रेम आकार',
      toDisk: 'डिस्क पर लिखता है', yes: 'हाँ', no: 'मेमोरी में रखा',
      copy: 'बग रिपोर्ट के लिए कॉपी करें', copied: 'कॉपी हो गया।',
      sameWifi: 'ये डिवाइस लंबा रास्ता ले रहे हैं। दोनों को एक ही Wi-Fi पर रखना आम तौर पर तेज़ है।',
      turn: 'यह कनेक्शन रिले से जा रहा है। TURN सर्वर से ज़्यादा ट्रांसफ़र सीधे होंगे।',
    },

    notify: { sentTitle: 'भेज दिया', receivedTitle: 'प्राप्त हुआ' },

    ask: {
      title: 'आने वाली फ़ाइलें', accept: 'स्वीकार करें', decline: 'मना करें',
      onlyKnown: 'केवल उसी डिवाइस से स्वीकार करें जिसे आप सूची में पहचानते हों।',
      wants: 'भेजना चाहता है', aFile: 'एक फ़ाइल', files: 'फ़ाइलें', inTotal: 'कुल',
      renamed: 'नाम साफ़ किया गया', runnable: 'खोलने पर चलती है',
    },
    foot: { docs: 'दस्तावेज़', privacy: 'गोपनीयता', terms: 'शर्तें', project: 'एक Kalman परियोजना' },
  },
};

/* ------------------------------------------------------------------ api */

let current = 'en';

/** Look up a dotted key, falling back to English, then to the key itself. */
export function t(key) {
  const walk = (obj) => key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
  const v = walk(STRINGS[current]);
  if (v != null) return v;
  const fb = walk(STRINGS.en);
  return fb != null ? fb : key;
}

export function lang() { return current; }

export function available() {
  return Object.entries(STRINGS).map(([code, s]) => ({ code, name: s._name }));
}

function pick() {
  const q = new URLSearchParams(location.search).get('lang');
  if (q && STRINGS[q]) return q;

  const saved = localStorage.getItem('kdrop.lang');
  if (saved && STRINGS[saved]) return saved;

  for (const l of navigator.languages || [navigator.language || 'en']) {
    const base = String(l).toLowerCase().split('-')[0];
    if (STRINGS[base]) return base;
  }
  return 'en';
}

export function setLang(code, { save = true } = {}) {
  if (!STRINGS[code]) return;
  current = code;
  if (save) localStorage.setItem('kdrop.lang', code);

  document.documentElement.lang = code;
  document.documentElement.dir = RTL.has(code) ? 'rtl' : 'ltr';
  apply();
  document.dispatchEvent(new CustomEvent('langchange', { detail: code }));
}

/** Fill every element carrying a data-i18n attribute. */
export function apply(root = document) {
  for (const el of root.querySelectorAll('[data-i18n]')) {
    el.textContent = t(el.dataset.i18n);
  }
  for (const el of root.querySelectorAll('[data-i18n-ph]')) {
    el.setAttribute('placeholder', t(el.dataset.i18nPh));
  }
  for (const el of root.querySelectorAll('[data-i18n-aria]')) {
    el.setAttribute('aria-label', t(el.dataset.i18nAria));
  }
}

export function init() {
  setLang(pick(), { save: false });
  return current;
}
