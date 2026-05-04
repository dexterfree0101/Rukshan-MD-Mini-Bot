const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers, fetchLatestBaileysVersion } = require("@whiskeysockets/baileys")
const qrcode = require("qrcode-terminal")
const pino = require("pino")
const fs = require("fs")
const express = require("express")
const app = express()
const port = process.env.PORT || 3000
const readline = require("readline")

app.get('/', (req, res) => res.send('RUKSHAN BOT KING ONLINE ✅'))
app.listen(port, () => console.log(`Server Running on ${port}`))

const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
const question = (text) => new Promise((resolve) => rl.question(text, resolve))

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState("session")
    const { version } = await fetchLatestBaileysVersion()

    let loginMethod = "2"
    if (!state.creds.registered) {
        console.log("╭───〘 👑 LOGIN METHOD 〙───╮")
        console.log("│ 1. QR Code Scan")
        console.log("│ 2. Pair Code")
        console.log("╰──────────────────────────────╯")
        loginMethod = await question("➛ Select 1 or 2: ")
    }

    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: loginMethod === "1",
        logger: pino({ level: "silent" }),
        browser: Browsers.macOS("Desktop")
    })

    if (!sock.authState.creds.registered && loginMethod === "2") {
        console.log("╭───〘 👑 PAIR CODE SYSTEM 〙───╮")
        const phoneNumber = await question("│ 📱 Enter Your WhatsApp Number:\\n│ Ex: 94758298744\\n╰──────────────────────────────╯\\n➛ ")
        const code = await sock.requestPairingCode(phoneNumber.replace(/[^0-9]/g, ""))
        console.log(`╭───〘 ✅ YOUR PAIR CODE 〙───╮`)
        console.log(`│ ${code} │`)
        console.log(`╰──────────────────────────────╯`)
        rl.close()
    }

    sock.ev.on("connection.update", (update) => {
        const { connection, lastDisconnect, qr } = update
        if(qr && loginMethod === "1") {
            console.log("╭───〘 📱 QR CODE SCAN 〙───╮")
            qrcode.generate(qr, {small: true})
            console.log("╰──────────────────────────────╯")
        }
        if(connection === "open") {
            console.log("✅ RUKSHAN BOT KING CONNECTED ✅")
            rl.close()
        }
        if(connection === "close") startBot()
    })
    sock.ev.on("creds.update", saveCreds)

    sock.ev.on("messages.upsert", async ({ messages }) => {
        const m = messages[0]
        if (!m.message || m.key.fromMe) return
        const from = m.key.remoteJid
        const body = m.message.conversation || m.message.extendedTextMessage?.text || ""

        if (body === ".ping") {
            await sock.sendMessage(from, { text: "*🏓 Pong! Bot Alive ✅*" }, { quoted: m })
        }
    })
}
startBot()
