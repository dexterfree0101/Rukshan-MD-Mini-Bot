const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers, fetchLatestBaileysVersion } = require("@whiskeysockets/baileys")
const qrcode = require("qrcode-terminal")
const pino = require("pino")
const fs = require("fs")
const express = require("express")
const app = express()
const port = process.env.PORT || 3000
const readline = require("readline")

// ============================================
//           EXPRESS SERVER SETUP
// ============================================
app.listen(port, () => console.log(`✅ Server Running on port ${port}`))
app.get('/', (req, res) => res.send('RUKSHAN BOT KING ONLINE ✅'))

// ============================================
//         GLOBAL VARIABLES
// ============================================
let sockGlobal = null
let isPairingInProgress = false
let latestQR = null
let isFirstStart = true
let selectedLoginMethod = "3"
let isSocketReady = false

// ============================================
//    WAIT FOR SOCKET READY HELPER
// ============================================
function waitForSocket(timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
        if (sockGlobal && isSocketReady) return resolve(sockGlobal)

        const start = Date.now()
        const interval = setInterval(() => {
            if (sockGlobal && isSocketReady) {
                clearInterval(interval)
                resolve(sockGlobal)
            } else if (Date.now() - start >= timeoutMs) {
                clearInterval(interval)
                reject(new Error("Socket not ready within timeout"))
            }
        }, 500)
    })
}

// ============================================
//         PAIR CODE API ENDPOINT
// ============================================
app.get('/pair', async (req, res) => {
    try {
        const { phone } = req.query

        // ── Validate Phone ──
        if (!phone) {
            return res.status(400).json({
                status: false,
                message: "❌ Phone number is required",
                example: "/pair?phone=94758298744"
            })
        }

        const cleanPhone = phone.replace(/[^0-9]/g, "")

        if (cleanPhone.length < 10 || cleanPhone.length > 15) {
            return res.status(400).json({
                status: false,
                message: "❌ Invalid phone number format",
                example: "/pair?phone=94758298744"
            })
        }

        // ── Wait for Socket (max 15s) ──
        console.log("⏳ Waiting for socket to be ready...")
        let sock
        try {
            sock = await waitForSocket(15000)
        } catch (e) {
            return res.status(503).json({
                status: false,
                message: "❌ Bot socket not ready, please try again in a moment"
            })
        }

        // ── Already Registered ──
        if (sock.authState.creds.registered) {
            return res.status(400).json({
                status: false,
                message: "❌ Device already paired, delete session to re-pair"
            })
        }

        // ── Prevent Duplicate Requests ──
        if (isPairingInProgress) {
            return res.status(429).json({
                status: false,
                message: "⏳ Pairing already in progress, please wait..."
            })
        }

        isPairingInProgress = true
        console.log(`📱 Pair Code Requested → ${cleanPhone}`)

        // ── Generate Pair Code ──
        const code = await sock.requestPairingCode(cleanPhone)
        const formattedCode = code?.match(/.{1,4}/g)?.join("-") || code

        isPairingInProgress = false
        console.log(`🔑 Pair Code: ${formattedCode}`)

        return res.status(200).json({
            status: true,
            message: "✅ Pair code generated successfully",
            phone: cleanPhone,
            code: formattedCode,
            note: "Enter this code in WhatsApp > Linked Devices > Link with phone number"
        })

    } catch (error) {
        isPairingInProgress = false
        console.error("❌ Pair API Error:", error.message)
        return res.status(500).json({
            status: false,
            message: "❌ Failed to generate pair code",
            error: error.message
        })
    }
})

// ============================================
//         QR CODE API ENDPOINT
// ============================================
app.get('/qr', (req, res) => {
    if (!latestQR) {
        return res.status(404).json({
            status: false,
            message: "❌ No QR code available yet"
        })
    }
    return res.status(200).json({
        status: true,
        qr: latestQR,
        message: "✅ QR Code ready to scan"
    })
})

// ============================================
//         STATUS API ENDPOINT
// ============================================
app.get('/status', (req, res) => {
    const isConnected = sockGlobal?.user ? true : false
    return res.status(200).json({
        status: true,
        connected: isConnected,
        socketReady: isSocketReady,
        user: sockGlobal?.user || null,
        message: isConnected
            ? `✅ Connected as ${sockGlobal.user?.name}`
            : isSocketReady
                ? "⏳ Socket ready, not yet authenticated"
                : "❌ Bot Not Connected"
    })
})

// ============================================
//    SAFE READLINE HELPER
// ============================================
function askQuestion(text) {
    return new Promise((resolve) => {
        const tempRl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        })
        tempRl.question(text, (answer) => {
            tempRl.close()
            resolve(answer)
        })
    })
}

// ============================================
//         MAIN BOT FUNCTION
// ============================================
async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState("session")
    const { version } = await fetchLatestBaileysVersion()

    // ── Ask login method only ONCE on first start ──
    if (isFirstStart && !state.creds.registered) {
        console.log("╭───〘 👑 LOGIN METHOD 〙──────╮")
        console.log("│ 1. QR Code Scan              │")
        console.log("│ 2. Pair Code (Terminal)      │")
        console.log("│ 3. API Mode /pair?phone=...  │")
        console.log("╰──────────────────────────────╯")
        selectedLoginMethod = await askQuestion("➛ Select 1, 2 or 3: ")
        isFirstStart = false
    } else {
        isFirstStart = false
    }

    // ── Create Socket ──
    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: selectedLoginMethod === "1",
        logger: pino({ level: "silent" }),
        browser: Browsers.macOS("Desktop")
    })

    // ── Mark socket ready immediately after creation ──
    sockGlobal = sock
    isSocketReady = true
    console.log("🟢 Socket initialized and ready")

    // ── Terminal Pair Code Mode ──
    if (!sock.authState.creds.registered && selectedLoginMethod === "2" && !isPairingInProgress) {
        isPairingInProgress = true
        try {
            console.log("╭───〘 👑 PAIR CODE SYSTEM 〙───╮")
            const phoneNumber = await askQuestion("│ 📱 Enter WhatsApp Number:\n│ Ex: 94758298744\n╰──────────────────────────────╯\n➛ ")
            const code = await sock.requestPairingCode(phoneNumber.replace(/[^0-9]/g, ""))
            const formattedCode = code?.match(/.{1,4}/g)?.join("-") || code
            console.log(`╭───〘 ✅ YOUR PAIR CODE 〙───╮`)
            console.log(`│       ${formattedCode}       │`)
            console.log(`╰──────────────────────────────╯`)
        } catch (e) {
            console.error("❌ Pair code error:", e.message)
        }
        isPairingInProgress = false
    }

    // ── API Mode Info ──
    if (!sock.authState.creds.registered && selectedLoginMethod === "3") {
        console.log("╭───〘 🌐 API MODE ACTIVE 〙────────╮")
        console.log(`│  GET /pair?phone=94758298744     │`)
        console.log(`│  GET /qr                         │`)
        console.log(`│  GET /status                     │`)
        console.log(`╰──────────────────────────────────╯`)
    }

    // ============================================
    //       CONNECTION UPDATE HANDLER
    // ============================================
    sock.ev.on("connection.update", (update) => {
        const { connection, lastDisconnect, qr } = update

        // ── QR Ready ──
        if (qr) {
            latestQR = qr
            if (selectedLoginMethod === "1") {
                console.log("╭───〘 📱 SCAN QR CODE 〙───╮")
                qrcode.generate(qr, { small: true })
                console.log("╰──────────────────────────╯")
            } else {
                console.log("📱 QR Ready → GET /qr")
            }
        }

        // ── Connected ──
        if (connection === "open") {
            latestQR = null
            sockGlobal = sock
            isSocketReady = true
            console.log("╭───〘 ✅ BOT CONNECTED 〙───╮")
            console.log(`│ 👤 ${sock.user?.name || "Unknown"}`)
            console.log(`│ 📱 ${sock.user?.id}`)
            console.log("╰──────────────────────────╯")
        }

        // ── Disconnected ──
        if (connection === "close") {
            isSocketReady = false
            latestQR = null
            isPairingInProgress = false
            const reason = lastDisconnect?.error?.output?.statusCode
            console.log(`❌ Disconnected | Code: ${reason}`)

            if (reason === DisconnectReason.loggedOut) {
                sockGlobal = null
                console.log("🚫 Logged Out! Delete session folder and restart.")
            } else {
                console.log("🔄 Reconnecting in 3s...")
                setTimeout(() => startBot(), 3000)
            }
        }
    })

    sock.ev.on("creds.update", saveCreds)

    // ============================================
    //       MESSAGE HANDLER
    // ============================================
    sock.ev.on("messages.upsert", async ({ messages }) => {
        const m = messages[0]
        if (!m.message || m.key.fromMe) return
        const from = m.key.remoteJid
        const body = m.message.conversation || m.message.extendedTextMessage?.text || ""

        if (body === ".ping") {
            await sock.sendMessage(from, { text: "*🏓 Pong! Bot Alive ✅*" }, { quoted: m })
        }

        if (body === ".status") {
            await sock.sendMessage(from, {
                text: `*📊 BOT STATUS*\n\n✅ Connected\n👤 ${sock.user?.name}\n📱 ${sock.user?.id}`
            }, { quoted: m })
        }
    })
}

startBot()
