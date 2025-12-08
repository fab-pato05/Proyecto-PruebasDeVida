document.getElementById("cotizacionForm").addEventListener("submit", async function (e) {
    e.preventDefault();

    // Obtener datos del formulario
    const formData = new FormData(this);
    const data = Object.fromEntries(formData.entries());

    // Validar monto correcto
    const monto = parseFloat(data.monto);
    if (isNaN(monto) || monto < 10000) {
        alert("El monto a asegurar debe ser mayor o igual a $10000");
        return;
    }

    // Enviar al servidor
    try {
        const res = await fetch("http://localhost:3000/guardar-cotizacionForm", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data)
        });

        const text = await res.text();
        alert(text);

        this.reset();
    } catch (err) {
        console.error(err);
        alert("❌ Error al enviar la cotización. Intente nuevamente.");
    }
});
