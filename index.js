const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers, fetchLatestBaileysVersion } = require("@whiskeysockets/baileys")
const qrcode = require("qrcode-terminal")
const pino = require("pino")
const fs = require("fs")
const express = require("express")
const app = express()
const port = process.env.PORT || 3000

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
let connectionState = "close"
let socketReady = false

// ============================================
//    WAIT UNTIL SOCKET IS TRULY READY
//    (waits for WS handshake + first QR/event)
// ============================================
function waitForSocketReady(timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
        if (sockGlobal && socketReady) return resolve(sockGlobal)

        const start = Date.now()
        const interval = setInterval(() => {
            if (sockGlobal && socketReady) {
                clearInterval(interval)
                resolve(sockGlobal)
            } else if (Date.now() - start >= timeoutMs) {
                clearInterval(interval)
                reject(new Error("Timeout"))
            }
        }, 300)
    })
}

// ============================================
//         PAIR CODE API ENDPOINT
// ============================================
app.get('/pair', async (req, res) => {
    try {
        const { phone } = req.query

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
                message: "❌ Invalid phone number",
                example: "/pair?phone=94758298744"
            })
        }

        // ── Wait for socket ready ──
        console.log(`📡 /pair → Phone: ${cleanPhone} | Waiting for socket...`)
        let sock
        try {
            sock = await waitForSocketReady(30000)
        } catch (e) {
            return res.status(503).json({
                status: false,
                message: "❌ Socket not ready yet, try again in 5-10 seconds",
                connectionState: connectionState,
                socketExists: sockGlobal !== null,
                socketReady: socketReady
            })
        }

        // ── Already paired ──
        if (sock.authState.creds.registered) {
            return res.status(400).json({
                status: false,
                message: "❌ Already paired! Delete session folder to re-pair"
            })
        }

        // ── Prevent double request ──
        if (isPairingInProgress) {
            return res.status(429).json({
                status: false,
                message: "⏳ Pair code already being generated, wait..."
            })
        }

        isPairingInProgress = true
        console.log(`📱 Generating pair code for: ${cleanPhone}`)

        // ── Wait a bit for WS to be fully stable ──
        await new Promise(r => setTimeout(r, 2000))

        const code = await sock.requestPairingCode(cleanPhone)
        const formattedCode = code?.match(/.{1,4}/g)?.join("-") || code

        isPairingInProgress = false
        console.log(`✅ Pair Code: ${formattedCode}`)

        return res.status(200).json({
            status: true,
            message: "✅ Pair code generated!",
            phone: cleanPhone,
            code: formattedCode,
            note: "Open WhatsApp → Linked Devices → Link with phone number → Enter code"
        })

    } catch (error) {
        isPairingInProgress = false
        console.error("❌ Pair Error:", error.message)
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
            message: "❌ No QR available yet"
        })
    }
    return res.status(200).json({
        status: true,
        qr: latestQR,
        message: "✅ QR Code ready"
    })
})

// ============================================
//         STATUS API ENDPOINT
// ============================================
app.get('/status', (req, res) => {
    return res.status(200).json({
        status: true,
        connectionState: connectionState,
        socketExists: sockGlobal !== null,
        socketReady: socketReady,
        authenticated: sockGlobal?.authState?.creds?.registered || false,
        user: sockGlobal?.user || null,
        message:
            connectionState === "open"
                ? `✅ Connected as ${sockGlobal?.user?.name}`
                : connectionState === "connecting"
                    ? "⏳ Connecting..."
                    : "❌ Disconnected"
    })
})

// ============================================
//   DELETE SESSION & RESTART
// ============================================
app.get('/reset', (req, res) => {
    try {
        if (fs.existsSync("./session")) {
            fs.rmSync("./session", { recursive: true, force: true })
        }
        sockGlobal = null
        socketReady = false
        connectionState = "close"
        isPairingInProgress = false
        latestQR = null

        console.log("🗑️ Session deleted, restarting...")
        setTimeout(() => startBot(), 2000)

        return res.json({
            status: true,
            message: "✅ Session deleted & bot restarting"
        })
    } catch (e) {
        return res.status(500).json({
            status: false,
            message: "❌ Reset failed",
            error: e.message
        })
    }
})

// ============================================
//         MAIN BOT FUNCTION
//    (NO readline — auto API mode)
// ============================================
async function startBot() {
    try {
        const { state, saveCreds } = await useMultiFileAuthState("session")
        const { version } = await fetchLatestBaileysVersion()

        console.log("╭───〘 🚀 STARTING BOT 〙───╮")
        console.log(`│ Version: ${version.join(".")}`)
        console.log(`│ Mode: API (Automatic)`)
        console.log(`│ Port: ${port}`)
        console.log("╰──────────────────────────╯")

        // ── Already registered → login directly ──
        if (state.creds.registered) {
            console.log("🔑 Session found → Logging in...")
        } else {
            console.log("🆕 No session → Use /pair?phone=XXXX to pair")
        }

        const sock = makeWASocket({
            version,
            auth: state,
            printQRInTerminal: false,
            logger: pino({ level: "silent" }),
            browser: Browsers.macOS("Desktop"),
            keepAliveIntervalMs: 10000,
            connectTimeoutMs: 60000,
            retryRequestDelayMs: 250,
            defaultQueryTimeoutMs: undefined
        })

        sockGlobal = sock
        connectionState = "connecting"
        console.log("🟡 Socket created → connecting...")

        // ============================================
        //       CONNECTION UPDATE HANDLER
        // ============================================
        sock.ev.on("connection.update", (update) => {
            const { connection, lastDisconnect, qr } = update

            // ── QR Generated (means WS is connected!) ──
            if (qr) {
                latestQR = qr
                connectionState = "connecting"

                // ★ THIS IS THE KEY — QR means socket is ready ★
                socketReady = true
                console.log("📱 QR Generated → Socket is READY for pairing")
                console.log("🌐 Use: GET /pair?phone=94XXXXXXXXX")
            }

            // ── Connecting ──
            if (connection === "connecting") {
                connectionState = "connecting"
                console.log("🔄 Connecting to WhatsApp servers...")
            }

            // ── Connected Successfully ──
            if (connection === "open") {
                connectionState = "open"
                socketReady = true
                latestQR = null
                sockGlobal = sock
                console.log("╭───〘 ✅ BOT CONNECTED 〙───╮")
                console.log(`│ 👤 ${sock.user?.name || "Unknown"}`)
                console.log(`│ 📱 ${sock.user?.id}`)
                console.log("╰──────────────────────────╯")
            }

            // ── Disconnected ──
            if (connection === "close") {
                connectionState = "close"
                socketReady = false
                latestQR = null
                isPairingInProgress = false

                const statusCode = lastDisconnect?.error?.output?.statusCode
                const reason = DisconnectReason

                console.log(`❌ Disconnected | Code: ${statusCode}`)

                if (statusCode === reason.loggedOut) {
                    sockGlobal = null
                    console.log("🚫 Logged Out! Use /reset then /pair")
                } else if (statusCode === reason.restartRequired) {
                    console.log("🔄 Restart required → Restarting...")
                    startBot()
                } else if (statusCode === reason.connectionClosed ||
                           statusCode === reason.connectionLost ||
                           statusCode === reason.timedOut) {
                    console.log("🔄 Reconnecting in 5s...")
                    setTimeout(() => startBot(), 5000)
                } else {
                    console.log("🔄 Unknown disconnect → Reconnecting in 5s...")
                    setTimeout(() => startBot(), 5000)
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
            const body = m.message.conversation ||
                         m.message.extendedTextMessage?.text || ""

            if (body === ".ping") {
                await sock.sendMessage(from, {
                    text: "*🏓 Pong! Bot Alive ✅*"
                }, { quoted: m })
            }

            if (body === ".status") {
                await sock.sendMessage(from, {
                    text: `*📊 BOT STATUS*\n\n✅ Connected\n👤 ${sock.user?.name}\n📱 ${sock.user?.id}\n⏰ ${new Date().toLocaleString()}`
                }, { quoted: m })
            }

            if (body === ".help") {
                await sock.sendMessage(from, {
                    text: `*🤖 RUKSHAN BOT COMMANDS*\n\n📌 .ping - Check bot alive\n📌 .status - Bot info\n📌 .help - Show this menu`
                }, { quoted: m })
            }
        })

    } catch (error) {
        console.error("❌ Bot Start Error:", error.message)
        console.log("🔄 Retrying in 10s...")
        setTimeout(() => startBot(), 10000)
    }
}

startBot()
