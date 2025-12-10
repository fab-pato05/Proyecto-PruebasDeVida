// Toggle mostrar/ocultar contraseña
const toggleBtn = document.getElementById('togglePwd');
const pwdInput = document.getElementById('contrasena');

toggleBtn.addEventListener('click', () => {
    if (pwdInput.type === 'password') {
        pwdInput.type = 'text';
        toggleBtn.textContent = 'Ocultar';
    } else {
        pwdInput.type = 'password';
        toggleBtn.textContent = 'Mostrar';
    }
});

// Manejo de envío del formulario
const form = document.getElementById('registerForm');
const mensaje = document.getElementById('mensaje');
const submitBtn = document.getElementById('submitBtn');

form.addEventListener('submit', (e) => {
    e.preventDefault();

    // desactivar botón
    submitBtn.disabled = true;
    submitBtn.classList.add('opacity-60', 'cursor-not-allowed');
    mensaje.textContent = '';

    // Datos del formulario
    const formData = new FormData(form);
    const usuarioData = Object.fromEntries(formData.entries());

    // Guardar temporalmente en sessionStorage
    sessionStorage.setItem("usuarioData", JSON.stringify(usuarioData));

    mensaje.className = 'text-center mt-4 text-sm font-medium text-green-600';
    mensaje.textContent = 'Datos guardados temporalmente. Redirigiendo a verificación biométrica...';

    setTimeout(() => {
        window.location.href = "Views/Biometria.html";
    }, 1000);
});

