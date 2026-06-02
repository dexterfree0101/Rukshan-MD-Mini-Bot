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
let connectionState = "close" // close | connecting | open

// ============================================
//    WAIT FOR SOCKET WS CONNECTION
// ============================================
function waitForConnection(timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
        // ── Already connected or connecting ──
        if (sockGlobal && connectionState !== "close") {
            return resolve(sockGlobal)
        }

        const start = Date.now()
        const interval = setInterval(() => {
            if (sockGlobal && connectionState !== "close") {
                clearInterval(interval)
                resolve(sockGlobal)
            } else if (Date.now() - start >= timeoutMs) {
                clearInterval(interval)
                reject(new Error("Timeout waiting for socket connection"))
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

        // ── Wait for WS Connection (max 30s) ──
        console.log(`📡 /pair called → waiting for WS connection...`)
        let sock
        try {
            sock = await waitForConnection(30000)
        } catch (e) {
            return res.status(503).json({
                status: false,
                message: "❌ Bot not connected to WhatsApp servers yet, please try again in a few seconds",
                hint: "Check /status to see connection state"
            })
        }

        // ── Already Registered ──
        if (sock.authState.creds.registered) {
            return res.status(400).json({
                status: false,
                message: "❌ Device already paired. Delete session folder to re-pair."
            })
        }

        // ── Already Connected (open) ──
        if (connectionState === "open") {
            return res.status(400).json({
                status: false,
                message: "❌ Bot is already connected and authenticated"
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
        console.log(`📱 Requesting pair code for: ${cleanPhone}`)

        // ── Request Pair Code ──
        const code = await sock.requestPairingCode(cleanPhone)
        const formattedCode = code?.match(/.{1,4}/g)?.join("-") || code

        isPairingInProgress = false
        console.log(`🔑 Pair Code Generated: ${formattedCode}`)

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
            message: "❌ No QR code available yet, please wait..."
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
        socketReady: sockGlobal !== null,
        authenticated: sockGlobal?.authState?.creds?.registered || false,
        user: sockGlobal?.user || null,
        message:
            connectionState === "open"
                ? `✅ Connected as ${sockGlobal?.user?.name}`
                : connectionState === "connecting"
                    ? "⏳ Connecting to WhatsApp servers..."
                    : "❌ Disconnected"
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

    // ── Ask login method only ONCE ──
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
        browser: Browsers.macOS("Desktop"),
        // ── Important: Keep alive ──
        keepAliveIntervalMs: 10000,
        connectTimeoutMs: 60000,
        retryRequestDelayMs: 250
    })

    sockGlobal = sock
    connectionState = "connecting"
    console.log("🟡 Socket created → connecting to WhatsApp servers...")

    // ============================================
    //       CONNECTION UPDATE HANDLER
    // ============================================
    sock.ev.on("connection.update", async (update) => {
        const { connection, lastDisconnect, qr } = update

        // ── QR Ready ──
        if (qr) {
            latestQR = qr
            connectionState = "connecting"
            if (selectedLoginMethod === "1") {
                console.log("╭───〘 📱 SCAN QR CODE 〙───╮")
                qrcode.generate(qr, { small: true })
                console.log("╰──────────────────────────╯")
            } else {
                console.log("📱 QR Ready → GET /qr")
            }
        }

        // ── Connecting ──
        if (connection === "connecting") {
            connectionState = "connecting"
            console.log("🔄 Connecting to WhatsApp...")
        }

        // ── Connected ──
        if (connection === "open") {
            connectionState = "open"
            latestQR = null
            sockGlobal = sock
            console.log("╭───〘 ✅ BOT CONNECTED 〙───╮")
            console.log(`│ 👤 ${sock.user?.name || "Unknown"}`)
            console.log(`│ 📱 ${sock.user?.id}`)
            console.log("╰──────────────────────────╯")

            // ── Terminal Pair Code After WS Ready ──
            if (selectedLoginMethod === "2" && !isPairingInProgress && !sock.authState.creds.registered) {
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

            // ── API Mode Info After Connected ──
            if (selectedLoginMethod === "3" && !sock.authState.creds.registered) {
                console.log("╭───〘 🌐 API READY 〙──────────────╮")
                console.log(`│  GET /pair?phone=94758298744     │`)
                console.log(`│  GET /qr                         │`)
                console.log(`│  GET /status                     │`)
                console.log("╰──────────────────────────────────╯")
            }
        }

        // ── Disconnected ──
        if (connection === "close") {
            connectionState = "close"
            latestQR = null
            isPairingInProgress = false
            const reason = lastDisconnect?.error?.output?.statusCode
            console.log(`❌ Disconnected | Code: ${reason}`)

            if (reason === DisconnectReason.loggedOut) {
                sockGlobal = null
                console.log("🚫 Logged Out! Delete session folder and restart.")
            } else {
                console.log("🔄 Reconnecting in 5s...")
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
