// IMPORTS 
import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import cors from "cors";
import dotenv from "dotenv";
import sharp from "sharp";
import { spawn } from "child_process";
import ffmpeg from "fluent-ffmpeg";
import { createClient } from "redis";
import pkg from "pg";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { v4 as uuidv4 } from "uuid";
import nodemailer from "nodemailer";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import bcrypt from "bcrypt";
import { RekognitionClient, CompareFacesCommand } from "@aws-sdk/client-rekognition";
import { createWorker } from "tesseract.js";

const { Pool } = pkg;
dotenv.config();

//  CONFIG EXPRESS
const app = express();
const PORT = Number(process.env.PORT || 3000);

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(process.cwd(), "Views")));

app.use(cors({
    origin: "*",
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type"]
}));

// SECURITY MIDDLEWARES 
app.use(helmet({
    contentSecurityPolicy: {
        useDefaults: true,
        directives: {
            "script-src": ["'self'", "https://cdn.tailwindcss.com", "https://unpkg.com"],
            "style-src": ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
            "img-src": ["'self'", "data:", "blob:"]
        }
    }
}));
app.set('trust proxy', 1);
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 200 }));

// STATIC FOLDERS 
app.use("/Js", express.static(path.join(process.cwd(), "public/Js")));
app.use("/js", express.static(path.join(process.cwd(), "Views/Js")));
app.use("/img", express.static(path.join(process.cwd(), "public/img")));
app.use("/img", express.static(path.join(process.cwd(), "Views/img")));
app.use("/css", express.static(path.join(process.cwd(), "public/css")));
app.use("/css", express.static(path.join(process.cwd(), "Views/css")));
app.use("/models", express.static(path.join(process.cwd(), "models")));
app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));

//  ENCRYPTION AES-256 
const ALGORITHM = "aes-256-cbc";
const KEY = process.env.ENCRYPTION_KEY ? Buffer.from(process.env.ENCRYPTION_KEY, "hex") : null;

if (!KEY || KEY.length !== 32) {
    console.warn("⚠️ ENCRYPTION_KEY no está configurada correctamente. Algunas funciones de encriptación fallarán.");
}

function encryptBuffer(buffer) {
    if (!KEY) throw new Error("ENCRYPTION_KEY no configurada");
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);
    const encrypted = Buffer.concat([cipher.update(buffer), cipher.final()]);
    return { data: encrypted.toString("base64"), iv: iv.toString("hex") };
}

function decryptBuffer(base64Data, ivHex) {
    if (!KEY) throw new Error("ENCRYPTION_KEY no configurada");
    const iv = Buffer.from(ivHex, "hex");
    const encryptedBuffer = Buffer.from(base64Data, "base64");
    const decipher = crypto.createDecipheriv(ALGORITHM, KEY, iv);
    return Buffer.concat([decipher.update(encryptedBuffer), decipher.final()]);
}

// DATABASE POSTGRESQL 
const pool = new Pool({
    user: process.env.NEON_USER,
    host: process.env.NEON_HOST,
    database: process.env.NEON_DATABASE,
    password: process.env.NEON_PASSWORD,
    port: Number(process.env.NEON_PORT || 5432),
    ssl: { rejectUnauthorized: false },
});

pool.connect()
    .then(client => { client.release(); console.log("✅ Conexión a PostgreSQL OK"); })
    .catch(err => console.error("❌ Error al conectar a PostgreSQL:", err));

//  REDIS
const redisClient = createClient({
    url: process.env.REDIS_URL,
    socket: { tls: true, keepAlive: 10000, reconnectStrategy: retries => Math.min(retries * 100, 3000) }
});

redisClient.on("error", err => console.error("Redis error:", err));
redisClient.on("connect", () => console.log("Redis conectado"));
redisClient.on("ready", () => console.log("Redis listo para usar"));

async function conectarRedis() {
    try { if (!redisClient.isOpen) await redisClient.connect(); }
    catch (err) { console.error("Error conectando Redis:", err); }
}

// AWS REKOGNITION client 
const rekognitionClient = process.env.AWS_REGION && process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
    ? new RekognitionClient({
        region: process.env.AWS_REGION,
        credentials: {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
        }
    })
    : null;

//  FFMPEG 
const localFFprobeFolder = process.env.FFMPEG_BIN_PATH;
if (localFFprobeFolder) {
    const ffprobeName = process.platform === "win32" ? "ffprobe.exe" : "ffprobe";
    process.env.FFPROBE_PATH = path.join(localFFprobeFolder, ffprobeName);
    ffmpeg.setFfprobePath(process.env.FFPROBE_PATH);
    console.log("✔ FFprobe configurado:", process.env.FFPROBE_PATH);
} else console.warn("⚠️ FFMPEG_BIN_PATH no está configurado.");

// MULTER 
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, "./uploads"),
    filename: (req, file, cb) => cb(null, `${uuidv4()}${path.extname(file.originalname)}`)
});
const upload = multer({ storage });

// MULTER BIOMETRÍA
const storageBiometria = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = path.join(process.cwd(), "uploads/biometria");
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: (req, file, cb) => cb(null, `${Date.now()}-${uuidv4()}${path.extname(file.originalname)}`)
});
const uploadBiometria = multer({ storage: storageBiometria, limits: { fileSize: 10 * 1024 * 1024 } });

// NODEMAILER 
let transporter = null;
if (process.env.SMTP_HOST && process.env.SMTP_USER) {
    transporter = nodemailer.createTransport({ host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 587), secure: false, auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } });
} else if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
    transporter = nodemailer.createTransport({ service: 'gmail', auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS } });
}

// UTILIDADES 
function safeUnlink(p) { if (p && fs.existsSync(p)) fs.unlinkSync(p); }
function nowISO() { return new Date().toISOString(); }
function limpiarTextoOCR(textoCrudo) { return textoCrudo.replace(/[|:;—]/g, ' ').replace(/[\[\]]/g, ' ').replace(/^[£A]/g, '').replace(/\s+/g, ' ').trim(); }
function extraerIdentificadorDesdeOCR(ocrText) {
    if (!ocrText) return null;
    const duiMatch = ocrText.match(/\b(\d{8}-\d)\b/);
    if (duiMatch) return { tipo: 'DUI', valor: duiMatch[0] };
    const pasaporteMatch = ocrText.match(/\b([A-Z0-9]{6,9})\b/);
    if (pasaporteMatch) return { tipo: 'Pasaporte', valor: pasaporteMatch[0] };
    return null;
}
function authenticateJWT(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ ok: false, message: 'Token requerido' });
    const token = authHeader.split(' ')[1];
    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
        if (err) return res.status(403).json({ ok: false, message: 'Token inválido' });
        req.user = user;
        next();
    });
}

// FUNCIONES DE IMAGEN / VIDEO
async function procesarDocumento(entrada, salida) {
    try { await sharp(entrada).rotate().resize(1200).normalize().greyscale().toFile(salida); return salida; }
    catch (error) { console.error("Error procesando documento:", error); return entrada; }
}
async function realizarOCR(rutaImagen) {
    if (!rutaImagen || !fs.existsSync(rutaImagen)) return "";
    const worker = createWorker();
    try {
        await worker.load();
        await worker.loadLanguage("spa");
        await worker.initialize("spa");
        const { data: { text } } = await worker.recognize(rutaImagen);
        return text || "";
    } catch (err) { console.error("Error OCR: ", err); return ""; }
    finally { await worker.terminate(); }
}
async function extraerRostroDocumento(docPath) {
    const image = sharp(docPath);
    const metadata = await image.metadata();
    const width = Math.max(100, Math.floor((metadata.width || 400) * 0.3));
    const height = Math.max(100, Math.floor((metadata.height || 400) * 0.45));
    const left = Math.max(0, Math.floor((metadata.width || 400) * 0.35));
    const top = Math.max(0, Math.floor((metadata.height || 400) * 0.18));
    return await image.extract({ left, top, width, height }).toBuffer();
}
async function extraerFrameVideo(videoPath) {
    return new Promise((resolve, reject) => {
        const tempPng = path.join(path.dirname(videoPath), `${uuidv4()}.png`);
        ffmpeg(videoPath).screenshots({ timestamps: ['50%'], filename: path.basename(tempPng), folder: path.dirname(tempPng) })
            .on('end', () => { fs.readFile(tempPng, (err, data) => { safeUnlink(tempPng); err ? reject(err) : resolve(data); }); })
            .on('error', err => { safeUnlink(tempPng); reject(err); });
    });
}

// FUNCIONES BD 
async function guardarVerificacion({ user_id = null, ocrText = null, similarityScore = null, match_result = false, liveness = false, edad_valida = null, documento_path = null, selfie_paths = null, ip = null, dispositivo = null, acciones = null, resultado_general = null, notificado = false }) {
    const q = `INSERT INTO verificacion_biometrica (user_id, dui_text, score, match_result, liveness, edad_valida, documento_path, selfie_paths, ip_usuario, dispositivo, acciones, resultado_general, notificado, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, now()) RETURNING id;`;
    const vals = [user_id, ocrText, similarityScore, match_result, liveness, edad_valida, documento_path, selfie_paths ? JSON.stringify(selfie_paths) : null, ip, dispositivo ? JSON.stringify(dispositivo) : null, acciones ? JSON.stringify(acciones) : null, resultado_general, notificado];
    try { const r = await pool.query(q, vals); return r.rows[0].id; } catch (err) { console.error("Error guardando verificacion:", err); return null; }
}

//  ENDPOINTS PRINCIPALES 
// Página principal
app.get('/', (req, res) => res.sendFile(path.join(process.cwd(), 'Views/Index.html')));

// GUARDAR REFERENCIA 
app.post("/guardar-referencia", async (req, res) => {
    try {
        const { usuario_id, imagen_base64 } = req.body;
        if (!usuario_id || !imagen_base64) return res.json({ ok: false, mensaje: "Falta de datos" });
        if (!redisClient.isReady) return res.json({ ok: false, mensaje: "Servicio temporal no disponible" });
        await redisClient.setEx(`REF:${usuario_id}`, 300, imagen_base64);
        return res.json({ ok: true, mensaje: "Rostro de referencia guardado temporalmente" });
    } catch (err) {
        console.error("Error guardando en Redis:", err);
        return res.status(500).json({ ok: false, mensaje: "Error al guardar referencia" });
    }
});

app.post("/analizar", upload.single("imagen"), async (req, res) => {
    const tmpFile = req.file?.path;
    try {
        if (!req.file) return res.status(400).json({ error: "Imagen requerida" });
        const imageBytes = fs.readFileSync(req.file.path);

        if (!rekognitionClient) {
            safeUnlink(req.file.path);
            return res.status(500).json({ error: "AWS Rekognition no configurado" });
        }
        try {
            const params = {
                Image: { Bytes: imageBytes },
                Attributes: ["ALL"]
            };

            const { DetectFacesCommand } = await import('@aws-sdk/client-rekognition').then(m => m).catch(() => ({ DetectFacesCommand: null }));
            if (!DetectFacesCommand) {
                safeUnlink(req.file.path);
                return res.status(500).json({ error: "DetectFacesCommand no disponible en el entorno. Instala @aws-sdk/client-rekognition correctamente." });
            }
            const cmd = new DetectFacesCommand(params);
            const data = await rekognitionClient.send(cmd);
            safeUnlink(req.file.path);
            return res.json({ resultado: data });
        } catch (err) {
            safeUnlink(req.file.path);
            console.error("Error Rekognition:", err);
            return res.status(500).json({ error: "AWS Rekognition falló", detalle: err.message });
        }
    } catch (error) {
        safeUnlink(tmpFile);
        console.error("Error general:", error);
        return res.status(500).json({ error: "Error interno del servidor" });
    }
});
// REGISTRAR USUARIO
app.post('/guardar-registerForm', async (req, res) => {
    try {
        const { nombres, apellidos, sexo, correo, celular, fechanacimiento, tipodocumento, numeroDocumento, contrasena } = req.body;
        if (!correo || !contrasena) return res.status(400).json({ ok: false, message: 'correo y contraseña son requeridos' });
        const hashedPassword = await bcrypt.hash(contrasena, 10);
        const query = `
            INSERT INTO usuarios
            (nombres, apellidos, sexo, correo, celular, fechanacimiento, tipodocumento, numerodocumento, contrasena)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id;
        `;
        const values = [nombres, apellidos, sexo, correo, celular, fechanacimiento, tipodocumento, numeroDocumento, hashedPassword];
        const r = await pool.query(query, values);
        res.status(200).json({ ok: true, id: r.rows[0].id });
    } catch (error) {
        console.error("❌ Error al registrar usuario:", error);
        res.status(500).json({ ok: false, message: "Error al registrar usuario" });
    }
});
app.post('/guardar-biometria', uploadBiometria.fields([
    { name: 'selfie', maxCount: 1 },
    { name: 'dui', maxCount: 1 }
]), async (req, res) => {
    try {
        const user_id = Number(req.body.user_id);
        if (!user_id || isNaN(user_id)) return res.status(400).json({ ok: false, mensaje: "Falta user_id válido" });

        if (!req.files || !req.files['selfie'] || !req.files['dui']) {
            return res.status(400).json({ ok: false, mensaje: "Debes subir selfie y DUI" });
        }

        const selfieFile = req.files['selfie'][0];
        const duiFile = req.files['dui'][0];

        const selfiePath = `/uploads/biometria/${selfieFile.filename}`;
        const duiPath = `/uploads/biometria/${duiFile.filename}`;

        // Guardar en DB la verificación usando la función segura
        const verifId = await guardarVerificacion({
            user_id,
            documento_path: duiPath,
            selfie_paths: [selfiePath],
            match_result: true // si agregas comparación facial, reemplaza aquí
        });

        res.json({ ok: true, mensaje: "Biometría guardada correctamente", verifId, selfiePath, duiPath });
    } catch (err) {
        console.error("Error guardando biometría:", err);
        res.status(500).json({ ok: false, mensaje: "Error al guardar imágenes" });
    }
});


// INICIO DE SESIÓN
app.post('/login', async (req, res) => {
    try {
        const { usuario, password } = req.body;
        const resultado = await pool.query("SELECT * FROM usuarios WHERE correo = $1", [usuario]);
        if (resultado.rows.length === 0) return res.status(404).json({ ok: false, message: "❌ Usuario no encontrado" });

        const user = resultado.rows[0];
        const passwordValida = await bcrypt.compare(password, user.contrasena);
        if (!passwordValida) return res.status(400).json({ ok: false, message: "❌ Contraseña incorrecta" });

        if (!process.env.JWT_SECRET) return res.json({ ok: true, redirect: "/Views/cotizador.html" });

        const token = jwt.sign({ id: user.id, correo: user.correo }, process.env.JWT_SECRET, { expiresIn: '2h' });
        return res.json({ ok: true, token, redirect: "/VerificacionBio.html" });
    } catch (error) {
        console.error(error);
        res.status(500).json({ ok: false, message: "Error en el inicio de sesión" });
    }
});

// GUARDAR BIOMETRIA sencillo
app.post('/guardar-biometria', uploadBiometria.fields([
    { name: 'selfie', maxCount: 1 },
    { name: 'dui', maxCount: 1 }
]), async (req, res) => {
    try {
        const user_id = Number(req.body.user_id);
        if (!user_id || isNaN(user_id)) return res.status(400).json({ ok: false, mensaje: "Falta user_id válido" });
        if (!req.files || !req.files['selfie'] || !req.files['dui']) {
            return res.status(400).json({ ok: false, mensaje: "Debes subir selfie y DUI" });
        }
        const selfieFile = req.files['selfie'][0];
        const duiFile = req.files['dui'][0];
        const selfiePath = `/uploads/biometria/${selfieFile.filename}`;
        const duiPath = `/uploads/biometria/${duiFile.filename}`;
        const verifId = await guardarVerificacion({
            user_id,
            documento_path: duiPath,
            selfie_paths: [selfiePath],
            match_result: true
        });
        res.json({ ok: true, mensaje: "Biometría guardada correctamente", verifId, selfiePath, duiPath });
    } catch (err) {
        console.error("Error guardando biometría:", err);
        res.status(500).json({ ok: false, mensaje: "Error al guardar imágenes" });
    }
});
// Guardar cotización
app.post('/guardar-cotizacionForm', async (req, res) => {
    try {
        const { id, monto_asegurar, cesion_beneficios, poliza } = req.body;
        if (!id) return res.status(400).json({ ok: false, message: 'id de usuario requerido' });

        const usuarioRes = await pool.query("SELECT nombres, apellidos, correo, celular FROM usuarios WHERE id=$1", [id]);
        if (usuarioRes.rows.length === 0) return res.status(404).json({ ok: false, message: 'Usuario no encontrado' });

        const usuario = usuarioRes.rows[0];
        const insertQuery = `
            INSERT INTO formulariocotizacion
            (usuario_id, nombre, primerapellido, segundoapellido, celular, correo, monto_asegurar, cesion_beneficios, poliza)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
            RETURNING *;
        `;
        const values = [id, usuario.nombres || '', usuario.apellidos || '', '', usuario.celular || '', usuario.correo || '', monto_asegurar, cesion_beneficios, poliza];
        const result = await pool.query(insertQuery, values);

        if (transporter) await transporter.sendMail({
            from: process.env.SMTP_FROM || process.env.EMAIL_USER,
            to: usuario.correo,
            subject: 'Cotización Registrada',
            html: `<h2>Hola ${usuario.nombres || ''},</h2>
                <p>Tu cotización ha sido registrada correctamente:</p>
                <ul>
                    <li>Monto a asegurar: $${monto_asegurar}</li>
                    <li>Cesión de beneficios: ${cesion_beneficios}</li>
                    <li>Póliza: ${poliza}</li>
                </ul>`
        });

        res.json({ ok: true, message: 'Cotización guardada y correo enviado (si configurado)', data: result.rows[0] });
    } catch (err) {
        console.error(err);
        res.status(500).json({ ok: false, message: 'Error al guardar cotización o enviar correo' });
    }
});

// Guardar contratación
app.post('/guardar-contratacion', async (req, res) => {
    try {
        const { usuario_id, nombre_completo, correo, celular } = req.body;
        const usuarioExiste = await pool.query('SELECT * FROM usuarios WHERE id=$1', [usuario_id]);
        if (usuarioExiste.rows.length === 0) return res.send('❌ Usuario no existe');

        await pool.query(`INSERT INTO contrataciones (usuario_id, nombre_completo, correo, celular) VALUES($1,$2,$3,$4)`, [usuario_id, nombre_completo, correo, celular]);
        res.send('✅ Contratación registrada correctamente');
    } catch (err) {
        console.error(err);
        res.status(500).send('Error al registrar contratación');
    }
});

// Lógica de Verificación de Identidad 
// VERIFICAR IDENTIDAD 
app.post('/verificar-identidad', upload.fields([
    { name: 'doc', maxCount: 1 },
    { name: 'video', maxCount: 1 }
]), async (req, res) => {
    const tmpFilesToRemove = [];
    let tipoDocumentoDetectado = "DESCONOCIDO";
    let rostroCoincide = false;
    let similarityScore = null;
    let correo_usuario = null;
    let nombre_usuario = null;
    let verificationId = null;
    let ocrText = "Texto no legible";

    const MAX_INTENTOS = 5;
    const EXPIRACION_INTENTOS = 86400; // 24h

    try {
        // ----------------------
        // Validar user_id
        // ----------------------
        let userId = req.body.user_id;
        if (!userId || userId === "null") {
            return res.status(400).json({ exito: false, mensaje: "ID de usuario inválido o no proporcionado" });
        }
        userId = parseInt(userId);
        if (isNaN(userId)) {
            return res.status(400).json({ exito: false, mensaje: "ID de usuario debe ser un número válido" });
        }

        // ----------------------
        // Control de intentos
        // ----------------------
        await conectarRedis();
        const key = `INTENTOS:${userId}`;
        let intentos = await redisClient.get(key);
        intentos = intentos ? parseInt(intentos) : 0;
        if (intentos >= MAX_INTENTOS) {
            return res.status(429).json({ exito: false, mensaje: `⚠️ Has alcanzado el máximo de ${MAX_INTENTOS} intentos en 24 horas. Intenta más tarde.` });
        }

        // ----------------------
        // Obtener info usuario
        // ----------------------
        const userRes = await pool.query("SELECT id, nombres, apellidos, correo, fechanacimiento FROM usuarios WHERE id = $1", [userId]);
        if (userRes.rows.length > 0) {
            correo_usuario = userRes.rows[0].correo;
            nombre_usuario = `${userRes.rows[0].nombres || ''} ${userRes.rows[0].apellidos || ''}`.trim();
        } else {
            return res.status(404).json({ exito: false, mensaje: "Usuario no encontrado" });
        }

        // ----------------------
        // Validar archivo doc
        // ----------------------
        if (!req.files?.doc?.[0]) return res.status(400).json({ exito: false, mensaje: 'Documento no enviado' });
        const docFile = req.files.doc[0];
        const docPath = docFile.path;
        tmpFilesToRemove.push(docPath);

        const processedDocPath = path.join(path.dirname(docPath), `proc_${uuidv4()}.png`);
        await procesarDocumento(docPath, processedDocPath);
        tmpFilesToRemove.push(processedDocPath);

        // ----------------------
        // OCR
        // ----------------------
        const ocrTextCrudo = (await realizarOCR(processedDocPath)) || "Texto no legible";
        ocrText = limpiarTextoOCR(ocrTextCrudo);
        const identificadorObj = extraerIdentificadorDesdeOCR(ocrText) || null;
        const identificador = identificadorObj ? identificadorObj.valor : "DESCONOCIDO";

        const textoMinus = ocrText.toLowerCase();
        if (textoMinus.includes("dui") || textoMinus.includes("documento") || textoMinus.includes("nacimiento") || textoMinus.match(/\b\d{8}-\d\b/)) {
            tipoDocumentoDetectado = "DUI";
        } else if (textoMinus.includes("pasaporte") || textoMinus.includes("passport")) {
            tipoDocumentoDetectado = "Pasaporte";
        } else {
            tmpFilesToRemove.forEach(p => safeUnlink(p));
            return res.json({ exito: false, mensaje: "El archivo subido no parece un documento oficial (DUI o pasaporte).", tipo_documento: "Foto no válida", vista_previa: `/uploads/${path.basename(docPath)}` });
        }

        // ----------------------
        // Comparación facial
        // ----------------------
        const rostroDocBuffer = await extraerRostroDocumento(processedDocPath);
        let encryptedSelfies = null;

        if (req.files.video?.[0]) {
            const videoPath = req.files.video[0].path;
            tmpFilesToRemove.push(videoPath);
            try {
                const frameBuf = await extraerFrameVideo(videoPath);

                if (rekognitionClient) {
                    const compareCmd = new CompareFacesCommand({
                        SourceImage: { Bytes: frameBuf },
                        TargetImage: { Bytes: rostroDocBuffer },
                        SimilarityThreshold: Number(process.env.SIMILARITY_THRESHOLD || 80)
                    });
                    const compareRes = await rekognitionClient.send(compareCmd);
                    if (compareRes.FaceMatches && compareRes.FaceMatches.length > 0) {
                        rostroCoincide = true;
                        similarityScore = compareRes.FaceMatches[0].Similarity || null;
                    } else {
                        rostroCoincide = false;
                        similarityScore = 0;
                    }
                } else {
                    console.warn('AWS Rekognition no configurado; se omite comparación facial');
                }

                if (KEY) {
                    const videoBuffer = fs.readFileSync(videoPath);
                    const enc = encryptBuffer(videoBuffer);
                    encryptedSelfies = [{ data: enc.data, iv: enc.iv }];
                }
            } catch (err) {
                console.error('Error comparación facial:', err);
            }
        }

        // ----------------------
        // Edad
        // ----------------------
        let edad_valida = 1;
        if (userRes.rows[0].fechanacimiento) {
            const birthDate = new Date(userRes.rows[0].fechanacimiento);
            const ageDiff = Date.now() - birthDate.getTime();
            const ageDate = new Date(ageDiff);
            const age = Math.abs(ageDate.getUTCFullYear() - 1970);
            if (age < 18) edad_valida = 0;
        }

        // ----------------------
        // Estados
        // ----------------------
        const livenessStatus = req.body.liveness ? 1 : 0;
        const ocrMatchStatus = identificador !== "DESCONOCIDO" ? 1 : 0;

        const datosSHAP = {
            similarityScore: similarityScore || 0,
            liveness: livenessStatus,
            tipoDocumentoDetectado,
            OCR_match: ocrMatchStatus,
            edad_valida
        };

        let shapResultado = null;
        try {
            shapResultado = await obtenerSHAP(datosSHAP);
        } catch (err) {
            console.error("Error obteniendo SHAP:", err);
            shapResultado = { error: err.message || "Error al calcular SHAP" };
        }

        // ----------------------
        // Registrar intento
        // ----------------------
        const nuevosIntentos = await redisClient.incr(key);
        if (nuevosIntentos === 1) await redisClient.expire(key, EXPIRACION_INTENTOS);

        // ----------------------
        // Guardar verificación
        // ----------------------
        const resultado_general = rostroCoincide ? "APROBADO" : "RECHAZADO";
        verificationId = await guardarVerificacion({
            user_id: userId, // <-- ya es entero seguro
            ocrText,
            similarityScore,
            match_result: rostroCoincide,
            liveness: livenessStatus === 1,
            edad_valida: edad_valida === 1,
            documento_path: docPath,
            selfie_paths: encryptedSelfies,
            ip: req.ip || req.headers['x-forwarded-for'] || null,
            dispositivo: { ua: req.get("User-Agent") || null },
            acciones: { shap: shapResultado },
            resultado_general,
            notificado: correo_usuario ? true : false
        });

        // ----------------------
        // Notificaciones
        // ----------------------
        if (rostroCoincide && correo_usuario) {
            await enviarCorreoNotificacion(correo_usuario, "Verificación Exitosa", `<p>Hola ${nombre_usuario},</p><p>Tu verificación fue <strong>aprobada</strong>. Similitud: ${similarityScore?.toFixed(2)}%</p>`);
        } else if (!rostroCoincide && correo_usuario) {
            await enviarCorreoNotificacion(correo_usuario, "Verificación Fallida", `<p>Hola ${nombre_usuario},</p><p>La verificación <strong>no coincidió</strong>.</p>`);
        }

        if (similarityScore !== null && similarityScore < 50 && process.env.FROM_EMAIL) {
            await enviarCorreoNotificacion(process.env.FROM_EMAIL, "Revisión Manual Requerida", `<p>Usuario ${correo_usuario} requiere revisión manual. ID: ${verificationId}</p>`);
        }

        // ----------------------
        // Respuesta
        // ----------------------
        return res.json({
            exito: rostroCoincide,
            mensaje: rostroCoincide ? `Verificación exitosa (Similitud: ${similarityScore?.toFixed(2)}%)` : "Rostro no coincide con el documento",
            id_verificacion: verificationId,
            match: rostroCoincide,
            score: similarityScore,
            ocr: ocrText,
            tipo_documento: tipoDocumentoDetectado,
            identificador,
            shap_model_output: shapResultado
        });

    } catch (err) {
        console.error("Error en /verificar-identidad:", err);
        return res.status(500).json({ exito: false, mensaje: "Error en el servidor durante la verificación" });
    } finally {
        tmpFilesToRemove.forEach(p => safeUnlink(p));
    }
});


// ERROR HANDLER (global)
app.use((err, req, res, next) => {
    console.error("Error no capturado:", err);
    if (!res.headersSent) res.status(500).json({ exito: false, mensaje: "Error interno del servidor", detalle: err.message });
});

// INICIAR SERVIDOR
async function iniciarServidor() {
    try {
        await conectarRedis();
        app.listen(PORT, () => {
            console.log(`✅ Servidor activo en http://localhost:${PORT}`);
        });
    } catch (err) {
        console.error("Error al iniciar servidor:", err);
        process.exit(1);
    }
}

// graceful shutdown
process.on('SIGINT', async () => {
    console.log('\nCerrando conexiones...');
    try {
        if (pool) await pool.end();
        if (redisClient?.isOpen) await redisClient.quit();
        console.log('Conexiones cerradas correctamente');
        process.exit(0);
    } catch (err) {
        console.error('Error al cerrar:', err);
        process.exit(1);
    }
});

// start
iniciarServidor();