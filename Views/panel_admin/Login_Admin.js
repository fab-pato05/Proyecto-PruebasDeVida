(function(){
  function renderAdminForm(containerId = 'admin-form-container') {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = `
      <div class="admin-form-wrapper">
        <form id="adminForm" class="space-y-4">
          <input type="hidden" name="id" id="admin-id" />

          <div>
            <label for="admin-nombre">Nombre</label>
            <input id="admin-nombre" name="nombre" type="text" required class="w-full p-2 border rounded" />
          </div>

          <div>
            <label for="admin-correo">Correo</label>
            <input id="admin-correo" name="correo" type="email" required class="w-full p-2 border rounded" />
          </div>

          <div>
            <label for="admin-contrasena">Contraseña</label>
            <input id="admin-contrasena" name="contrasena" type="password" required minlength="6" class="w-full p-2 border rounded" />
          </div>

          <div>
            <label for="admin-rol">Rol</label>
            <select id="admin-rol" name="rol" class="w-full p-2 border rounded">
              <option value="admin">admin</option>
              <option value="superadmin">superadmin</option>
            </select>
          </div>

          <div class="flex items-center gap-2">
            <button type="submit" id="admin-submit" class="px-4 py-2 bg-blue-600 text-white rounded">Guardar</button>
            <button type="button" id="admin-cancel" class="px-4 py-2 bg-gray-200 rounded">Cancelar</button>
            <span id="admin-msg" style="margin-left:8px;color:green;display:none"></span>
          </div>
        </form>
      </div>
    `;

    const form = document.getElementById('adminForm');
    const msg = document.getElementById('admin-msg');
    const cancelBtn = document.getElementById('admin-cancel');

    form.addEventListener('submit', (e) => {
      e.preventDefault();

      const data = {
        id: document.getElementById('admin-id').value || null,
        nombre: document.getElementById('admin-nombre').value.trim(),
        correo: document.getElementById('admin-correo').value.trim(),
        contrasena: document.getElementById('admin-contrasena').value,
        rol: document.getElementById('admin-rol').value,
      };

      const event = new CustomEvent('adminFormSubmit', { detail: data });
      window.dispatchEvent(event);

      msg.textContent = 'Formulario preparado. Procesa los datos en el backend.';
      msg.style.display = 'inline';

      document.getElementById('admin-contrasena').value = '';

      setTimeout(() => { msg.style.display = 'none'; }, 3000);
    });

    cancelBtn.addEventListener('click', () => {
      form.reset();
      document.getElementById('admin-id').value = '';
    });
  }

  function loadAdminToForm(admin) {
    if (!admin) return;
    if (!document.getElementById('admin-nombre')) return;

    document.getElementById('admin-id').value = admin.id || '';
    document.getElementById('admin-nombre').value = admin.nombre || '';
    document.getElementById('admin-correo').value = admin.correo || '';
    document.getElementById('admin-rol').value = admin.rol || 'admin';
  }

  function init(containerId) {
    renderAdminForm(containerId);
    return { load: loadAdminToForm };
  }

  window.AdminForm = { init, loadAdminToForm };

})();
