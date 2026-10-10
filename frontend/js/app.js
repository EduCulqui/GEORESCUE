/**
 * QuantumGeoRescue AI - Lógica Principal del Frontend
 * Soporte B2C (Ciudadano & Familia) y B2G (Centro de Comando & Rescate)
 */

const App = {
    // Estado de la sesión y mapas
    usuarioActual: null,
    rolActual: null,
    institucionActual: null,
    socketInstitucional: null,
    _authFlowVersion: 0,
    _adminPanelHooked: false,
    mapaCiudadano: null,
    mapaB2G: null,
    marcadorCiudadano: null,
    marcadoresB2G: [],
    polilineaRutaB2G: null,
    marcadorBaseCOER: null,
    timerCuentaRegresiva: null,
    segundosRestantes: 10,
    reconocimientoVoz: null,
    escuchandoVoz: false,
    geolocalizacionActual: null,

    init() {
        this.verificarSaludBackend();
        this.verificarSesionPrevia();
        this.inicializarModuloAntirrobo();
        this.inicializarPlanesPago();
        this.cargarPreciosPlanes();
        this.inicializarAccesoInstitucional();
        this.inicializarAceptacionInvitacion();
        this.inicializarPanelAdministracion();
        this.inicializarValidacionDePagos();
        this.restaurarSesionPropietarios();
    },

    // El backend guarda las fechas en UTC sin indicar la zona. Se marcan como UTC
    // para que el navegador las muestre en la hora local del usuario.
    formatearFecha(valor) {
        if (!valor) return '—';
        const texto = String(valor);
        const iso = /(Z|[+-]\d{2}:\d{2})$/.test(texto) ? texto : `${texto}Z`;
        return new Date(iso).toLocaleString();
    },

    mostrarLoginPropietarios() {
        this.cerrarSesion();
        this.cambiarTabAuth('login');
        document.getElementById('form-login').classList.add('hidden');
        document.getElementById('form-registro').classList.add('hidden');
        document.getElementById('form-login-propietarios').classList.remove('hidden');
        document.getElementById('btn-acceso-propietarios').classList.add('hidden');
        document.getElementById('login-feedback').textContent = '';
    },

    ocultarLoginPropietarios() {
        document.getElementById('form-login-propietarios').classList.add('hidden');
        document.getElementById('btn-acceso-propietarios').classList.remove('hidden');
        this.cambiarTabAuth('login');
    },

    async manejarLoginPropietarios(event) {
        event.preventDefault();
        const keyInput = document.getElementById('clave-propietarios');
        const feedback = document.getElementById('owner-login-feedback');
        feedback.textContent = 'Validando acceso...';
        try {
            const response = await ApiService.loginPropietarios(keyInput.value);
            sessionStorage.setItem('qgeo_owner_token', response.access_token);
            sessionStorage.setItem('qgeo_owner_must_change_password', String(response.must_change_password));
            keyInput.value = '';
            this.mostrarPanelAdministracion();
            this.actualizarVistaCambioClavePropietario();
            if (!response.must_change_password) await this.cargarSolicitudesInstitucionales();
        } catch (error) {
            feedback.textContent = error.message;
            feedback.className = 'text-xs text-center min-h-[1rem] text-red-400';
        }
    },

    mostrarPanelAdministracion() {
        document.getElementById('pantalla-auth').classList.add('hidden');
        document.getElementById('pantalla-dashboard').classList.add('hidden');
        document.getElementById('panel-administracion').classList.remove('hidden');
    },

    restaurarSesionPropietarios() {
        if (sessionStorage.getItem('qgeo_owner_token')) {
            this.mostrarPanelAdministracion();
            this.actualizarVistaCambioClavePropietario();
            if (sessionStorage.getItem('qgeo_owner_must_change_password') !== 'true') {
                this.cargarSolicitudesInstitucionales();
            }
        }
    },

    actualizarVistaCambioClavePropietario() {
        const mustChange = sessionStorage.getItem('qgeo_owner_must_change_password') === 'true';
        document.getElementById('owner-password-change-form').classList.toggle('hidden', !mustChange);
        document.getElementById('owner-applications-section').classList.toggle('hidden', mustChange);
    },

    async cambiarContrasenaPropietarios(event) {
        event.preventDefault();
        const currentPassword = document.getElementById('owner-current-password').value;
        const newPassword = document.getElementById('owner-new-password').value;
        const confirmation = document.getElementById('owner-confirm-password').value;
        const feedback = document.getElementById('owner-password-feedback');
        if (newPassword !== confirmation) {
            feedback.textContent = 'Las contraseñas nuevas no coinciden.';
            feedback.className = 'mt-3 text-xs text-red-400';
            return;
        }
        feedback.textContent = 'Actualizando contraseña...';
        try {
            const response = await ApiService.cambiarContrasenaPropietarios({
                current_password: currentPassword,
                new_password: newPassword,
            });
            sessionStorage.setItem('qgeo_owner_token', response.access_token);
            sessionStorage.setItem('qgeo_owner_must_change_password', 'false');
            document.getElementById('owner-password-change-form').reset();
            this.actualizarVistaCambioClavePropietario();
            await this.cargarSolicitudesInstitucionales();
        } catch (error) {
            feedback.textContent = error.message;
            feedback.className = 'mt-3 text-xs text-red-400';
        }
    },

    cerrarSesionPropietarios() {
        sessionStorage.removeItem('qgeo_owner_token');
        sessionStorage.removeItem('qgeo_owner_must_change_password');
        document.getElementById('clave-propietarios').value = '';
        document.getElementById('owner-current-password').value = '';
        document.getElementById('owner-new-password').value = '';
        document.getElementById('owner-confirm-password').value = '';
        document.getElementById('panel-administracion').classList.add('hidden');
        document.getElementById('pantalla-auth').classList.remove('hidden');
        this.ocultarLoginPropietarios();
    },

    inicializarPanelAdministracion() {
        if (this._adminPanelHooked) return;
        this._adminPanelHooked = true;
        document.getElementById('owner-applications-list')?.addEventListener('click', async (event) => {
            const button = event.target.closest('[data-admin-action]');
            if (!button) return;
            const card = button.closest('[data-owner-application]');
            const applicationId = Number(card?.dataset.ownerApplication);
            const action = button.dataset.adminAction;
            const notes = card.querySelector('[data-review-notes]').value.trim();
            if (notes.length < 10) {
                alert('Escribe observaciones de revisión (mínimo 10 caracteres).');
                return;
            }

            let payload = { review_notes: notes };
            if (action === 'approve') {
                const source = card.querySelector('[data-verification-source]').value.trim();
                try {
                    if (new URL(source).protocol !== 'https:') throw new Error();
                } catch {
                    alert('Registra una URL HTTPS oficial que hayas consultado.');
                    return;
                }
                if (!window.confirm('¿Confirmas que contrastaste los datos en la fuente oficial y deseas aprobar esta institución?')) return;
                payload.verification_source = source;
            } else if (!window.confirm('¿Confirmas el rechazo? La institución y el solicitante permanecerán desactivados.')) {
                return;
            }

            button.disabled = true;
            try {
                await ApiService.revisarSolicitudInstitucional(applicationId, action === 'approve' ? 'approve' : 'reject', payload);
                await this.cargarSolicitudesInstitucionales();
            } catch (error) {
                button.disabled = false;
                alert(`No se pudo registrar la decisión: ${error.message}`);
            }
        });
    },

    inicializarValidacionDePagos() {
        if (this._ownerPaymentsHooked) return;
        this._ownerPaymentsHooked = true;
        document.getElementById('owner-payments-list')?.addEventListener('click', async (event) => {
            const button = event.target.closest('[data-payment-action]');
            if (!button) return;
            const paymentId = Number(button.closest('[data-owner-payment]')?.dataset.ownerPayment);
            const approve = button.dataset.paymentAction === 'approve';
            const pregunta = approve
                ? '¿Confirmas que el pago fue recibido? El plan se activará de inmediato.'
                : '¿Confirmas el rechazo? El usuario conservará su plan actual.';
            if (!window.confirm(pregunta)) return;
            button.disabled = true;
            try {
                await ApiService.revisarPago(paymentId, approve ? 'approve' : 'reject');
            } catch (error) {
                alert(`No se pudo registrar la decisión: ${error.message}`);
            }
            await this.cargarPagosPorValidar();
        });
    },

    async cargarSolicitudesInstitucionales() {
        const list = document.getElementById('owner-applications-list');
        const feedback = document.getElementById('owner-applications-feedback');
        if (!list || !sessionStorage.getItem('qgeo_owner_token') || sessionStorage.getItem('qgeo_owner_must_change_password') === 'true') return;
        const statusFilter = document.getElementById('owner-application-filter').value;
        feedback.textContent = 'Cargando solicitudes...';
        this.cargarPagosPorValidar();
        try {
            const applications = await ApiService.listarSolicitudesInstitucionales(statusFilter);
            feedback.textContent = `${applications.length} solicitud(es)`;
            if (!applications.length) {
                list.innerHTML = '<p class="text-sm text-slate-400">No hay solicitudes para este filtro.</p>';
                return;
            }
            list.innerHTML = applications.map((application) => {
                const pending = application.status === 'pending';
                return `
                    <article data-owner-application="${application.id}" class="rounded-xl border border-slate-800 bg-slate-900 p-5">
                        <div class="flex items-start justify-between gap-3">
                            <div>
                                <h2 class="text-base font-bold text-white">${this.escaparTexto(application.institution_name)}</h2>
                                <p class="mt-1 text-xs text-slate-400">RUC ${this.escaparTexto(application.ruc)} · ${this.escaparTexto(application.institution_type)}</p>
                            </div>
                            <span class="rounded-md border border-slate-700 px-2 py-1 text-[10px] uppercase text-cyan-200">${this.escaparTexto(application.status)}</span>
                        </div>
                        <dl class="mt-4 grid grid-cols-1 gap-x-4 gap-y-2 text-xs sm:grid-cols-2">
                            <div><dt class="text-slate-500">Región</dt><dd class="text-slate-200">${this.escaparTexto(application.region)}</dd></div>
                            <div><dt class="text-slate-500">Solicitante</dt><dd class="text-slate-200">${this.escaparTexto(application.applicant_username)}</dd></div>
                            <div><dt class="text-slate-500">Contacto</dt><dd class="text-slate-200">${this.escaparTexto(application.contact_name)}</dd></div>
                            <div><dt class="text-slate-500">Teléfono</dt><dd class="text-slate-200">${this.escaparTexto(application.contact_phone)}</dd></div>
                            <div class="sm:col-span-2"><dt class="text-slate-500">Correo institucional</dt><dd class="text-slate-200">${this.escaparTexto(application.official_email)}</dd></div>
                            <div class="sm:col-span-2"><dt class="text-slate-500">Evidencia presentada</dt><dd><a class="break-all text-cyan-300 underline" href="${this.escaparTexto(application.evidence_url)}" target="_blank" rel="noopener noreferrer">Abrir enlace declarado</a></dd></div>
                            <div class="sm:col-span-2"><dt class="text-slate-500">Recibida</dt><dd class="text-slate-200">${this.escaparTexto(this.formatearFecha(application.submitted_at))}</dd></div>
                        </dl>
                        ${pending ? `
                            <div class="mt-4 space-y-3 border-t border-slate-800 pt-4">
                                <label class="block text-xs text-slate-300">Fuente oficial consultada (HTTPS)
                                    <input data-verification-source type="url" placeholder="https://www.gob.pe/..." class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white" />
                                </label>
                                <label class="block text-xs text-slate-300">Observaciones de revisión
                                    <textarea data-review-notes minlength="10" rows="3" placeholder="Qué datos contrastaste y qué resultado obtuviste" class="mt-1 w-full resize-y rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-white"></textarea>
                                </label>
                                <div class="flex justify-end gap-2">
                                    <button type="button" data-admin-action="reject" class="rounded-lg border border-red-800 px-3 py-2 text-xs text-red-300 hover:bg-red-950">Rechazar</button>
                                    <button type="button" data-admin-action="approve" class="rounded-lg bg-emerald-700 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-600">Aprobar institución</button>
                                </div>
                            </div>` : `
                            <div class="mt-4 border-t border-slate-800 pt-3 text-xs text-slate-400">
                                <p>Revisó: ${this.escaparTexto(application.reviewed_by || '—')}</p>
                                <p>Fuente: ${this.escaparTexto(application.verification_source || '—')}</p>
                                <p>Notas: ${this.escaparTexto(application.review_notes || '—')}</p>
                            </div>`}
                    </article>`;
            }).join('');
        } catch (error) {
            feedback.textContent = error.message;
            list.innerHTML = '';
            if (error.status === 401 || error.status === 403) this.cerrarSesionPropietarios();
        }
    },

    inicializarAccesoInstitucional() {
        const boton = document.getElementById('btn-agregar-usuario-institucion');
        if (!boton || this._institucionalHooked) return;
        this._institucionalHooked = true;

        boton.addEventListener('click', async () => {
            const institutionName = this.institucionActual;
            const memberName = document.getElementById('institucion-usuario-nombre')?.value.trim();
            const memberEmail = document.getElementById('institucion-usuario-email')?.value.trim();
            const role = document.getElementById('institucion-rol')?.value || 'operador';

            if (!memberName || !memberEmail) {
                alert('Completa el nombre y el correo del usuario institucional.');
                return;
            }

            try {
                const respuesta = await ApiService.agregarUsuarioInstitucional({
                    institution_name: institutionName,
                    member_name: memberName,
                    member_email: memberEmail,
                    role,
                    total_users: 1,
                });

                const costoTotal = Number(respuesta.monthly_price || 0);
                document.getElementById('institucion-costo-mensual').textContent = `S/${costoTotal.toFixed(0)}`;
                const invitation = document.getElementById('institucion-enlace-invitacion');
                invitation.value = respuesta.invitation_url;
                invitation.classList.remove('hidden');
                alert(`Invitación creada para ${memberEmail}. Comparte el enlace antes de que expire en 48 horas.`);
                this.cargarUsuariosInstitucionales(institutionName);
                this.cargarCuentaInstitucional();
            } catch (error) {
                alert(`No se pudo agregar el usuario institucional: ${error.message}`);
            }
        });

        const contenedor = document.getElementById('miembros-institucion-b2g');
        contenedor?.addEventListener('click', async (event) => {
            const button = event.target.closest('[data-member-action]');
            if (!button) return;
            try {
                const memberCard = button.closest('[data-member-card]');
                const update = button.dataset.memberAction === 'save-role'
                    ? { role: memberCard.querySelector('.member-role').value }
                    : { is_active: button.dataset.memberAction === 'activate' };
                await ApiService.actualizarMiembroInstitucional(Number(button.dataset.memberId), {
                    ...update
                });
                await this.cargarUsuariosInstitucionales(this.institucionActual);
                await this.cargarCuentaInstitucional();
            } catch (error) {
                alert(`No se pudo actualizar el miembro: ${error.message}`);
            }
        });
    },

    async cargarUsuariosInstitucionales(institutionName) {
        const contenedor = document.getElementById('miembros-institucion-b2g');
        if (!contenedor) return;

        try {
            const miembros = await ApiService.listarUsuariosInstitucionales();
            const contador = document.getElementById('contador-miembros-institucion');
            const activos = miembros.filter((miembro) => miembro.is_active);
            if (contador) contador.textContent = String(activos.length);

            if (!miembros || miembros.length === 0) {
                contenedor.innerHTML = '<p class="text-xs text-slate-500">Aún no hay miembros en esta cuenta.</p>';
                return;
            }

            contenedor.innerHTML = miembros.map((miembro) => `
                <div data-member-card class="bg-emerald-950/40 border border-emerald-800 rounded-xl p-2 text-xs text-emerald-200">
                    <div class="flex items-center justify-between gap-2">
                        <span class="font-bold">${this.escaparTexto(miembro.member_name)}</span>
                        <span class="text-[10px] bg-emerald-900/70 text-emerald-200 px-1.5 py-0.5 rounded-full">${this.escaparTexto(miembro.role)}</span>
                    </div>
                    <div class="text-[10px] text-emerald-300/80 mt-1">${this.escaparTexto(miembro.member_email)}</div>
                    <div class="flex items-center justify-between mt-2">
                        <span class="text-[10px] ${miembro.is_active ? 'text-emerald-300' : 'text-slate-400'}">${miembro.is_active ? 'Activo' : 'Desactivado'}</span>
                        <button type="button" data-member-id="${miembro.id}" data-member-action="${miembro.is_active ? 'deactivate' : 'activate'}" class="text-[10px] underline text-slate-200">${miembro.is_active ? 'Desactivar' : 'Reactivar'}</button>
                    </div>
                    <div class="flex gap-1 mt-2">
                        <select class="member-role flex-1 bg-slate-900 border border-slate-700 rounded px-1 py-1 text-[10px]" aria-label="Rol de ${this.escaparTexto(miembro.member_name)}">
                            ${['operador', 'analista', 'coordinador'].map((role) => `<option value="${role}" ${miembro.role === role ? 'selected' : ''}>${role}</option>`).join('')}
                        </select>
                        <button type="button" data-member-id="${miembro.id}" data-member-action="save-role" class="text-[10px] underline text-slate-200">Guardar rol</button>
                    </div>
                </div>
            `).join('');
        } catch (error) {
            contenedor.innerHTML = `<p class="text-xs text-red-400">No se pudo cargar la lista institucional: ${error.message}</p>`;
        }
    },

    escaparTexto(value) {
        const element = document.createElement('span');
        element.textContent = String(value ?? '');
        return element.innerHTML;
    },

    inicializarAceptacionInvitacion() {
        const params = new URLSearchParams(window.location.search);
        const invitationToken = params.get('invite');
        const form = document.getElementById('form-aceptar-invitacion');
        if (!invitationToken || !form) return;
        form.classList.remove('hidden');
        document.getElementById('form-login')?.classList.add('hidden');
        document.getElementById('form-registro')?.classList.add('hidden');
        document.querySelector('.grid.grid-cols-2.bg-slate-950')?.classList.add('hidden');
        form.addEventListener('submit', async (event) => {
            event.preventDefault();
            const feedback = document.getElementById('invitacion-feedback');
            const password = document.getElementById('invitacion-password').value;
            feedback.textContent = 'Validando invitación...';
            try {
                const data = await ApiService.aceptarInvitacionInstitucional({ token: invitationToken, password });
                this.guardarSesion(data);
                params.delete('invite');
                history.replaceState({}, '', `${location.pathname}${params.size ? `?${params}` : ''}`);
                this.iniciarSesionEnUI(data.usuario, data.rol, data.codigo_enlace, data.institucion);
            } catch (error) {
                feedback.textContent = error.message;
                feedback.className = 'text-xs text-center min-h-[1rem] text-red-400';
            }
        });
    },

    guardarSesion(data) {
        localStorage.setItem(CONFIG.STORAGE_KEYS.USER, data.usuario);
        localStorage.setItem(CONFIG.STORAGE_KEYS.ROLE, data.rol);
        localStorage.setItem(CONFIG.STORAGE_KEYS.TOKEN, data.token);
        localStorage.setItem(CONFIG.STORAGE_KEYS.INSTITUTION, data.institucion || 'individual');
        if (data.codigo_enlace) localStorage.setItem(CONFIG.STORAGE_KEYS.CODE, data.codigo_enlace);
    },

    async cargarCuentaInstitucional() {
        if (!this.institucionActual) return;
        try {
            const account = await ApiService.obtenerCuentaInstitucional();
            const nombre = document.getElementById('institucion-nombre');
            if (nombre) nombre.value = account.institution_name;
            const included = document.getElementById('institucion-usuarios-incluidos');
            const extra = document.getElementById('institucion-usuarios-extra');
            const price = document.getElementById('institucion-costo-mensual');
            if (included) included.textContent = String(account.included_users);
            if (extra) extra.textContent = String(account.extra_users);
            if (price) price.textContent = `${account.currency} ${Number(account.monthly_total).toFixed(2)}`;
            const plan = document.getElementById('institucion-plan');
            if (plan) plan.value = account.plan_code;
        } catch (error) {
            console.warn('No se pudo cargar la cuenta institucional:', error.message);
        }
    },

    async guardarPlanInstitucional() {
        const planCode = document.getElementById('institucion-plan')?.value;
        if (!planCode) return;
        try {
            await ApiService.actualizarPlanInstitucional(planCode);
            await this.cargarCuentaInstitucional();
            alert('Plan institucional actualizado.');
        } catch (error) {
            alert(`No se pudo actualizar el plan: ${error.message}`);
        }
    },

    conectarTiempoRealInstitucional() {
        this.socketInstitucional?.close();
        const token = localStorage.getItem(CONFIG.STORAGE_KEYS.TOKEN);
        if (!token || !this.institucionActual || this.rolActual === 'ciudadano') return;
        const apiHost = (ApiService.hostActivo || CONFIG.API_HOSTS[0]).replace(/^http/, 'ws');
        const socket = new WebSocket(`${apiHost}${CONFIG.API_PREFIX}/realtime/ws/alerts`);
        this.socketInstitucional = socket;
        socket.addEventListener('open', () => socket.send(JSON.stringify({ token })));
        socket.addEventListener('message', (event) => {
            try {
                const notification = JSON.parse(event.data);
                if (notification.type === 'alert.created') this.cargarAlertasB2G();
            } catch (error) {
                console.warn('Evento de tiempo real inválido.', error);
            }
        });
        socket.addEventListener('close', () => {
            if (this.socketInstitucional === socket && this.usuarioActual) {
                window.setTimeout(() => this.conectarTiempoRealInstitucional(), 4000);
            }
        });
    },

    // ==========================================
    // PLANES Y PAGOS
    // ==========================================
    NOMBRES_PLAN: { free: 'Free', pro: 'Pro', enterprise: 'Enterprise' },
    NOMBRES_METODO_PAGO: { yape: 'Yape', plin: 'Plin', transferencia: 'Transferencia bancaria' },

    mostrarMensajePlanes(mensaje) {
        const feedback = document.getElementById('planes-feedback');
        if (feedback) feedback.textContent = mensaje;
    },

    inicializarPlanesPago() {
        document.querySelectorAll('.plan-select').forEach((button) => {
            button.addEventListener('click', () => {
                const planCode = button.dataset.plan;

                if (planCode === 'enterprise') {
                    // Enterprise es el plan de las instituciones: se solicita con el registro institucional.
                    this.cambiarTabAuth('registro');
                    this.cambiarModoRegistro('institucional');
                    this.mostrarMensajePlanes('El plan Enterprise es para instituciones públicas: completa el registro como "Institución pública".');
                    return;
                }

                if (this.usuarioActual) {
                    this.contratarPlan(planCode);
                    return;
                }

                if (planCode === 'free') {
                    this.cambiarTabAuth('registro');
                    this.cambiarModoRegistro('familiar');
                    this.mostrarMensajePlanes('El plan Free ya viene incluido: solo crea tu cuenta en el acceso Familiar.');
                    return;
                }

                // Sin sesión no se registra ningún pago: se recuerda el plan y se contrata al iniciar sesión.
                sessionStorage.setItem('qgeo_pending_plan', planCode);
                this.mostrarMensajePlanes(`Inicia sesión o regístrate en el acceso Familiar para activar el plan ${this.NOMBRES_PLAN[planCode] || planCode}.`);
            });
        });
    },

    // Los precios se leen del backend para que la tarjeta, el formulario de pago y el
    // panel del propietario muestren siempre el mismo monto.
    async cargarPreciosPlanes() {
        try {
            const planes = await ApiService.listarPlanes();
            this.planes = Object.fromEntries(planes.map((plan) => [plan.code, plan]));
            document.querySelectorAll('[data-plan-price]').forEach((etiqueta) => {
                const plan = this.planes[etiqueta.dataset.planPrice];
                if (plan) etiqueta.textContent = `S/${Number(plan.price).toFixed(0)}`;
            });
        } catch (err) {
            console.warn('No se pudo cargar el catálogo de planes:', err.message);
        }
    },

    async contratarPlan(planCode) {
        if (planCode === 'free') {
            await this.enviarCheckout({ plan_code: planCode });
            return;
        }
        let datosDePago;
        try {
            datosDePago = await ApiService.obtenerDatosDePago();
            if (!this.planes) await this.cargarPreciosPlanes();
        } catch (err) {
            alert(`No se pudo iniciar la suscripción: ${err.message}`);
            return;
        }
        if (datosDePago.gateway === 'stripe') {
            // Con pasarela configurada no hay formulario propio: el pago se hace en su página.
            await this.enviarCheckout({ plan_code: planCode });
            return;
        }
        this.abrirFormularioPago(planCode, datosDePago);
    },

    // Contratación sin formulario propio: plan gratuito o pago en la página de la pasarela.
    async enviarCheckout(payload) {
        try {
            const respuesta = await ApiService.iniciarCheckoutPlan(payload);
            if (respuesta.checkout_url) {
                this._saliendoAPago = true;
                window.location.href = respuesta.checkout_url;
                return;
            }
            this.agregarLogCiudadano(`💳 ${this.escaparTexto(respuesta.message)}`);
            alert(respuesta.message);
        } catch (err) {
            alert(`No se pudo iniciar la suscripción: ${err.message}`);
        }
        await this.cargarPlanActual();
    },

    abrirFormularioPago(planCode, datosDePago) {
        const plan = (this.planes || {})[planCode];
        this._planEnPago = planCode;
        document.getElementById('modal-pago-titulo').textContent = `Activar plan ${this.NOMBRES_PLAN[planCode] || planCode}`;
        document.getElementById('modal-pago-monto').textContent = plan ? `S/ ${Number(plan.price).toFixed(2)}` : 'S/ --';
        document.getElementById('modal-pago-titular').textContent = datosDePago.account_holder;
        document.getElementById('modal-pago-destinos').innerHTML = datosDePago.methods.map((metodo) =>
            `<li><span class="text-slate-400">${this.escaparTexto(metodo.label)}:</span> <span class="font-mono">${this.escaparTexto(metodo.destination)}</span></li>`
        ).join('');
        document.getElementById('pago-metodo').innerHTML = datosDePago.methods.map((metodo) =>
            `<option value="${this.escaparTexto(metodo.code)}">${this.escaparTexto(metodo.label)}</option>`
        ).join('');
        document.getElementById('pago-referencia').value = '';
        document.getElementById('pago-feedback').textContent = '';
        document.getElementById('modal-pago').classList.remove('hidden');
        document.getElementById('pago-referencia').focus();
    },

    cerrarFormularioPago() {
        this._planEnPago = null;
        document.getElementById('modal-pago')?.classList.add('hidden');
    },

    async enviarPagoReportado(event) {
        event.preventDefault();
        const feedback = document.getElementById('pago-feedback');
        const boton = document.getElementById('pago-enviar');
        const planCode = this._planEnPago;
        if (!planCode) return;
        feedback.textContent = '';
        boton.disabled = true;
        try {
            const payload = {
                plan_code: planCode,
                payment_method: document.getElementById('pago-metodo').value,
                payment_reference: document.getElementById('pago-referencia').value.trim(),
            };
            const respuesta = await ApiService.iniciarCheckoutPlan(payload);
            this.cerrarFormularioPago();
            this.agregarLogCiudadano(`💳 ${this.escaparTexto(respuesta.message)}`);
            alert(respuesta.message);
            await this.cargarPlanActual();
        } catch (err) {
            // El formulario queda abierto para que el usuario corrija el dato.
            feedback.textContent = err.message;
        } finally {
            boton.disabled = false;
        }
    },

    async procesarPlanPendiente() {
        const planCode = sessionStorage.getItem('qgeo_pending_plan');
        if (!planCode) return;
        sessionStorage.removeItem('qgeo_pending_plan');
        this.mostrarMensajePlanes('');
        await this.contratarPlan(planCode);
    },

    // Al volver de la pasarela (?checkout=success&session_id=...) se confirma el pago en el backend.
    async procesarRetornoDePago() {
        const params = new URLSearchParams(window.location.search);
        const estado = params.get('checkout');
        if (!estado) return;
        const sessionId = params.get('session_id');
        ['checkout', 'session_id', 'plan', 'usuario'].forEach((clave) => params.delete(clave));
        history.replaceState({}, '', `${location.pathname}${params.size ? `?${params}` : ''}`);

        if (estado === 'cancel') {
            alert('Pago cancelado. Tu plan no cambió.');
            return;
        }
        if (estado !== 'success' || !sessionId) return;
        try {
            const plan = await ApiService.confirmarCheckout(sessionId);
            alert(plan.pending_plan_code
                ? 'El pago todavía no figura como completado. Tu plan se activará cuando la pasarela lo confirme.'
                : `Pago confirmado. Plan ${this.NOMBRES_PLAN[plan.plan_code] || plan.plan_code} activo.`);
        } catch (err) {
            alert(`No se pudo confirmar el pago: ${err.message}`);
        }
    },

    async cargarPlanActual() {
        const badge = document.getElementById('badge-rol');
        if (!badge || !this.usuarioActual || this.institucionActual !== 'individual') return;
        try {
            const plan = await ApiService.obtenerMiPlan();
            const nombre = this.NOMBRES_PLAN[plan.plan_code] || plan.plan_code;
            const enCurso = plan.pending_plan_code
                ? ` (${this.NOMBRES_PLAN[plan.pending_plan_code] || plan.pending_plan_code} ${plan.pending_status === 'manual_review' ? 'en validación' : 'pendiente de pago'})`
                : '';
            badge.innerText = `B2C - Ciudadano · Plan ${nombre}${enCurso}`;
            // El botón de mejora solo se ofrece a quien está en Free y no tiene un pago en revisión.
            document.getElementById('btn-mejorar-plan')?.classList.toggle(
                'hidden', plan.plan_code !== 'free' || Boolean(plan.pending_plan_code)
            );
        } catch (err) {
            console.warn('No se pudo consultar el plan:', err.message);
        }
    },

    async cargarPagosPorValidar() {
        const list = document.getElementById('owner-payments-list');
        const feedback = document.getElementById('owner-payments-feedback');
        if (!list || !sessionStorage.getItem('qgeo_owner_token')) return;
        try {
            const pagos = await ApiService.listarPagosPorValidar();
            if (feedback) feedback.textContent = `${pagos.length} pago(s) por validar`;
            if (!pagos.length) {
                list.innerHTML = '<p class="text-sm text-slate-400">No hay pagos pendientes de validación.</p>';
                return;
            }
            list.innerHTML = pagos.map((pago) => `
                <article data-owner-payment="${Number(pago.id)}" class="rounded-xl border border-slate-800 bg-slate-900 p-4 text-xs">
                    <div class="flex items-start justify-between gap-3">
                        <div>
                            <h3 class="text-sm font-bold text-white">${this.escaparTexto(pago.usuario)}</h3>
                            <p class="mt-1 text-slate-400">Plan ${this.escaparTexto(this.NOMBRES_PLAN[pago.plan_code] || pago.plan_code)} · ${this.escaparTexto(pago.currency)} ${Number(pago.price).toFixed(2)}</p>
                            <p class="mt-1 text-slate-200">${this.escaparTexto(this.NOMBRES_METODO_PAGO[pago.payment_method] || pago.payment_method || 'Sin método')} · N.º de operación: <span class="font-mono font-semibold">${this.escaparTexto(pago.payment_reference || '—')}</span></p>
                            <p class="mt-1 text-slate-500">Solicitado: ${this.escaparTexto(this.formatearFecha(pago.created_at))}</p>
                        </div>
                        <span class="rounded-md border border-amber-700 px-2 py-1 text-[10px] uppercase text-amber-200">Por validar</span>
                    </div>
                    <div class="mt-3 flex justify-end gap-2">
                        <button type="button" data-payment-action="reject" class="rounded-lg border border-red-800 px-3 py-2 text-xs text-red-300 hover:bg-red-950">Rechazar</button>
                        <button type="button" data-payment-action="approve" class="rounded-lg bg-emerald-700 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-600">Pago recibido: activar plan</button>
                    </div>
                </article>`).join('');
        } catch (error) {
            if (feedback) feedback.textContent = error.message;
            list.innerHTML = '';
        }
    },

    inicializarModuloAntirrobo() {
        const overlay = document.getElementById('anti-theft-overlay');
        if (!overlay || this._antiTheftHooked) return;

        this._antiTheftHooked = true;

        window.addEventListener('beforeunload', (event) => {
            if (this.usuarioActual && !this._saliendoAPago) {
                event.preventDefault();
                event.returnValue = '';
                this.mostrarPantallaSeñuelo(
                    'Apagando sistema...',
                    'Se está ejecutando el protocolo de protección silenciosa.'
                );
                return '';
            }
        });
    },

    mostrarPantallaSeñuelo(titulo, detalle) {
        const overlay = document.getElementById('anti-theft-overlay');
        const title = document.getElementById('anti-theft-title');
        const detail = document.getElementById('anti-theft-detail');

        if (!overlay || !title || !detail) return;
        title.textContent = titulo;
        detail.textContent = detalle;
        overlay.classList.remove('hidden');
        overlay.classList.add('flex');
    },

    ocultarPantallaSeñuelo() {
        const overlay = document.getElementById('anti-theft-overlay');
        if (overlay) {
            overlay.classList.add('hidden');
            overlay.classList.remove('flex');
        }
    },

    async capturarFotoIntruso() {
        const video = document.getElementById('anti-theft-video');
        const canvas = document.getElementById('anti-theft-canvas');

        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            throw new Error('La cámara no está disponible en este navegador.');
        }

        const stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'user' },
            audio: false
        });

        try {
            video.srcObject = stream;
            await video.play();

            const width = video.videoWidth || 640;
            const height = video.videoHeight || 480;
            canvas.width = width;
            canvas.height = height;

            const context = canvas.getContext('2d');
            context.drawImage(video, 0, 0, width, height);
            return canvas.toDataURL('image/jpeg', 0.9);
        } finally {
            stream.getTracks().forEach(track => track.stop());
        }
    },

    async activarModoSeñueloAntirrobo() {
        if (!this.usuarioActual) {
            alert('Debe iniciar sesión para activar la protección antirrobo.');
            return;
        }

        this.mostrarPantallaSeñuelo(
            'Cargando sistema de seguridad...',
            'Se está validando la identidad del usuario y capturando evidencia del intruso.'
        );

        try {
            const fotoBase64 = await this.capturarFotoIntruso();
            const ubicacion = await new Promise((resolve) => {
                if (!navigator.geolocation) {
                    resolve({ lat: CONFIG.DEFAULT_COORDS.lat, lng: CONFIG.DEFAULT_COORDS.lng });
                    return;
                }

                navigator.geolocation.getCurrentPosition(
                    (position) => resolve({
                        lat: position.coords.latitude,
                        lng: position.coords.longitude
                    }),
                    () => resolve({
                        lat: CONFIG.DEFAULT_COORDS.lat,
                        lng: CONFIG.DEFAULT_COORDS.lng
                    }),
                    {
                        enableHighAccuracy: true,
                        timeout: 10000,
                        maximumAge: 0
                    }
                );
            });

            const payload = {
                usuario: this.usuarioActual,
                dispositivo_id: this.usuarioActual,
                latitud: ubicacion.lat,
                longitud: ubicacion.lng,
                foto_base64: fotoBase64,
                correo_destino: `${this.usuarioActual}@georescue.local`
            };

            const data = await ApiService.enviarAlertaSeguridad(payload);
            this.agregarLogCiudadano(`🔒 Alerta antirrobo enviada: #${data.alerta_id} - ${data.mensaje}`);
            this.mostrarPantallaSeñuelo(
                'Alerta enviada con éxito',
                `Se ha notificado al titular y se abrió el mapa interno en ${data.mapa_url}`
            );
        } catch (error) {
            this.agregarLogCiudadano(`❌ Error antirrobo: ${error.message}`);
            this.mostrarPantallaSeñuelo(
                'No se pudo completar la captura',
                `El sistema simuló un apagado seguro, pero la evidencia no pudo enviarse: ${error.message}`
            );
        } finally {
            setTimeout(() => this.ocultarPantallaSeñuelo(), 2600);
        }
    },

    async verificarSaludBackend() {
        const indicador = document.getElementById('indicador-servidor');
        try {
            await ApiService.verificarSalud();
            if (indicador) {
                indicador.className = "w-2 h-2 rounded-full bg-emerald-500 inline-block animate-pulse";
                indicador.title = "Backend FastAPI conectado";
            }
        } catch (e) {
            if (indicador) {
                indicador.className = "w-2 h-2 rounded-full bg-amber-500 inline-block";
                indicador.title = "Backend desconectado o modo local";
            }
        }
    },

    async verificarSesionPrevia() {
        if (sessionStorage.getItem('qgeo_owner_token')) {
            this.cerrarSesion();
            return;
        }
        const flowVersion = this._authFlowVersion;
        const usuarioGuardado = localStorage.getItem(CONFIG.STORAGE_KEYS.USER);
        const rolGuardado = localStorage.getItem(CONFIG.STORAGE_KEYS.ROLE);
        const codigoGuardado = localStorage.getItem(CONFIG.STORAGE_KEYS.CODE);
        const institucionGuardada = localStorage.getItem(CONFIG.STORAGE_KEYS.INSTITUTION);
        const tokenGuardado = localStorage.getItem(CONFIG.STORAGE_KEYS.TOKEN);

        if (usuarioGuardado && rolGuardado && tokenGuardado) {
            try {
                const account = await ApiService.verificarSesion();
                if (flowVersion !== this._authFlowVersion) return;
                localStorage.setItem(CONFIG.STORAGE_KEYS.USER, account.usuario);
                localStorage.setItem(CONFIG.STORAGE_KEYS.ROLE, account.rol);
                localStorage.setItem(CONFIG.STORAGE_KEYS.INSTITUTION, account.institucion || 'individual');
                if (account.codigo_enlace) {
                    localStorage.setItem(CONFIG.STORAGE_KEYS.CODE, account.codigo_enlace);
                }
                this.iniciarSesionEnUI(
                    account.usuario,
                    account.rol,
                    account.codigo_enlace || codigoGuardado,
                    account.institucion || institucionGuardada
                );
            } catch (error) {
                if (flowVersion !== this._authFlowVersion) return;
                this.cerrarSesion();
            }
        } else {
            this.cerrarSesion();
        }
    },

    cambiarTabAuth(tab) {
        const formLogin = document.getElementById('form-login');
        const formRegistro = document.getElementById('form-registro');
        const tabLogin = document.getElementById('tab-login');
        const tabRegistro = document.getElementById('tab-registro');

        if (tab === 'login') {
            formLogin.classList.remove('hidden');
            formRegistro.classList.add('hidden');
            tabLogin.className = "py-2.5 font-semibold text-xs rounded-lg text-white bg-slate-800 transition";
            tabRegistro.className = "py-2.5 font-semibold text-xs rounded-lg text-slate-400 hover:text-white transition";
        } else {
            formLogin.classList.add('hidden');
            formRegistro.classList.remove('hidden');
            tabRegistro.className = "py-2.5 font-semibold text-xs rounded-lg text-white bg-slate-800 transition";
            tabLogin.className = "py-2.5 font-semibold text-xs rounded-lg text-slate-400 hover:text-white transition";
        }
    },

    cambiarModoRegistro(modo) {
        const institucional = modo === 'institucional';
        const familiarButton = document.getElementById('registro-modo-familiar');
        const institutionalButton = document.getElementById('registro-modo-institucional');
        const institutionField = document.getElementById('registro-institucion-campo');
        document.getElementById('registro-modo').value = institucional ? 'institucional' : 'familiar';
        familiarButton.setAttribute('aria-pressed', String(!institucional));
        institutionalButton.setAttribute('aria-pressed', String(institucional));
        familiarButton.className = institucional
            ? 'py-2.5 font-semibold text-xs rounded-lg text-slate-400 hover:text-white transition'
            : 'py-2.5 font-semibold text-xs rounded-lg text-white bg-slate-800 transition';
        institutionalButton.className = institucional
            ? 'py-2.5 font-semibold text-xs rounded-lg text-white bg-slate-800 transition'
            : 'py-2.5 font-semibold text-xs rounded-lg text-slate-400 hover:text-white transition';
        institutionField.classList.toggle('hidden', !institucional);
        [
            'reg-institucion',
            'reg-ruc',
            'reg-tipo-institucion',
            'reg-region-institucion',
            'reg-correo-institucion',
            'reg-contacto-institucion',
            'reg-telefono-institucion',
            'reg-evidencia-institucion',
        ].forEach((id) => {
            document.getElementById(id).required = institucional;
        });
    },

    cambiarModoLogin(modo) {
        const institucional = modo === 'institucional';
        const botonFamiliar = document.getElementById('login-modo-familiar');
        const botonInstitucional = document.getElementById('login-modo-institucional');
        document.getElementById('login-modo').value = institucional ? 'institucional' : 'familiar';
        botonFamiliar.setAttribute('aria-pressed', String(!institucional));
        botonInstitucional.setAttribute('aria-pressed', String(institucional));
        botonFamiliar.className = institucional
            ? 'py-2.5 font-semibold text-xs rounded-lg text-slate-400 hover:text-white transition'
            : 'py-2.5 font-semibold text-xs rounded-lg text-white bg-slate-800 transition';
        botonInstitucional.className = institucional
            ? 'py-2.5 font-semibold text-xs rounded-lg text-white bg-slate-800 transition'
            : 'py-2.5 font-semibold text-xs rounded-lg text-slate-400 hover:text-white transition';
        document.getElementById('login-modo-descripcion').textContent = institucional
            ? 'Acceso del personal autorizado a la cuenta de su institución.'
            : 'Acceso ciudadano y red familiar.';
        document.getElementById('login-usuario-label').textContent = institucional
            ? 'Correo o usuario institucional'
            : 'Usuario familiar';
        document.getElementById('login-usuario').placeholder = institucional
            ? 'Correo asignado por la institución'
            : 'Ej. standy_cerna';
        document.getElementById('login-feedback').textContent = '';
    },

    async manejarLogin(event) {
        event.preventDefault();
        this._authFlowVersion += 1;
        const usuario = document.getElementById('login-usuario').value.trim();
        const password = document.getElementById('login-password').value.trim();
        const feedback = document.getElementById('login-feedback');

        feedback.innerHTML = `<span class="text-slate-400">Verificando en base de datos...</span>`;

        try {
            const modo = document.getElementById('login-modo').value;
            const data = await ApiService.loginUsuario({ usuario, password, modo });
            feedback.innerHTML = `<span class="text-emerald-400">✅ Acceso autorizado</span>`;
            
            localStorage.setItem(CONFIG.STORAGE_KEYS.USER, data.usuario);
            localStorage.setItem(CONFIG.STORAGE_KEYS.ROLE, data.rol);
            localStorage.setItem(CONFIG.STORAGE_KEYS.TOKEN, data.token);
            localStorage.setItem(CONFIG.STORAGE_KEYS.INSTITUTION, data.institucion || 'individual');
            if (data.codigo_enlace) {
                localStorage.setItem(CONFIG.STORAGE_KEYS.CODE, data.codigo_enlace);
            }

            setTimeout(() => {
                this.iniciarSesionEnUI(data.usuario, data.rol, data.codigo_enlace, data.institucion);
            }, 400);
        } catch (err) {
            feedback.innerHTML = `<span class="text-red-400">❌ ${this.escaparTexto(err.message)}</span>`;
        }
    },

    async manejarRegistro(event) {
        event.preventDefault();
        this._authFlowVersion += 1;
        const flowVersion = this._authFlowVersion;
        const usuario = document.getElementById('reg-usuario').value.trim();
        const password = document.getElementById('reg-password').value.trim();
        const modo = document.getElementById('registro-modo').value;
        const nombreInstitucion = document.getElementById('reg-institucion').value.trim();
        const feedback = document.getElementById('reg-feedback');

        feedback.innerHTML = `<span class="text-slate-400">Registrando con hash seguro...</span>`;

        try {
            const data = await ApiService.registrarUsuario({
                usuario,
                password,
                modo,
                nombre_institucion: modo === 'institucional' ? nombreInstitucion : null,
                ruc_institucion: modo === 'institucional' ? document.getElementById('reg-ruc').value.trim() : null,
                tipo_institucion: modo === 'institucional' ? document.getElementById('reg-tipo-institucion').value.trim() : null,
                region_institucion: modo === 'institucional' ? document.getElementById('reg-region-institucion').value.trim() : null,
                correo_institucional: modo === 'institucional' ? document.getElementById('reg-correo-institucion').value.trim() : null,
                contacto_institucional: modo === 'institucional' ? document.getElementById('reg-contacto-institucion').value.trim() : null,
                telefono_institucional: modo === 'institucional' ? document.getElementById('reg-telefono-institucion').value.trim() : null,
                evidencia_institucional_url: modo === 'institucional' ? document.getElementById('reg-evidencia-institucion').value.trim() : null
            });
            if (flowVersion !== this._authFlowVersion) return;
            if (modo === 'institucional') {
                this.cerrarSesion();
                this.cambiarTabAuth('login');
                this.cambiarModoLogin('institucional');
                document.getElementById('login-usuario').value = usuario;
                document.getElementById('login-feedback').innerHTML = `<span class="text-amber-300">${this.escaparTexto(data.mensaje)}</span>`;
                return;
            }
            feedback.innerHTML = `<span class="text-emerald-400">✅ Registrado con éxito. Tu código es <b>${data.codigo_enlace}</b></span>`;
            
            setTimeout(() => {
                this.cambiarTabAuth('login');
                document.getElementById('login-usuario').value = usuario;
                feedback.innerHTML = '';
            }, 2500);
        } catch (err) {
            feedback.innerHTML = `<span class="text-red-400">❌ ${this.escaparTexto(err.message)}</span>`;
        }
    },

    iniciarSesionEnUI(usuario, rol, codigoEnlace, institucion = 'individual') {
        this.usuarioActual = usuario;
        this.rolActual = String(rol || 'ciudadano').toLowerCase();
        this.institucionActual = institucion || 'individual';

        document.getElementById('pantalla-auth').classList.add('hidden');
        document.getElementById('pantalla-dashboard').classList.remove('hidden');
        document.getElementById('lbl-usuario').innerText = usuario;
        
        const badgeRol = document.getElementById('badge-rol');
        const esInstitucional = this.rolActual !== 'ciudadano' && this.institucionActual !== 'individual';
        badgeRol.innerText = esInstitucional ? `Institucional - ${this.rolActual}` : 'B2C - Ciudadano';

        if (esInstitucional) {
            document.getElementById('b2g-institucion').innerText = this.institucionActual;
            this.configurarVistaB2G();
            document.getElementById('institucion-nombre').value = this.institucionActual;
            this.cargarCuentaInstitucional();
            this.cargarUsuariosInstitucionales(this.institucionActual);
            this.conectarTiempoRealInstitucional();
            sessionStorage.removeItem('qgeo_pending_plan');
        } else {
            this.socketInstitucional?.close();
            this.configurarVistaCiudadano(codigoEnlace);
            this.procesarRetornoDePago()
                .then(() => this.procesarPlanPendiente())
                .then(() => this.cargarPlanActual());
        }
    },

    cerrarSesion() {
        this._authFlowVersion += 1;
        localStorage.removeItem(CONFIG.STORAGE_KEYS.USER);
        localStorage.removeItem(CONFIG.STORAGE_KEYS.ROLE);
        localStorage.removeItem(CONFIG.STORAGE_KEYS.CODE);
        localStorage.removeItem(CONFIG.STORAGE_KEYS.TOKEN);
        localStorage.removeItem(CONFIG.STORAGE_KEYS.INSTITUTION);

        clearInterval(this.timerCuentaRegresiva);
        this.usuarioActual = null;
        this.rolActual = null;
        this.institucionActual = null;
        this.socketInstitucional?.close();
        this.socketInstitucional = null;

        this.cerrarFormularioPago();
        document.getElementById('btn-mejorar-plan')?.classList.add('hidden');
        document.getElementById('pantalla-dashboard').classList.add('hidden');
        document.getElementById('pantalla-auth').classList.remove('hidden');
        document.getElementById('login-password').value = '';
    },

    // ==========================================
    // SECCIÓN B2C: CIUDADANO, PRIVACIDAD & SISMO
    // ==========================================
    configurarVistaCiudadano(codigoEnlace) {
        document.getElementById('vista-ciudadano').classList.remove('hidden');
        document.getElementById('vista-institucion').classList.add('hidden');

        if (codigoEnlace) {
            document.getElementById('codigo-enlace-lbl').innerText = `Mi Código: ${codigoEnlace}`;
        }

        this.inicializarMapaCiudadano();
        this.cargarFamiliares();
    },

    inicializarMapaCiudadano() {
        if (!this.mapaCiudadano) {
            setTimeout(() => {
                const { lat, lng } = CONFIG.DEFAULT_COORDS;
                this.mapaCiudadano = L.map('mapa-ciudadano').setView([lat, lng], 14);
                L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                    maxZoom: 19,
                    attribution: '© OpenStreetMap - QuantumGeoRescue'
                }).addTo(this.mapaCiudadano);
            }, 300);
        } else {
            setTimeout(() => this.mapaCiudadano.invalidateSize(), 300);
        }
    },

    async cargarFamiliares() {
        const contenedor = document.getElementById('lista-familiares');
        if (!contenedor || !this.usuarioActual) return;
        contenedor.innerHTML = `<div class="text-xs text-slate-500">Cargando vínculos consentidos...</div>`;

        try {
            const familiares = await ApiService.listarFamiliares(this.usuarioActual);
            if (!familiares || familiares.length === 0) {
                contenedor.innerHTML = `<div class="text-xs text-slate-500 italic p-2 bg-slate-950 rounded-xl border border-slate-800">No hay vínculos aceptados. La otra cuenta debe aceptar la invitación.</div>`;
            } else {
                contenedor.innerHTML = familiares.map(f => `
                    <div class="flex justify-between items-center bg-slate-950 p-2.5 rounded-xl border border-slate-800 text-xs">
                        <div>
                            <div class="font-bold text-slate-200">${this.escaparHtml(f.nombre)}</div>
                            <div class="text-[10px] text-slate-400">${this.escaparHtml(f.parentesco)} · Vínculo consentido</div>
                        </div>
                        <button type="button" onclick="App.revocarVinculoFamiliar(${Number(f.id)})" class="text-[10px] text-red-300 underline">Revocar</button>
                    </div>
                `).join('');
            }

            await Promise.all([
                this.cargarInvitacionesFamiliares(),
                this.cargarBuzonFamiliar()
            ]);
        } catch (e) {
            contenedor.innerHTML = `<div class="text-xs text-red-400">Error al cargar familiares.</div>`;
        }
    },

    async agregarFamiliar(event) {
        event.preventDefault();
        const usuarioInvitado = document.getElementById('fam-usuario').value.trim();
        const parentesco = document.getElementById('fam-parentesco').value.trim();

        try {
            const invitacion = await ApiService.registrarFamiliar({
                usuario_invitado: usuarioInvitado,
                parentesco
            });
            document.getElementById('fam-usuario').value = '';
            document.getElementById('fam-parentesco').value = '';
            this.agregarLogCiudadano(`Invitación familiar #${invitacion.id}: ${invitacion.estado}. Aún no existe vínculo ni se comparte ubicación.`);
            await this.cargarFamiliares();
        } catch (err) {
            alert("No se pudo crear la invitación: " + err.message);
        }
    },

    escaparHtml(valor) {
        return String(valor ?? '').replace(/[&<>"']/g, caracter => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        })[caracter]);
    },

    async cargarInvitacionesFamiliares() {
        const contenedor = document.getElementById('invitaciones-familiares');
        if (!contenedor) return;
        const invitaciones = await ApiService.listarInvitacionesFamiliares();
        if (!invitaciones.length) {
            contenedor.innerHTML = '';
            return;
        }
        contenedor.innerHTML = invitaciones.map(inv => `
            <div class="rounded-xl border border-amber-800/60 bg-amber-950/30 p-3 text-xs">
                <div class="text-slate-200">${this.escaparHtml(inv.invitante_usuario)} te invita como ${this.escaparHtml(inv.parentesco)}.</div>
                <div class="mt-2 flex gap-2">
                    <button type="button" onclick="App.responderInvitacionFamiliar(${Number(inv.id)}, true)" class="rounded bg-emerald-700 px-3 py-1.5 font-bold text-white">Aceptar y consentir</button>
                    <button type="button" onclick="App.responderInvitacionFamiliar(${Number(inv.id)}, false)" class="rounded bg-slate-700 px-3 py-1.5 text-white">Rechazar</button>
                </div>
            </div>
        `).join('');
    },

    async responderInvitacionFamiliar(id, aceptar) {
        try {
            await ApiService.responderInvitacionFamiliar(id, aceptar);
            await this.cargarFamiliares();
        } catch (error) {
            alert(`No se pudo responder la invitación: ${error.message}`);
        }
    },

    async revocarVinculoFamiliar(id) {
        try {
            await ApiService.revocarVinculoFamiliar(id);
            await this.cargarFamiliares();
        } catch (error) {
            alert(`No se pudo revocar el vínculo: ${error.message}`);
        }
    },

    async cargarBuzonFamiliar() {
        const contenedor = document.getElementById('buzon-alertas-familiares');
        if (!contenedor) return;
        const alertas = await ApiService.listarBuzonFamiliar();
        if (!alertas.length) {
            contenedor.innerHTML = '<p class="text-xs text-slate-500">No hay alertas disponibles en tu buzón.</p>';
            return;
        }
        contenedor.innerHTML = alertas.map(alerta => {
            const posicion = alerta.latitud === null || alerta.longitud === null
                ? 'Ubicación no disponible'
                : `Ubicación durante la alerta: ${Number(alerta.latitud).toFixed(4)}, ${Number(alerta.longitud).toFixed(4)}`;
            return `<article class="rounded-xl border border-red-900/70 bg-slate-950 p-3 text-xs">
                <div class="font-bold text-red-300">Alerta #${Number(alerta.id)} · ${this.escaparHtml(alerta.tipo_emergencia)}</div>
                <div class="mt-1 text-slate-300">Disponible en el buzón; lectura o atención no confirmadas.</div>
                <div class="mt-1 text-slate-400">${this.escaparHtml(posicion)}</div>
            </article>`;
        }).join('');
    },

    simularSismo() {
        const estadoSensor = document.getElementById('estado-sensor');
        const cajaConteo = document.getElementById('caja-conteo');
        const lblSegundos = document.getElementById('lbl-segundos');

        estadoSensor.innerText = "⚠️ ¡Movimiento inercial violento detectado (Magnitud 6.8)!";
        estadoSensor.className = "text-xs text-red-400 font-bold animate-pulse";
        cajaConteo.classList.remove('hidden');

        this.segundosRestantes = 10;
        lblSegundos.innerText = this.segundosRestantes;

        clearInterval(this.timerCuentaRegresiva);
        this.timerCuentaRegresiva = setInterval(() => {
            this.segundosRestantes--;
            lblSegundos.innerText = this.segundosRestantes;

            if (this.segundosRestantes <= 0) {
                clearInterval(this.timerCuentaRegresiva);
                cajaConteo.classList.add('hidden');
                estadoSensor.innerText = "🚨 Alerta Zero-Touch despachada: Inconsciencia/Sin respuesta.";
                estadoSensor.className = "text-xs text-red-500 font-bold";
                this.ejecutarDespachoAlerta("Alerta Sísmica Inercial", 5);
            }
        }, 1000);
    },

    confirmarEstoyBien() {
        clearInterval(this.timerCuentaRegresiva);
        document.getElementById('caja-conteo').classList.add('hidden');
        const estadoSensor = document.getElementById('estado-sensor');
        estadoSensor.innerText = "✅ Movimiento cancelado. El usuario confirmó encontrarse a salvo.";
        estadoSensor.className = "text-xs text-emerald-400 font-medium";

        this.agregarLogCiudadano("Usuario reportó 'Estoy Bien'. Se evitó el despacho de rescate.");
    },

    obtenerUbicacionReal(callback, mensaje = 'Obteniendo ubicación real...') {
        const indicador = document.getElementById('estado-panic-silencioso');
        if (indicador) {
            indicador.innerHTML = mensaje;
            indicador.className = 'text-[11px] text-amber-300 bg-slate-950 border border-amber-800 rounded-xl p-2';
        }

        if (!navigator.geolocation) {
            callback({
                lat: null,
                lng: null,
                fallback: true
            });
            return;
        }

        navigator.geolocation.getCurrentPosition((position) => {
            callback({
                lat: position.coords.latitude,
                lng: position.coords.longitude,
                fallback: false
            });
        }, () => {
            callback({
                lat: null,
                lng: null,
                fallback: true
            });
        }, {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 0
        });
    },

    async activarPanicSilencioso(detectadoPorVoz = false, fraseDetectada = '') {
        const latLng = await new Promise((resolve) => {
            this.obtenerUbicacionReal((resultado) => resolve(resultado), detectadoPorVoz ? '⚠️ Amenaza detectada por voz. Obteniendo ubicación real...' : '📍 Obteniendo ubicación actual para protocolo silencioso...');
        });

        const tipo = detectadoPorVoz ? 'ROBO_ASALTO_COACCION (voz)' : 'ROBO_ASALTO_COACCION (manual)';
        this.geolocalizacionActual = latLng;

        try {
            const payload = {
                client_alert_id: await ApiService.obtenerClientAlertId(),
                usuario: this.usuarioActual,
                dispositivo_id: this.usuarioActual,
                tipo_amenaza: detectadoPorVoz ? 'coaccion_voz' : 'panic_silencioso',
                descripcion: detectadoPorVoz ? `Frase detectada: "${fraseDetectada}"` : 'Activación manual segura de pánico silencioso.',
                amenaza_detectada: true,
                activar_panic_silencioso: true,
                nivel_gravedad: 5,
                latitud: latLng.lat,
                longitud: latLng.lng,
                timestamp_dispositivo: new Date().toISOString()
            };
            const data = await ApiService.alertaCoaccion(payload);
            document.getElementById('coords-ciudadano').innerText = latLng.lat === null || latLng.lng === null
                ? 'Ubicación no disponible'
                : `Lat: ${latLng.lat.toFixed(4)}, Lng: ${latLng.lng.toFixed(4)}`;

            const indicador = document.getElementById('estado-panic-silencioso');
            if (indicador) {
                indicador.innerHTML = `Alerta #${data.alerta_id} registrada. No hay institución confirmada para esta ubicación.${latLng.fallback ? ' No se obtuvo ubicación; no se usó una ubicación de reemplazo.' : ' Ubicación capturada durante la alerta.'}`;
                indicador.className = 'text-[11px] text-red-300 bg-red-950 border border-red-800 rounded-xl p-2';
            }

            this.agregarLogCiudadano(`Alerta #${data.alerta_id} guardada en el servidor como ${tipo}. No hay confirmación de despacho institucional.`);

            if (this.mapaCiudadano && latLng.lat !== null && latLng.lng !== null) {
                if (this.marcadorCiudadano) this.mapaCiudadano.removeLayer(this.marcadorCiudadano);
                this.marcadorCiudadano = L.marker([latLng.lat, latLng.lng], {
                    icon: L.divIcon({
                        html: '<div style="background:#a855f7;border:2px solid white;border-radius:999px;width:14px;height:14px;box-shadow:0 0 12px rgba(168,85,247,.9);"></div>',
                        className: '',
                        iconSize: [14, 14]
                    })
                }).addTo(this.mapaCiudadano)
                    .bindPopup(`<b>🚨 Pánico Silencioso</b><br>Tipo: Robo/Asalto/Coacción<br>PNP priorizada`)
                    .openPopup();
                this.mapaCiudadano.setView([latLng.lat, latLng.lng], 15);
            }

            if (this.mapaB2G) {
                this.cargarAlertasB2G();
            }
        } catch (err) {
            const indicador = document.getElementById('estado-panic-silencioso');
            if (indicador) {
                indicador.innerHTML = err.alertaLocalGuardada
                    ? 'Sin confirmación del servidor. La alerta quedó guardada en este dispositivo para reintento; llama a un número visible en SOS si necesitas respuesta inmediata.'
                    : `❌ No se pudo guardar la alerta SOS: ${err.message}`;
                indicador.className = 'text-[11px] text-red-300 bg-red-950 border border-red-800 rounded-xl p-2';
            }
            this.agregarLogCiudadano(`❌ Error al activar pánico silencioso: ${err.message}`);
        }
    },

    dispararAlertaManual() {
        this.ejecutarDespachoAlerta("Alerta SOS Manual", 4);
    },

    async ejecutarDespachoAlerta(tipoEmergencia, nivelGravedad) {
        const ubicacion = await new Promise((resolve) => {
            this.obtenerUbicacionReal(resolve, 'SOS activo: obteniendo ubicación actual...');
        });
        const lat = ubicacion.lat;
        const lng = ubicacion.lng;

        document.getElementById('coords-ciudadano').innerText = lat === null || lng === null
            ? 'Ubicación no disponible'
            : `Lat: ${lat.toFixed(4)}, Lng: ${lng.toFixed(4)}`;
        
        // Actualizar radar a Modo Emergencia Revelada
        const radarBadge = document.getElementById('radar-badge');
        radarBadge.innerText = "🚨 Ubicación Revelada (Emergencia Activa)";
        radarBadge.className = "text-[10px] font-semibold bg-red-950 text-red-400 border border-red-800 px-2.5 py-1 rounded-lg animate-pulse";

        this.agregarLogCiudadano(`Despachando ${tipoEmergencia} (Gravedad: ${nivelGravedad}) hacia PostGIS...`);

        try {
            const data = await ApiService.despacharAlerta({
                client_alert_id: await ApiService.obtenerClientAlertId(),
                usuario: this.usuarioActual,
                dispositivo_id: this.usuarioActual,
                tipo_emergencia: tipoEmergencia,
                nivel_gravedad: nivelGravedad,
                latitud: lat,
                longitud: lng,
                timestamp_dispositivo: new Date().toISOString()
            });

            this.agregarLogCiudadano(`Alerta #${data.alerta_id} guardada en el servidor. Estado: ${data.estado}.`);
            this.agregarLogCiudadano('No hay confirmación de institución ni de recepción familiar.');

            // Mostrar transmisión satelital a familiares con enlaces GPS
            const cajaFamiliar = document.getElementById('caja-alerta-familiar');
            const detalleFamiliar = document.getElementById('detalle-familiares-sos');
            const btnWa = document.getElementById('btn-compartir-wa');

            if (cajaFamiliar && detalleFamiliar) {
                cajaFamiliar.classList.remove('hidden');
                if (data.notificacion_familiar && data.notificacion_familiar.detalles && data.notificacion_familiar.detalles.length > 0) {
                    detalleFamiliar.innerHTML = data.notificacion_familiar.detalles.map(d => `
                        <div class="flex justify-between items-center py-1 border-b border-slate-800 last:border-0">
                            <div>
                                <span class="font-bold text-white">${d.nombre} (${d.parentesco})</span>
                                <span class="block text-[10px] text-emerald-400">✓ Ubicación GPS enviada</span>
                            </div>
                            <a href="${d.enlace_ubicacion}" target="_blank" class="text-blue-400 hover:text-blue-300 text-[10px] underline font-semibold">
                                📍 Abrir Mapa
                            </a>
                        </div>
                    `).join('');
                } else {
                    detalleFamiliar.innerHTML = `
                        <div class="text-amber-400 text-[10px]">
                            ⚠️ La alerta quedó guardada. No hay familiares con consentimiento ni institución con cobertura confirmada.
                        </div>
                    `;
                }

                if (btnWa && data.notificacion_familiar && data.notificacion_familiar.enlace_compartir_whatsapp) {
                    btnWa.href = data.notificacion_familiar.enlace_compartir_whatsapp;
                }
            }

            // Actualizar Marcador en el Mapa
            if (this.mapaCiudadano && lat !== null && lng !== null) {
                if (this.marcadorCiudadano) this.mapaCiudadano.removeLayer(this.marcadorCiudadano);
                this.marcadorCiudadano = L.marker([lat, lng])
                    .addTo(this.mapaCiudadano)
                    .bindPopup(`<b>🚨 SOS EN CURSO</b><br>ID: #${data.alerta_id}<br>${tipoEmergencia}`)
                    .openPopup();
                this.mapaCiudadano.setView([lat, lng], 15);
            }
        } catch (err) {
            if (err.alertaLocalGuardada) {
                this.agregarLogCiudadano('Sin confirmación del servidor. SOS guardado en este dispositivo y pendiente de reintento; usa los teléfonos oficiales visibles arriba si necesitas respuesta inmediata.');
            } else {
                this.agregarLogCiudadano(`❌ No se pudo guardar la alerta SOS: ${err.message}`);
            }
        }
    },

    agregarLogCiudadano(mensaje) {
        const log = document.getElementById('log-ciudadano');
        if (!log) return;
        const hora = new Date().toLocaleTimeString();
        log.innerHTML += `<div><span class="text-slate-500">[${hora}]</span> ${mensaje}</div>`;
        log.scrollTop = log.scrollHeight;
    },

    // ==========================================
    // SECCIÓN B2G: COMANDO INSTITUCIONAL & RUTAS
    // ==========================================
    configurarVistaB2G() {
        document.getElementById('vista-institucion').classList.remove('hidden');
        document.getElementById('vista-ciudadano').classList.add('hidden');

        this.inicializarMapaB2G();
        this.cargarAlertasB2G();
    },

    inicializarMapaB2G() {
        if (!this.mapaB2G) {
            setTimeout(() => {
                const { lat, lng } = CONFIG.DEFAULT_COORDS;
                this.mapaB2G = L.map('mapa-b2g').setView([lat, lng], 13);
                L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                    maxZoom: 19,
                    attribution: '© OpenStreetMap - QuantumGeoRescue B2G'
                }).addTo(this.mapaB2G);
            }, 300);
        } else {
            setTimeout(() => this.mapaB2G.invalidateSize(), 300);
        }
    },

    async cargarAlertasB2G() {
        const contenedor = document.getElementById('lista-alertas-b2g');
        const contenedorAtendidos = document.getElementById('personas-atendidas-b2g');
        contenedor.innerHTML = `<div class="text-xs text-slate-400">Consultando PostGIS...</div>`;

        try {
            const alertas = await ApiService.obtenerAlertasActivas();
            this.alertasB2G = (alertas || []).map(a => ({ ...a, id: Number(a.id) }));

            document.getElementById('b2g-metrica-alertas').innerText = this.alertasB2G.length;

            if (!this.alertasB2G || this.alertasB2G.length === 0) {
                contenedor.innerHTML = `<div class="text-xs text-slate-500 italic p-3 bg-slate-950 rounded-xl border border-slate-800">No hay alertas registradas en el sistema.</div>`;
                contenedorAtendidos.innerHTML = `<p class="text-xs text-slate-500">No hay personas atendidas aún.</p>`;
                document.getElementById('contador-personas-atendidas').innerText = '0';
                return;
            }

            const atendidos = this.alertasB2G.filter(a => a.estado === 'ATENDIDA');
            const activos = this.alertasB2G.filter(a => a.estado !== 'ATENDIDA');

            const personasAtendidas = [...new Map(atendidos.map(a => {
                const nombreUsuario = (a.usuario || a.dispositivo_id || 'Usuario no identificado');
                return [String(nombreUsuario).toLowerCase(), {
                    nombre: nombreUsuario,
                    total: 1,
                    alertas: [a.id]
                }];
            })).values()];

            document.getElementById('contador-personas-atendidas').innerText = String(personasAtendidas.length);
            contenedorAtendidos.innerHTML = personasAtendidas.length
                ? personasAtendidas.map(item => `
                    <div class="bg-emerald-950/40 border border-emerald-800 rounded-xl p-2 text-xs text-emerald-200">
                        <div class="font-bold">${item.nombre}</div>
                        <div class="text-[10px] text-emerald-300/80">Incidentes: ${item.alertas.length}</div>
                    </div>
                `).join('')
                : '<p class="text-xs text-slate-500">No hay personas atendidas aún.</p>';

            if (this.mapaB2G) {
                this.marcadoresB2G.forEach(m => this.mapaB2G.removeLayer(m));
            }
            this.marcadoresB2G = [];

            const renderCard = (a) => {
                const esCoaccion = a.tipo_emergencia === 'ROBO_ASALTO_COACCION';
                const atendida = a.estado === 'ATENDIDA';
                const estiloEstado = atendida ? 'bg-emerald-950 text-emerald-300 border-emerald-800' : esCoaccion ? 'bg-violet-950 text-violet-300 border-violet-800' : 'bg-red-950 text-red-400 border-red-800';

                if (this.mapaB2G && Number.isFinite(a.latitud) && Number.isFinite(a.longitud)) {
                    const color = atendida ? '#10b981' : esCoaccion ? '#a855f7' : '#ef4444';
                    const m = L.marker([a.latitud, a.longitud], {
                        icon: L.divIcon({
                            html: `<div style="background:${color};border:2px solid white;border-radius:999px;width:14px;height:14px;box-shadow:0 0 12px ${color};"></div>`,
                            className: '',
                            iconSize: [14, 14]
                        })
                    }).addTo(this.mapaB2G)
                        .bindPopup(`
                            <b>${esCoaccion ? '🚨' : '⚠️'} Alerta #${a.id}</b><br>
                            Tipo: ${a.tipo_emergencia}<br>
                            Usuario: ${a.usuario || a.dispositivo_id}<br>
                            Gravedad: ${a.nivel_gravedad}/5<br>
                            Estado: ${a.estado}<br>
                            Confirmación: ${a.estado_confirmacion}
                        `);
                    this.marcadoresB2G.push(m);
                }

                return `
                    <article class="bg-slate-950 border ${atendida ? 'border-emerald-700/80 opacity-80' : esCoaccion ? 'border-violet-700/80' : 'border-slate-800/80'} p-3 rounded-xl text-xs transition">
                        <div class="flex items-start justify-between gap-2">
                            <div class="min-w-0">
                                <div class="flex items-center gap-2">
                                    <span class="w-2 h-2 rounded-full ${atendida ? 'bg-emerald-500' : 'bg-amber-400'} flex-shrink-0" aria-hidden="true"></span>
                                    <span class="font-bold ${esCoaccion ? 'text-violet-400' : 'text-red-400'} truncate">#${a.id} • ${a.tipo_emergencia}</span>
                                </div>
                                <div class="mt-1 text-slate-400 text-[10px]">Usuario: <span class="text-slate-200">${a.usuario || a.dispositivo_id}</span></div>
                            </div>
                            <span class="${estiloEstado} px-2 py-0.5 rounded text-[10px] border whitespace-nowrap">${a.estado}</span>
                        </div>

                        <div class="mt-2 flex items-center justify-between gap-2 text-[10px] text-slate-400">
                            <span>Coordenadas: ${Number.isFinite(a.latitud) && Number.isFinite(a.longitud) ? `${a.latitud.toFixed(4)}, ${a.longitud.toFixed(4)}` : 'No proporcionadas'}</span>
                            <span class="${esCoaccion ? 'text-violet-400' : 'text-amber-400'}">${esCoaccion ? 'Coacción' : 'Gravedad: ' + a.nivel_gravedad}</span>
                        </div>

                        <div class="mt-2 flex items-center justify-between gap-2 text-[10px] text-slate-500">
                            <span>Confirmación del usuario: <b class="text-slate-300">${a.estado_confirmacion}</b></span>
                        </div>
                    </article>
                `;
            };

            contenedor.innerHTML = `
                <div class="space-y-4">
                    <div class="space-y-2">
                        <div class="flex items-center justify-between text-[10px] uppercase tracking-wider text-slate-400">
                            <span>Activos</span>
                            <span>${activos.length}</span>
                        </div>
                        ${activos.length
                            ? activos.map(renderCard).join('')
                            : '<div class="text-xs text-slate-500 italic p-3 bg-slate-950 rounded-xl border border-slate-800">Sin incidentes activos.</div>'}
                    </div>

                    <div class="border-t border-slate-800 pt-3 space-y-2">
                        <div class="flex items-center justify-between text-[10px] uppercase tracking-wider text-slate-400">
                            <span>Atendidos</span>
                            <span>${atendidos.length}</span>
                        </div>
                        ${atendidos.length
                            ? atendidos.map(renderCard).join('')
                            : '<div class="text-xs text-slate-500 italic p-3 bg-slate-950 rounded-xl border border-slate-800">No hay incidentes atendidos aún.</div>'}
                    </div>
                </div>
            `;

        } catch (err) {
            contenedor.innerHTML = `<div class="text-xs text-red-400">Error al consultar alertas: ${err.message}</div>`;
        }
    },

    async calcularRutaRescateB2G(destLat, destLng, alertaId) {
        document.getElementById('ruta-estado').innerText =
            `No se puede calcular una ruta para la alerta #${alertaId}: proveedor no configurado.`;
        document.getElementById('ruta-tiempo').innerText = 'ETA no disponible';
    }
};

document.addEventListener("DOMContentLoaded", () => {
    App.init();
});