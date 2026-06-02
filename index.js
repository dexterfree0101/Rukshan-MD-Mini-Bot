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
app.get('/', (req, res) => res.send('RUKSHAN BOT KING ONLINE ✅'))
app.listen(port, () => console.log(`Server Running on ${port}`))

// ============================================
//         GLOBAL VARIABLES
// ============================================
let sockGlobal = null
let isPairingInProgress = false
let latestQR = null
let isFirstStart = true  // ← Track first boot only
let selectedLoginMethod = "3"  // ← Default API mode

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
                message: "❌ Invalid phone number format",
                example: "/pair?phone=94758298744"
            })
        }

        if (!sockGlobal) {
            return res.status(503).json({
                status: false,
                message: "❌ Bot socket not ready yet, please wait..."
            })
        }

        if (sockGlobal.authState.creds.registered) {
            return res.status(400).json({
                status: false,
                message: "❌ Device already paired/connected"
            })
        }

        if (isPairingInProgress) {
            return res.status(429).json({
                status: false,
                message: "⏳ Pairing already in progress, please wait..."
            })
        }

        isPairingInProgress = true

        const code = await sockGlobal.requestPairingCode(cleanPhone)
        const formattedCode = code?.match(/.{1,4}/g)?.join("-") || code

        isPairingInProgress = false

        console.log(`📱 Pair Code Requested for: ${cleanPhone}`)
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
        console.error("Pair API Error:", error)
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
    try {
        if (!latestQR) {
            return res.status(404).json({
                status: false,
                message: "❌ No QR code available yet, please wait..."
            })
        }
        return res.status(200).json({
            status: true,
            message: "✅ Scan this QR code",
            qr: latestQR
        })
    } catch (error) {
        return res.status(500).json({
            status: false,
            message: "❌ Failed to get QR code",
            error: error.message
        })
    }
})

// ============================================
//         STATUS API ENDPOINT
// ============================================
app.get('/status', (req, res) => {
    try {
        const isConnected = sockGlobal?.user ? true : false
        return res.status(200).json({
            status: true,
            connected: isConnected,
            user: sockGlobal?.user || null,
            message: isConnected
                ? `✅ Bot Connected as ${sockGlobal.user?.name}`
                : "❌ Bot Not Connected"
        })
    } catch (error) {
        return res.status(500).json({
            status: false,
            message: "❌ Failed to get status",
            error: error.message
        })
    }
})

// ============================================
//    SAFE READLINE — CREATE FRESH EACH TIME
// ============================================
function askQuestion(text) {
    return new Promise((resolve) => {
        // ── Create a fresh readline only when needed ──
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

    // ── Only ask login method on FIRST start ──
    if (isFirstStart && !state.creds.registered) {
        console.log("╭───〘 👑 LOGIN METHOD 〙──────╮")
        console.log("│ 1. QR Code Scan              │")
        console.log("│ 2. Pair Code (Terminal)      │")
        console.log("│ 3. API Mode /pair?phone=...  │")
        console.log("╰──────────────────────────────╯")
        selectedLoginMethod = await askQuestion("➛ Select 1, 2 or 3: ")
        isFirstStart = false
    } else if (state.creds.registered) {
        // ── Already registered, skip input ──
        isFirstStart = false
    }

    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: selectedLoginMethod === "1",
        logger: pino({ level: "silent" }),
        browser: Browsers.macOS("Desktop")
    })

    sockGlobal = sock

    // ── Terminal Pair Code (only on first start) ──
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
            console.error("Pair code error:", e.message)
        }
        isPairingInProgress = false
    }

    // ── API Mode Info ──
    if (!sock.authState.creds.registered && selectedLoginMethod === "3") {
        console.log("╭───〘 🌐 API MODE ACTIVE 〙────────╮")
        console.log(`│  GET /pair?phone=94758298744     │`)
        console.log(`│  GET /qr                         │`)
        console.log(`│  GET /status                     │`)
        console.log(`│  http://localhost:${port}           │`)
        console.log("╰──────────────────────────────────╯")
    }

    // ============================================
    //       CONNECTION UPDATE HANDLER
    // ============================================
    sock.ev.on("connection.update", (update) => {
        const { connection, lastDisconnect, qr } = update

        if (qr) {
            latestQR = qr
            if (selectedLoginMethod === "1") {
                console.log("╭───〘 📱 SCAN QR CODE 〙───╮")
                qrcode.generate(qr, { small: true })
                console.log("╰──────────────────────────────╯")
            } else {
                console.log("📱 QR Ready → GET /qr")
            }
        }

        if (connection === "open") {
            latestQR = null
            sockGlobal = sock
            console.log("╭───〘 ✅ BOT CONNECTED 〙───╮")
            console.log(`│ 👤 ${sock.user?.name || "Unknown"}`)
            console.log(`│ 📱 ${sock.user?.id}`)
            console.log("╰──────────────────────────────╯")
        }

        if (connection === "close") {
            sockGlobal = null
            latestQR = null
            isPairingInProgress = false
            const reason = lastDisconnect?.error?.output?.statusCode
            console.log(`❌ Disconnected | Code: ${reason}`)

            if (reason === DisconnectReason.loggedOut) {
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
