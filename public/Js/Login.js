document.getElementById("loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();

    const usuario = document.getElementById("usuario").value.trim();
    const password = document.getElementById("password").value.trim();

    try {
        const response = await fetch("http://localhost:3000/login", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ usuario, password })
        });

        const data = await response.json();

        if (!response.ok || !data.ok) {
            alert(data.message || "Usuario o contraseña incorrectos");
            return;
        }

        // Guardar token y usuario_id
        localStorage.setItem("token", data.token);
        localStorage.setItem("usuario_id", data.usuario_id);

        //  Paso obligatorio: verificación biométrica después del login
        window.location.href = "VerificacionBio.html";

    } catch (error) {
        console.error("Error al iniciar sesión:", error);
        alert("Error al conectar con el servidor.");
    }
});

// Activar íconos Feather
if (window.feather) feather.replace();
