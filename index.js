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
//         GLOBAL SOCKET REFERENCE
// ============================================
let sockGlobal = null
let isPairingInProgress = false

// ============================================
//         PAIR CODE API ENDPOINT
// ============================================
app.get('/pair', async (req, res) => {
    try {
        const { phone } = req.query

        // ── Validate Phone Number ──
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

        // ── Check Socket Connection ──
        if (!sockGlobal) {
            return res.status(503).json({
                status: false,
                message: "❌ Bot socket not ready yet, please wait..."
            })
        }

        // ── Check Already Registered ──
        if (sockGlobal.authState.creds.registered) {
            return res.status(400).json({
                status: false,
                message: "❌ Device already paired/connected"
            })
        }

        // ── Prevent Multiple Pair Requests ──
        if (isPairingInProgress) {
            return res.status(429).json({
                status: false,
                message: "⏳ Pairing already in progress, please wait..."
            })
        }

        isPairingInProgress = true

        // ── Request Pair Code ──
        const code = await sockGlobal.requestPairingCode(cleanPhone)

        // ── Format Code with Dash (XXXX-XXXX) ──
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
let latestQR = null

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
            qr: latestQR,
            note: "Use a QR code renderer to display this string"
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
//         BOT STATUS API ENDPOINT
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
//         READLINE SETUP
// ============================================
const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
const question = (text) => new Promise((resolve) => rl.question(text, resolve))

// ============================================
//         MAIN BOT FUNCTION
// ============================================
async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState("session")
    const { version } = await fetchLatestBaileysVersion()

    let loginMethod = "2"
    if (!state.creds.registered) {
        console.log("╭───〘 👑 LOGIN METHOD 〙───╮")
        console.log("│ 1. QR Code Scan          │")
        console.log("│ 2. Pair Code             │")
        console.log("│ 3. API Mode (No Input)   │")
        console.log("╰──────────────────────────╯")
        loginMethod = await question("➛ Select 1, 2 or 3: ")
    }

    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: loginMethod === "1",
        logger: pino({ level: "silent" }),
        browser: Browsers.macOS("Desktop")
    })

    // ── Assign to Global Reference ──
    sockGlobal = sock

    // ── Terminal Pair Code Login ──
    if (!sock.authState.creds.registered && loginMethod === "2") {
        console.log("╭───〘 👑 PAIR CODE SYSTEM 〙───╮")
        const phoneNumber = await question("│ 📱 Enter Your WhatsApp Number:\n│ Ex: 94758298744\n╰──────────────────────────────╯\n➛ ")
        const code = await sock.requestPairingCode(phoneNumber.replace(/[^0-9]/g, ""))
        const formattedCode = code?.match(/.{1,4}/g)?.join("-") || code
        console.log(`╭───〘 ✅ YOUR PAIR CODE 〙───╮`)
        console.log(`│       ${formattedCode}       │`)
        console.log(`╰──────────────────────────────╯`)
        rl.close()
    }

    // ── API Mode Info ──
    if (!sock.authState.creds.registered && loginMethod === "3") {
        console.log("╭───〘 🌐 API MODE ACTIVE 〙───╮")
        console.log(`│ GET /pair?phone=94758298744  │`)
        console.log(`│ GET /qr                      │`)
        console.log(`│ GET /status                  │`)
        console.log(`│ Server: http://localhost:${port} │`)
        console.log("╰──────────────────────────────╯")
        rl.close()
    }

    // ============================================
    //       CONNECTION UPDATE HANDLER
    // ============================================
    sock.ev.on("connection.update", (update) => {
        const { connection, lastDisconnect, qr } = update

        // ── QR Code Handler ──
        if (qr) {
            latestQR = qr
            if (loginMethod === "1") {
                console.log("╭───〘 📱 QR CODE SCAN 〙───╮")
                qrcode.generate(qr, { small: true })
                console.log("╰──────────────────────────────╯")
            }
        }

        // ── Connected ──
        if (connection === "open") {
            latestQR = null
            sockGlobal = sock
            console.log("╭───〘 ✅ BOT CONNECTED 〙───╮")
            console.log(`│ User: ${sock.user?.name || "Unknown"}`)
            console.log(`│ JID:  ${sock.user?.id}`)
            console.log("╰──────────────────────────────╯")
            rl.close()
        }

        // ── Disconnected ──
        if (connection === "close") {
            sockGlobal = null
            latestQR = null
            isPairingInProgress = false
            const reason = lastDisconnect?.error?.output?.statusCode
            console.log(`❌ Disconnected | Reason: ${reason}`)
            if (reason !== DisconnectReason.loggedOut) {
                console.log("🔄 Reconnecting...")
                startBot()
            } else {
                console.log("🚫 Logged Out! Delete session folder and restart.")
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

        // ── Ping Command ──
        if (body === ".ping") {
            await sock.sendMessage(from, { text: "*🏓 Pong! Bot Alive ✅*" }, { quoted: m })
        }

        // ── Status Command ──
        if (body === ".status") {
            await sock.sendMessage(from, {
                text: `*📊 BOT STATUS*\n\n✅ Connected\n👤 Name: ${sock.user?.name}\n📱 JID: ${sock.user?.id}`
            }, { quoted: m })
        }
    })
}

startBot()
