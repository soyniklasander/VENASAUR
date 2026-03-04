/**
 * OSIPTEL Checa tus Líneas - Frontend Application
 */

(function () {
    'use strict';

    // ── DOM References ──
    const rootFormContainer = document.getElementById('searchCard');
    const form = document.getElementById('consultaForm');
    const formMultiple = document.getElementById('consultaFormMultiple');
    const tipoDoc = document.getElementById('tipoDocumento');
    const numDoc = document.getElementById('numeroDocumento');
    const loaderContainer = document.getElementById('loaderContainer');
    const resultsSection = document.getElementById('resultsSection');
    const resultsBody = document.getElementById('resultsBody');
    const resultsBadge = document.getElementById('resultsBadge');
    const errorBox = document.getElementById('errorBox');
    const errorText = document.getElementById('errorText');
    const infoBox = document.getElementById('infoBox');
    const infoText = document.getElementById('infoText');
    const btnNewQuery = document.getElementById('btnNewQuery');
    const btnExportXlsx = document.getElementById('btnExportXlsx');
    const btnSubmitMultiple = document.getElementById('btnSubmitMultiple');
    const btnStopMultiple = document.getElementById('btnStopMultiple');

    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');

    let globalFoundLineas = []; // Defines all lineas found in the session
    let cancelMultipleQuery = false;


    // Loading steps
    const steps = [
        document.getElementById('step1'),
        document.getElementById('step2'),
        document.getElementById('step3'),
    ];

    // ── Document validation rules ──
    const DOC_RULES = {
        '1': { name: 'DNI', length: 8, pattern: /^\d{8}$/, placeholder: 'Ej: 12345678' },
        '2': { name: 'RUC', length: 11, pattern: /^\d{11}$/, placeholder: 'Ej: 20123456789' },
        '3': { name: 'CE', minLen: 6, maxLen: 12, pattern: /^[a-zA-Z0-9]{6,12}$/, placeholder: 'Ej: CE123456' },
        '4': { name: 'Pasaporte', minLen: 6, maxLen: 12, pattern: /^[a-zA-Z0-9]{6,12}$/, placeholder: 'Ej: AB1234567' },
        '5': { name: 'SNM', minLen: 6, maxLen: 15, pattern: /^[a-zA-Z0-9]{6,15}$/, placeholder: 'Ej: SNM123456' },
    };

    // ── Update placeholder on type change ──
    tipoDoc.addEventListener('change', () => {
        const rule = DOC_RULES[tipoDoc.value];
        if (rule) {
            numDoc.placeholder = rule.placeholder;
            numDoc.maxLength = rule.length || rule.maxLen || 15;
        }
        numDoc.value = '';
        numDoc.focus();
    });

    // ── Restrict input to valid characters ──
    numDoc.addEventListener('input', () => {
        const rule = DOC_RULES[tipoDoc.value];
        if (rule && (tipoDoc.value === '1' || tipoDoc.value === '2')) {
            // Only digits for DNI and RUC
            numDoc.value = numDoc.value.replace(/\D/g, '');
        }
    });

    // ── Tab Switching ──
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            tabBtns.forEach(b => b.classList.remove('active'));
            tabContents.forEach(c => c.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById(btn.dataset.tab).classList.add('active');
            resetUI();
        });
    });

    // ── Form Submit ──
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        await performQuery();
    });

    formMultiple.addEventListener('submit', async (e) => {
        e.preventDefault();
        await performMultipleQuery();
    });

    // ── Export XLSX Button ──
    btnExportXlsx.addEventListener('click', () => {
        exportToXlsx();
    });

    if (btnStopMultiple) {
        btnStopMultiple.addEventListener('click', () => {
            cancelMultipleQuery = true;
            btnStopMultiple.innerHTML = '<span class="btn-content"><span class="btn-icon">🛑</span><span>Deteniendo...</span></span>';
            btnStopMultiple.disabled = true;
        });
    }

    // ── New Query Button ──
    btnNewQuery.addEventListener('click', () => {
        resetUI();
        tipoDoc.focus();
    });

    // ── Main Query Function ──
    async function performQuery() {
        const tipo = tipoDoc.value;
        const numero = numDoc.value.trim();

        // Validate
        if (!tipo) {
            showError('Por favor seleccione un tipo de documento.');
            return;
        }

        if (!numero) {
            showError('Por favor ingrese su número de documento.');
            return;
        }

        const rule = DOC_RULES[tipo];
        if (rule.pattern && !rule.pattern.test(numero)) {
            if (rule.length) {
                showError(`El ${rule.name} debe tener exactamente ${rule.length} dígitos.`);
            } else {
                showError(`El ${rule.name} debe tener entre ${rule.minLen} y ${rule.maxLen} caracteres alfanuméricos.`);
            }
            return;
        }

        // Start loading
        hideMessages();
        hideResults();
        showLoader();

        try {
            // Animate loading steps
            activateStep(0);
            await delay(800);
            completeStep(0);
            activateStep(1);

            const response = await fetch('/api/consulta', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    tipoDocumento: tipo,
                    numeroDocumento: numero,
                }),
            });

            completeStep(1);
            activateStep(2);
            await delay(500);

            const data = await response.json();
            completeStep(2);
            await delay(400);

            hideLoader();
            showForm();

            if (!data.success) {
                showError(data.error || 'Ocurrió un error al consultar. Intente nuevamente.');
                return;
            }

            // Single element inject for unified table rendering
            if (data.lineas && data.lineas.length > 0) {
                data.lineas.forEach(l => l.documentoRelacionado = numero);
                globalFoundLineas = data.lineas;
                renderResults(globalFoundLineas, data.totalLineas);
            } else {
                showInfo(data.mensaje || 'No se encontraron líneas registradas a su nombre.');
            }
        } catch (err) {
            hideLoader();
            showForm();
            console.error('Error:', err);
            showError(
                'No se pudo conectar con el servidor. Asegúrese de que el servidor esté corriendo en http://localhost:3000'
            );
        }
    }

    // ── Multiple Query Function ──
    async function performMultipleQuery() {
        const tipo = document.getElementById('tipoDocumentoMultiple').value;
        const numerosRaw = document.getElementById('numerosDocumentos').value;

        if (!tipo) { showError('Por favor seleccione un tipo de documento.'); return; }
        if (!numerosRaw.trim()) { showError('Por favor ingrese al menos un número.'); return; }

        const rawList = numerosRaw.split(/[\n,]+/).map(n => n.trim()).filter(n => n.length > 0);

        if (rawList.length === 0) { showError('Lista vacía o inválida.'); return; }

        const rule = DOC_RULES[tipo];
        for (const numero of rawList) {
            if (rule.pattern && !rule.pattern.test(numero)) {
                showError(`El número "${numero}" no es un ${rule.name} válido.`);
                return;
            }
        }

        hideMessages();
        hideResults();
        showLoader();

        let allLineas = [];
        let totalGeneral = 0;
        let errores = [];
        let continuousErrorStartTime = null;
        let interruptedReason = null;

        cancelMultipleQuery = false;
        if (btnSubmitMultiple) btnSubmitMultiple.style.display = 'none';
        if (btnStopMultiple) {
            btnStopMultiple.style.display = 'block';
            btnStopMultiple.disabled = false;
            btnStopMultiple.innerHTML = '<span class="btn-content"><span class="btn-icon">🛑</span><span>Detener Proceso</span></span>';
        }

        try {
            activateStep(0);
            await delay(500);
            completeStep(0);
            activateStep(1);

            for (let i = 0; i < rawList.length; i++) {
                if (cancelMultipleQuery) {
                    interruptedReason = `Proceso detenido manualmente por el usuario. Último documento procesado u omitido: ${rawList[i > 0 ? i - 1 : 0]}. Se procede a la extracción segura.`;
                    break;
                }

                const numero = rawList[i];
                const loaderTextHtml = document.querySelector('.loader-text');
                const origText = loaderTextHtml.innerHTML;
                loaderTextHtml.innerHTML = `Consultando documento ${i + 1} de ${rawList.length}...<span class="dots"></span>`;

                let querySuccess = false;

                try {
                    const response = await fetch('/api/consulta', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ tipoDocumento: tipo, numeroDocumento: numero }),
                    });
                    const data = await response.json();

                    if (!data.success) {
                        errores.push(`Error en ${numero}: ${data.error}`);
                    } else {
                        querySuccess = true;
                        if (data.lineas && data.lineas.length > 0) {
                            data.lineas.forEach(l => l.documentoRelacionado = numero);
                            allLineas = allLineas.concat(data.lineas);
                            totalGeneral += data.totalLineas || data.lineas.length;
                        }
                    }
                } catch (e) {
                    errores.push(`Error de conexión en ${numero}`);
                }

                // Track continous network errors
                if (querySuccess) {
                    continuousErrorStartTime = null;
                } else {
                    if (!continuousErrorStartTime) continuousErrorStartTime = Date.now();
                    if ((Date.now() - continuousErrorStartTime) > 10 * 60 * 1000) {
                        interruptedReason = `Se interrumpió por fallas de red constantes durante más de 10 minutos. Descargando automáticamente hasta el documento procesado: ${numero}.`;
                        break;
                    }
                }

                // Double check cancel after network request
                if (cancelMultipleQuery) {
                    interruptedReason = `Proceso detenido manualmente. Último procesado: ${numero}.`;
                    break;
                }

                // Avoid hammering the server too much, delay between queries
                if (i < rawList.length - 1) {
                    await delay(800);
                }
            }

            completeStep(1);
            activateStep(2);
            await delay(500);

            hideLoader();
            showForm();
            if (btnSubmitMultiple) btnSubmitMultiple.style.display = 'block';
            if (btnStopMultiple) btnStopMultiple.style.display = 'none';

            if (errores.length > 0 && allLineas.length === 0 && !interruptedReason) {
                showError(errores.length > 5 ? `${errores.slice(0, 5).join(' | ')} (y ${errores.length - 5} más)` : errores.join(' | '));
                return;
            }

            if (allLineas.length > 0) {
                globalFoundLineas = allLineas;
                renderResults(globalFoundLineas, totalGeneral);

                if (interruptedReason) {
                    showInfo(interruptedReason);
                } else if (errores.length > 0) {
                    showInfo(`Proceso completado con algunas omisiones (${errores.length} validaciones erróneas).`);
                }

                // Auto export triggered blindly at process finish/stop
                exportToXlsx();
            } else {
                showInfo(interruptedReason || 'No se encontraron líneas registradas en los documentos consultados.');
            }
        } catch (err) {
            hideLoader();
            showForm();
            if (btnSubmitMultiple) btnSubmitMultiple.style.display = 'block';
            if (btnStopMultiple) btnStopMultiple.style.display = 'none';
            console.error('Error:', err);
            showError('Hubo un fallo crítico durante el proceso agrupado.');
        }
    }

    // ── Render Results Table ──
    function renderResults(lineas, total) {
        resultsBody.innerHTML = '';

        // Show only the last 10 lines in UI to avoid browser freezing
        const lineasToShow = lineas.slice(-10).reverse();

        lineasToShow.forEach((linea) => {
            const tr = document.createElement('tr');

            // Determine operator info
            const operatorInfo = getOperatorInfo(linea.operador);
            const modalityClass = getModalityClass(linea.modalidad);

            tr.innerHTML = `
        <td style="color: var(--text-muted); font-weight: 500;">${linea.numero}</td>
        <td>
          <span style="font-weight: 600; font-family: monospace; letter-spacing: 0.5px; opacity: 0.9;">${linea.documentoRelacionado || '-'}</span>
        </td>
        <td>
          <div class="operator-cell">
            <div class="operator-icon ${operatorInfo.cssClass}">${operatorInfo.abbr}</div>
            <span>${linea.operador}</span>
          </div>
        </td>
        <td>
          <span class="modality-badge ${modalityClass}">${linea.modalidad}</span>
        </td>
        <td>
          <span class="phone-number">${linea.telefono}</span>
        </td>
      `;
            resultsBody.appendChild(tr);
        });

        resultsBadge.textContent = `${total} línea${total !== 1 ? 's' : ''} encontrada${total !== 1 ? 's' : ''}${total > 10 ? ' (Mostrando las últimas 10)' : ''}`;
        resultsBadge.className = 'results-badge ' + (total > 0 ? 'success' : 'warning');

        // Expose Export Button if we actually found items
        if (total > 0) {
            btnExportXlsx.style.display = 'inline-flex';
        } else {
            btnExportXlsx.style.display = 'none';
        }

        resultsSection.classList.add('active');
        resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    // ── XLSX Export Logic ──
    function exportToXlsx() {
        if (!globalFoundLineas || globalFoundLineas.length === 0) {
            alert("No hay datos para exportar");
            return;
        }

        // Format map for SheetJS to write clean columns
        const exportData = globalFoundLineas.map(linea => ({
            "Documento Relacionado": linea.documentoRelacionado || '-',
            "Número N°": linea.numero,
            "Operador": linea.operador,
            "Modalidad": linea.modalidad,
            "Teléfono": linea.telefono
        }));

        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(exportData);

        // Add minimal column widths
        ws['!cols'] = [
            { wch: 15 }, { wch: 10 }, { wch: 25 }, { wch: 15 }, { wch: 20 }
        ];

        XLSX.utils.book_append_sheet(wb, ws, "Líneas OSIPTEL");
        XLSX.writeFile(wb, "OSIPTEL_Lineas_Resultados.xlsx");
    }

    // ── Operator info mapping ──
    function getOperatorInfo(operador) {
        const name = operador.toLowerCase();
        if (name.includes('movistar') || name.includes('telefonica') || name.includes('america movil') === false && name.includes('movil')) {
            // Check more carefully
        }
        if (name.includes('america movil') || name.includes('claro')) {
            return { cssClass: 'claro', abbr: 'CL' };
        }
        if (name.includes('movistar') || name.includes('telefonica')) {
            return { cssClass: 'movistar', abbr: 'MV' };
        }
        if (name.includes('entel')) {
            return { cssClass: 'entel', abbr: 'EN' };
        }
        if (name.includes('bitel') || name.includes('viettel')) {
            return { cssClass: 'bitel', abbr: 'BT' };
        }
        return { cssClass: 'default', abbr: operador.substring(0, 2).toUpperCase() };
    }

    // ── Modality class mapping ──
    function getModalityClass(modalidad) {
        const mod = modalidad.toLowerCase();
        if (mod.includes('prepago')) return 'prepago';
        if (mod.includes('postpago')) return 'postpago';
        if (mod.includes('control')) return 'control';
        return 'prepago'; // default
    }

    // ── UI Helpers ──
    function showLoader() {
        form.style.display = 'none';

        // Only hide standard form container, but let buttons in formMultiple exist
        document.querySelector('.tabs-container').style.display = 'none';

        // For multiple, keep the form multiple but hide selects and textareas
        if (formMultiple.style.display !== 'none') {
            document.querySelectorAll('#consultaFormMultiple .form-group').forEach(el => el.style.display = 'none');
        }

        loaderContainer.classList.add('active');
        steps.forEach((s) => {
            s.classList.remove('active', 'done');
        });
    }

    function hideLoader() {
        loaderContainer.classList.remove('active');
        document.querySelector('.tabs-container').style.display = 'flex';
        // restore groups
        document.querySelectorAll('#consultaFormMultiple .form-group').forEach(el => el.style.display = 'block');
        document.querySelector('.loader-text').innerHTML = `Consultando líneas registradas<span class="dots"></span>`;
    }

    function showForm() {
        form.style.display = 'block';
        formMultiple.style.display = 'block';
    }

    function activateStep(index) {
        if (steps[index]) {
            steps[index].classList.add('active');
            steps[index].classList.remove('done');
        }
    }

    function completeStep(index) {
        if (steps[index]) {
            steps[index].classList.remove('active');
            steps[index].classList.add('done');
            steps[index].querySelector('.step-icon').textContent = '✓';
        }
    }

    function showError(message) {
        errorText.textContent = message;
        errorBox.classList.add('active');
    }

    function showInfo(message) {
        infoText.textContent = message;
        infoBox.classList.add('active');
    }

    function hideMessages() {
        errorBox.classList.remove('active');
        infoBox.classList.remove('active');
    }

    function hideResults() {
        resultsSection.classList.remove('active');
    }

    function resetUI() {
        hideMessages();
        hideResults();
        hideLoader();
        showForm();
        form.reset();
        formMultiple.reset();
        numDoc.placeholder = 'Ingrese su número';
        if (btnExportXlsx) btnExportXlsx.style.display = 'none';
        if (btnStopMultiple) btnStopMultiple.style.display = 'none';
        if (btnSubmitMultiple) btnSubmitMultiple.style.display = 'flex';
        globalFoundLineas = [];
        cancelMultipleQuery = false;
        // Reset loading steps
        steps.forEach((s, i) => {
            s.classList.remove('active', 'done');
            s.querySelector('.step-icon').textContent = String(i + 1);
        });
    }

    function delay(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
})();
