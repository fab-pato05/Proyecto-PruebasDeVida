console.log("Biometria.js listo");

// ELEMENTOS DEL DOM 
const canvas = document.getElementById("canvas");
const captureBtn = document.getElementById("captureBtn");
const submitBtn = document.getElementById("submitBtn");
const docInput = document.getElementById("duiFile"); // adaptado al HTML
const docStatus = document.getElementById("docStatus") || document.getElementById("mensajeUsuario");
const mensajeUsuario = document.getElementById("mensajeUsuario");
const selfiePreviewImg = document.getElementById("selfiePreviewImg");
const selfiePreview = document.getElementById("selfiePreview");
const docPreviewImg = document.getElementById("duiPreview");

//  VARIABLES 
let rostroDetectado = false;
let documentoValido = false;
let behaviorVerified = false;
let facePositions = [];
let faceMesh, pose;
let mediaRecorder;
let recordedBlobs = [];
let instrucciones = [];
let instruccionActual = 0;
let accionesRegistro = []; // {action, requestedAt, performedAt, success}

//  USUARIO 
let user_id = Number(localStorage.getItem('userId')) || null;
function cargarUserId() {
  const storedId = localStorage.getItem('userId');
  if (storedId) {
    user_id = storedId;
    console.log(`Usuario ID cargado: ${user_id}`);
  } else {
    mostrarMensajeUsuario("❌ No se encontró ID de usuario. Inicia sesión.", "error");
    submitBtn.disabled = true;
  }
}
cargarUserId();

//  FUNCIONES DE UI 
function mostrarMensajeUsuario(texto, tipo = "info") {
  if (mensajeUsuario) {
    mensajeUsuario.textContent = texto;
    mensajeUsuario.className = tipo === "error" ? "text-sm text-red-600 mt-3" : "text-sm text-gray-700 mt-3";
    mensajeUsuario.style.color = tipo === "error" ? "#dc2626" : "#2563eb";
    mensajeUsuario.style.fontWeight = "600";
  }
}

function habilitarEnvio() {
  if (documentoValido && rostroDetectado) {
    submitBtn.disabled = false;
    submitBtn.classList.remove("bg-gray-400", "cursor-not-allowed", "opacity-50");
    submitBtn.classList.add("bg-green-600", "hover:bg-green-700", "cursor-pointer");
  } else {
    submitBtn.disabled = true;
    submitBtn.classList.remove("bg-green-600", "hover:bg-green-700", "cursor-pointer");
    submitBtn.classList.add("bg-gray-400", "cursor-not-allowed", "opacity-50");
  }
}

//  CAMARA 
async function iniciarMediaPipe() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" }
    });
    video.srcObject = stream;
    await video.play();

    video.onloadedmetadata = () => {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    };

    faceMesh = new FaceMesh({ locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.4/${file}` });
    faceMesh.setOptions({ maxNumFaces: 1, refineLandmarks: true, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
    faceMesh.onResults(onFaceResults);

    pose = new Pose({ locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5/${file}` });
    pose.setOptions({ modelComplexity: 1, smoothLandmarks: true, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
    pose.onResults(onPoseResults);

    const processFrame = async () => {
      if (video.readyState >= 2) {
        await faceMesh.send({ image: video });
        await pose.send({ image: video });
      }
      requestAnimationFrame(processFrame);
    };
    processFrame();

    mostrarMensajeUsuario("📷 Cámara iniciada correctamente.");
  } catch (err) {
    console.error("Error iniciar cámara:", err);
    mostrarMensajeUsuario("No se pudo acceder a la cámara. Revisa permisos.", "error");
  }
}

//  CAPTURA SELFIE 
captureBtn.addEventListener("click", () => {
  const ctx = canvas.getContext("2d");
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  rostroDetectado = true;
  selfiePreviewImg.src = canvas.toDataURL();
  selfiePreview.classList.remove("hidden");
  sessionStorage.setItem("selfie_capturada", selfiePreviewImg.src);
  mostrarMensajeUsuario("✅ Selfie capturada correctamente.");
  habilitarEnvio();
});

// CARGA DUI 
docInput.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;

  if (!["image/jpeg", "image/png"].includes(file.type) || file.size > 6 * 1024 * 1024) {
    mostrarMensajeUsuario("Archivo no válido. Usa JPG/PNG menores a 6MB.", "error");
    documentoValido = false;
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    docPreviewImg.src = reader.result;
    docPreviewImg.parentElement.classList.remove("hidden");
    sessionStorage.setItem("dui_imagen", reader.result);
    documentoValido = true;
    habilitarEnvio();
  };
  reader.readAsDataURL(file);
});

// INSTRUCCIONES
function generarInstruccionesAleatorias() {
  const pool = ["Mueve la cabeza de lado a lado", "Parpadea dos veces", "Sonríe", "Inclina la cabeza a la derecha", "Mira arriba"];
  instrucciones = pool.sort(() => Math.random() - 0.5).slice(0, 3);
  instruccionActual = 0;
}
function registrarAccionSolicitada(action) { accionesRegistro.push({ action, requestedAt: new Date().toISOString(), performedAt: null, success: false }); }
function marcarAccionRealizada(success = true) { const last = accionesRegistro[accionesRegistro.length - 1]; if (!last) return; last.performedAt = new Date().toISOString(); last.success = !!success; }

//  EAR 
function calcularEAR(ojo) {
  const vertical1 = Math.hypot(ojo[1].x - ojo[5].x, ojo[1].y - ojo[5].y);
  const vertical2 = Math.hypot(ojo[2].x - ojo[4].x, ojo[2].y - ojo[4].y);
  const horizontal = Math.hypot(ojo[0].x - ojo[3].x, ojo[0].y - ojo[3].y);
  return (vertical1 + vertical2) / (2.0 * horizontal);
}

//  FACE & POSE 
function onFaceResults(results) {
  const ctx = canvas.getContext("2d");
  ctx.save();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (results.image) ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height);

  if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
    rostroDetectado = true;
    const landmarks = results.multiFaceLandmarks[0];

    // landmarks dibujados
    drawConnectors(ctx, landmarks, FACEMESH_TESSELATION, { color: '#00FF00', lineWidth: 1 });
    drawLandmarks(ctx, landmarks, { color: '#FF0000', lineWidth: 1 });

    const currentInstruction = instrucciones[instruccionActual];

    // detectar movimientos
    const nose = landmarks[1];
    facePositions.push(nose.x);
    if (facePositions.length > 20) facePositions.shift();

    const movimientoX = Math.max(...facePositions) - Math.min(...facePositions);
    if (currentInstruction?.includes("Mueve") && movimientoX > 0.06) { marcarAccionRealizada(true); instruccionActual++; }

    // parpadeo
    const ojoIzq = [33, 160, 158, 133, 153, 144].map(i => landmarks[i]);
    const ojoDer = [263, 387, 385, 362, 380, 373].map(i => landmarks[i]);
    const ear = (calcularEAR(ojoIzq) + calcularEAR(ojoDer)) / 2;
    if (currentInstruction?.includes("Parpade") && ear < 0.22) { marcarAccionRealizada(true); instruccionActual++; }

    // sonrisa
    const bocaIzq = landmarks[61]; const bocaDer = landmarks[291];
    const labioSup = landmarks[13]; const labioInf = landmarks[14];
    const proporcion = Math.hypot(bocaDer.x - bocaIzq.x, bocaDer.y - bocaIzq.y) / (Math.hypot(labioInf.y - labioSup.y, labioInf.x - labioSup.x)+1e-6);
    if (currentInstruction?.includes("Sonríe") && proporcion > 2.5) { marcarAccionRealizada(true); instruccionActual++; }

    mostrarMensajeUsuario("✅ Rostro detectado (biometría activa).");
  } else mostrarMensajeUsuario("No se detecta rostro. Ajusta iluminación y posición.", "error");
  ctx.restore();
}
function onPoseResults(results) { if (results.poseLandmarks) { /* optional heuristics */ } habilitarEnvio(); }

// RECORDING 
function startRecording() { recordedBlobs = []; mediaRecorder = new MediaRecorder(video.srcObject); mediaRecorder.ondataavailable = e => { if(e.data && e.data.size>0) recordedBlobs.push(e.data); }; mediaRecorder.start(); }
function stopRecording() { return new Promise(resolve => { mediaRecorder.onstop = () => resolve(new Blob(recordedBlobs, { type:'video/webm' })); mediaRecorder.stop(); }); }

// FLUJO VERIFICACION 
async function iniciarFlujoVerificacion() {
  if (!documentoValido) { mostrarMensajeUsuario("Sube primero tu documento.", "error"); return; }
  generarInstruccionesAleatorias();
  accionesRegistro = [];
  registrarAccionSolicitada(instrucciones[0]);
  startRecording();
  const timeoutAt = Date.now() + 25_000;
  while (!behaviorVerified && Date.now()<timeoutAt) await new Promise(r=>setTimeout(r,400));
  const videoBlob = await stopRecording();
  await enviarVerificacion(videoBlob);
}

//  ENVIO 
async function enviarVerificacion(videoBlob){
  try {
    const file = docInput.files[0]; if(!file){mostrarMensajeUsuario("Documento no encontrado","error"); return;}
    const fd = new FormData();
    fd.append("doc", file);
    fd.append("video", videoBlob, `selfie-${Date.now()}.webm`);
    fd.append("acciones", JSON.stringify(accionesRegistro));
    fd.append("device", JSON.stringify({ userAgent:navigator.userAgent, platform:navigator.platform, language:navigator.language }));
    fd.append("user_id", user_id);
    mostrarMensajeUsuario("Enviando verificación...");
    const resp = await fetch("http://localhost:3000/verificar-identidad",{method:"POST",body:fd});
    const data = await resp.json();
    if(data.exito){ mostrarMensajeUsuario("✅ Verificación completada correctamente."); docStatus.textContent = `Resultado: ${data.mensaje || "Éxito"}`; docStatus.className="text-sm text-green-600 mt-1";}
    else{ mostrarMensajeUsuario("❌ "+(data.mensaje||"Fallo"),"error"); docStatus.textContent=data.mensaje||"Fallo"; docStatus.className="text-sm text-red-600 mt-1"; }
  } catch(err){ console.error(err); mostrarMensajeUsuario("Error al enviar la verificación","error"); }
}

//  BOTON SUBMIT
submitBtn.addEventListener("click", async e=>{
  e.preventDefault();
  if(!documentoValido){ mostrarMensajeUsuario("⚠️ Sube primero tu documento.","error"); return;}
  if(!rostroDetectado){ mostrarMensajeUsuario("⚠️ Asegúrate de que tu rostro esté visible.","error"); return;}
  submitBtn.disabled=true; submitBtn.classList.add("opacity-50","cursor-not-allowed"); submitBtn.classList.remove("hover:bg-green-700","cursor-pointer");
  mostrarMensajeUsuario("⏳ Iniciando verificación con IA...");
  await iniciarFlujoVerificacion();
  setTimeout(()=>habilitarEnvio(),2000);
});

// GUIA INICIAL
async function mostrarGuiaUsuario(){
  const pasos=["Asegúrate de tener buena iluminación","Mira directamente a la cámara","Cuando estés listo, presiona 'Tomar Selfie'","Luego sigue las instrucciones en pantalla"];
  for(let i=0;i<pasos.length;i++){ mostrarMensajeUsuario("📢 "+pasos[i]); await new Promise(r=>setTimeout(r,3500)); }
}

//  INICIALIZACION
window.addEventListener("load", async ()=>{
  await iniciarMediaPipe();
  await mostrarGuiaUsuario();
  generarInstruccionesAleatorias();
  registrarAccionSolicitada(instrucciones[0]);
  mostrarMensajeUsuario("Sistema listo para iniciar verificación.");
});
