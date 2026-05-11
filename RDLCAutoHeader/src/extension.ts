/**
 * RDLC Auto Header Pro
 * Author: Alvaro Robles
 */
import * as vscode from 'vscode';
import * as path from 'path';
import { processRdlc } from './processor';

/**
 * Se ejecuta al activar la extensión
 */
export function activate(context: vscode.ExtensionContext) {
    console.log('RDLC Auto Header Pro is now active!');
    const provider = new RdlcSidebarProvider(context.extensionUri);
    
    // Registrar el proveedor de la vista lateral (Webview)
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('rdlcAutoHeaderSidebar', provider)
    );

    // COMANDO: Ejecutar desde el menú contextual (Clic derecho sobre archivo .rdlc)
    let disposable = vscode.commands.registerCommand('rdlcautoheader.processReport', async (uri: vscode.Uri, selectedUris: vscode.Uri[]) => {
        let urisToProcess: vscode.Uri[] = [];
        if (selectedUris && selectedUris.length > 0) {
            urisToProcess = selectedUris;
        } else if (uri) {
            urisToProcess = [uri];
        }

        if (urisToProcess.length > 0) {
            const config = vscode.workspace.getConfiguration('rdlcAutoHeader');
            const askForSuffix = config.get<boolean>('askForSuffix');
            const askForGrouping = config.get<boolean>('askForGrouping');

            let useModSuffix = config.get<boolean>('defaultUseSuffix');
            let groupBody = config.get<boolean>('defaultGroupBody');

            // Preguntar por sufijo si está habilitado
            if (askForSuffix) {
                const mode = await vscode.window.showQuickPick(
                    [
                        { label: "Añadir sufijo _MOD", detail: "Crea un nuevo archivo terminado en _MOD.rdlc", value: true },
                        { label: "Sobrescribir original", detail: "Reemplaza el archivo seleccionado", value: false }
                    ],
                    { placeHolder: "¿Cómo quieres guardar los cambios?" }
                );
                if (mode === undefined) return;
                useModSuffix = mode.value;
            }

            // Preguntar por agrupación si está habilitado
            if (askForGrouping) {
                const groupMode = await vscode.window.showQuickPick(
                    [
                        { label: "No agrupar Body", detail: "Solo inyecta el SetData/GetData", value: false },
                        { label: "Agrupar Body en Tabla (Master)", detail: "Envuelve todo el cuerpo en una tabla agrupada", value: true }
                    ],
                    { placeHolder: "¿Deseas agrupar todo el cuerpo del informe en una tabla?" }
                );
                if (groupMode === undefined) return;
                groupBody = groupMode.value;
            }

            const rectColor = config.get<string>('rectColor') || 'Red';

            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: "Procesando archivos RDLC...",
                cancellable: false
            }, async (progress) => {
                for (const u of urisToProcess) {
                    try {
                        const contentBytes = await vscode.workspace.fs.readFile(u);
                        const content = new TextDecoder('utf-8').decode(contentBytes);
                        const result = processRdlc(content, groupBody, rectColor);
                        
                        const filePath = u.fsPath;
                        const newPath = useModSuffix ? filePath.replace('.rdlc', '_MOD.rdlc') : filePath;
                        const newUri = vscode.Uri.file(newPath);
                        
                        await vscode.workspace.fs.writeFile(newUri, new TextEncoder().encode(result.xml));
                        
                        // Opcionalmente mandar al log de la sidebar si está abierta
                        if (provider.view) {
                            let log = `\n[ÉXITO] ${path.basename(newPath)}\n`;
                            log += `   - Tabla creada\n   - Agrupado por: ${result.groupField}\n`;
                            provider.view.webview.postMessage({ command: 'log', text: log, status: 'success' });
                        }
                    } catch (e: any) {
                        vscode.window.showErrorMessage(`Error en ${path.basename(u.fsPath)}: ${e.message}`);
                    }
                }
            });

            vscode.window.showInformationMessage(`✅ Procesamiento de ${urisToProcess.length} archivo(s) finalizado.`);
        }
    });

    // COMANDO: Abrir Ajustes de la extensión
    let settingsDisposable = vscode.commands.registerCommand('rdlcautoheader.openSettings', () => {
        vscode.commands.executeCommand('workbench.action.openSettings', 'rdlcAutoHeader');
    });

    context.subscriptions.push(disposable);
    context.subscriptions.push(settingsDisposable);
}

class RdlcSidebarProvider implements vscode.WebviewViewProvider {
    private _view?: vscode.WebviewView;
    private _pendingFiles: string[] = [];

    constructor(private readonly _extensionUri: vscode.Uri) {}

    public get view() {
        return this._view;
    }

    public resolveWebviewView(webviewView: vscode.WebviewView, context: vscode.WebviewViewResolveContext, _token: vscode.CancellationToken) {
        this._view = webviewView;
        webviewView.webview.options = { enableScripts: true };
        webviewView.webview.html = getWebviewContent();

        webviewView.webview.onDidReceiveMessage(async (data) => {
            switch (data.command) {
                case 'processFiles':
                    const config = vscode.workspace.getConfiguration('rdlcAutoHeader');
                    const useSuffix = data.useModSuffix !== undefined ? data.useModSuffix : config.get<boolean>('defaultUseSuffix');
                    const groupBody = data.groupBody !== undefined ? data.groupBody : config.get<boolean>('defaultGroupBody');
                    await handleProcessing(data.files, useSuffix!, groupBody!, webviewView.webview);
                    break;
                case 'selectFiles':
                    const files = await vscode.window.showOpenDialog({
                        canSelectMany: true,
                        filters: { 'RDLC': ['rdlc'] }
                    });
                    if (files && files.length > 0) {
                        webviewView.webview.postMessage({ command: 'addFiles', files: files.map(f => f.fsPath) });
                    }
                    break;
                case 'detectFiles':
                    const workspaceFiles = await vscode.workspace.findFiles('**/*.rdlc', '**/node_modules/**');
                    if (workspaceFiles.length > 0) {
                        webviewView.webview.postMessage({ 
                            command: 'addFiles', 
                            files: workspaceFiles.map(f => f.fsPath) 
                        });
                        vscode.window.showInformationMessage(`Se han detectado ${workspaceFiles.length} archivos RDLC.`);
                    } else {
                        vscode.window.showWarningMessage('No se encontraron archivos RDLC en el espacio de trabajo.');
                    }
                    break;
                case 'ready':
                    if (this._pendingFiles.length > 0) {
                        this._view?.webview.postMessage({ command: 'addFiles', files: this._pendingFiles });
                        this._pendingFiles = [];
                    }
                    break;
                case 'updateColor':
                    vscode.workspace.getConfiguration('rdlcAutoHeader').update('rectColor', data.value, vscode.ConfigurationTarget.Global);
                    break;
                case 'updateConfig':
                    await vscode.workspace.getConfiguration('rdlcAutoHeader').update(data.key, data.value, vscode.ConfigurationTarget.Global);
                    // Refrescar webview manteniendo la pestaña de ajustes activa
                    webviewView.webview.html = getWebviewContent('settings');
                    break;
            }
        });
    }

    public addFiles(files: string[]) {
        if (this._view) {
            this._view.webview.postMessage({ command: 'addFiles', files });
        } else {
            this._pendingFiles.push(...files);
        }
    }
}

/**
 * Función que orquestra la lectura, procesamiento y escritura de archivos
 */
async function handleProcessing(filePaths: string[], useModSuffix: boolean, groupBody: boolean, webview: vscode.Webview) {
    const fs = vscode.workspace.fs;
    const config = vscode.workspace.getConfiguration('rdlcAutoHeader');
    const rectColor = config.get<string>('rectColor') || 'Red';
    const pageBreakLocation = config.get<string>('pageBreakLocation') || 'End';
    const cleanExpressions = config.get<boolean>('cleanExpressions') ?? true;
    const primaryDataSet = config.get<string>('primaryDataSet') || 'DataSet_Result';

    for (const filePath of filePaths) {
        try {
            const uri = vscode.Uri.file(filePath);
            const contentBytes = await fs.readFile(uri);
            const content = new TextDecoder('utf-8').decode(contentBytes);
            
            // Procesar el XML mediante el motor central
            const result = processRdlc(content, groupBody, rectColor, pageBreakLocation, cleanExpressions, primaryDataSet);
            
            // Determinar la ruta de salida
            const newPath = useModSuffix ? filePath.replace('.rdlc', '_MOD.rdlc') : filePath;
            const newUri = vscode.Uri.file(newPath);
            await fs.writeFile(newUri, new TextEncoder().encode(result.xml));
            
            // Informar al usuario
            let log = `\n[ÉXITO] ${path.basename(newPath)}\n`;
            log += `   - Tabla creada\n`;
            log += `   - Agrupado por: ${result.groupField}\n`;
            log += `   - Inyectado código\n`;
            webview.postMessage({ command: 'log', text: log, status: 'success' });
            // Preguntar si abrir el archivo
            const askToOpen = config.get<boolean>('askToOpen');
            const defaultOpen = config.get<boolean>('defaultOpen');
            
            let shouldOpen = defaultOpen;
            if (askToOpen) {
                const answer = await vscode.window.showInformationMessage(`¿Quieres abrir el archivo procesado? / Do you want to open the processed file? (${path.basename(newPath)})`, 'Sí / Yes', 'No');
                shouldOpen = (answer === 'Sí / Yes');
            }

            if (shouldOpen) {
                const doc = await vscode.workspace.openTextDocument(newUri);
                await vscode.window.showTextDocument(doc);
            }
            
        } catch (e: any) {
            webview.postMessage({ command: 'log', text: `\n[ERROR] ${path.basename(filePath)}: ${e.message}\n`, status: 'error' });
        }
    }
    webview.postMessage({ command: 'log', text: `\n[INFO] PROCESAMIENTO FINALIZADO / PROCESSING FINISHED.\n`, status: 'success' });
}

function getWebviewContent(activeTab: string = 'automation') {
    const config = vscode.workspace.getConfiguration('rdlcAutoHeader');
    const askForSuffix = config.get<boolean>('askForSuffix');
    const defaultUseSuffix = config.get<boolean>('defaultUseSuffix');
    const askForGrouping = config.get<boolean>('askForGrouping');
    const defaultGroupBody = config.get<boolean>('defaultGroupBody');
    const rectColor = config.get<string>('rectColor') || '#FF0000';
    const pageBreakLocation = config.get<string>('pageBreakLocation') || 'End';
    const cleanExpressions = config.get<boolean>('cleanExpressions') ?? true;
    const primaryDataSet = config.get<string>('primaryDataSet') || 'DataSet_Result';
    const askToOpen = config.get<boolean>('askToOpen');
    const defaultOpen = config.get<boolean>('defaultOpen');

    return `<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        :root {
            --accent: #CBA6F7;
            --accent-dim: #89B4FA;
            --bg: #1E1E2E;
            --card: #313244;
            --text: #CDD6F4;
            --text-dim: #A6ADC8;
        }
        body { font-family: 'Segoe UI', sans-serif; background-color: var(--bg); color: var(--text); padding: 10px; margin: 0; font-weight: 500; font-size: 13px; transition: font-size 0.2s; }
        
        /* RESPONSIVE: Escalar si la pestaña es ancha */
        @media (min-width: 400px) {
            body { font-size: 16px; padding: 20px; }
            h1 { font-size: 18px; }
            .tab { font-size: 12px; }
            .setting-label { font-size: 13px; }
            .setting-desc { font-size: 11px; }
            .btn { font-size: 14px; padding: 15px; }
            .drop-zone { padding: 50px 20px; }
            .drop-zone div:first-child { font-size: 20px !important; }
        }

        .tabs { display: flex; border-bottom: 1px solid var(--card); margin-bottom: 15px; }
        .tab { padding: 8px 15px; cursor: pointer; color: var(--text-dim); transition: 0.3s; border-bottom: 2px solid transparent; text-transform: uppercase; font-size: 10px; letter-spacing: 1px; font-weight: bold; }
        .tab.active { color: var(--accent); border-bottom: 2px solid var(--accent); }
        
        .content { display: none; }
        .content.active { display: block; }

        h1 { color: var(--accent); font-size: 14px; text-align: center; text-transform: uppercase; margin: 10px 0; }
        .credits { font-size: 9px; text-align: center; color: var(--accent-dim); margin-bottom: 15px; }

        .card { background: var(--card); padding: 12px; border-radius: 10px; margin-bottom: 12px; border: 1px solid rgba(255,255,255,0.05); }
        .card-title { font-size: 11px; color: var(--accent-dim); margin-bottom: 10px; text-transform: uppercase; font-weight: bold; }

        .drop-zone { border: 2px dashed var(--accent-dim); border-radius: 10px; padding: 30px 10px; text-align: center; background: rgba(137, 180, 250, 0.05); cursor: pointer; transition: 0.3s; margin-bottom: 15px; color: var(--accent-dim); font-size: 12px; }
        .drop-zone:hover { background: rgba(137, 180, 250, 0.1); }
        .file-list { max-height: 120px; overflow-y: auto; background: rgba(0,0,0,0.2); border-radius: 6px; padding: 5px; margin-bottom: 15px; font-size: 11px; min-height: 40px; }
        .file-item { display: flex; justify-content: space-between; padding: 5px; border-bottom: 1px solid rgba(255,255,255,0.05); }
        .remove-icon { color: #F38BA8; cursor: pointer; font-weight: bold; padding-left: 10px; }

        .setting-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
        .setting-info { display: flex; flex-direction: column; }
        .setting-label { font-size: 11px; font-weight: bold; }
        .setting-desc { font-size: 9px; color: var(--text-dim); }

        .switch { position: relative; display: inline-block; width: 34px; height: 18px; }
        .switch input { opacity: 0; width: 0; height: 0; }
        .slider { position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: #45475A; transition: .4s; border-radius: 34px; }
        .slider:before { position: absolute; content: ""; height: 14px; width: 14px; left: 2px; bottom: 2px; background-color: white; transition: .4s; border-radius: 50%; }
        input:checked + .slider { background-color: var(--accent); }
        input:checked + .slider:before { transform: translateX(16px); }

        input[type="color"] { border: none; width: 30px; height: 30px; cursor: pointer; background: none; padding: 0; border-radius: 50%; overflow: hidden; }

        .btn { border: none; padding: 12px; font-size: 12px; font-weight: bold; border-radius: 8px; cursor: pointer; width: 100%; transition: 0.2s; text-transform: uppercase; margin-top: 10px; }
        .btn-run { background-color: var(--accent-dim); color: #11111B; }
        .btn-run:hover { filter: brightness(1.1); }
        
        .log-box { background: #11111B; color: var(--text-dim); padding: 10px; border-radius: 8px; font-family: monospace; font-size: 10px; min-height: 80px; max-height: 150px; overflow-y: auto; margin-top: 10px; border: 1px solid rgba(255, 255, 255, 0.05); }
        .success { color: #A6E3A1; }
        .error { color: #F38BA8; }
    </style>
</head>
<body>
    <div class="tabs">
        <div id="tab-auto" class="tab ${activeTab === 'automation' ? 'active' : ''}" onclick="showTab('automation')">Automatización / Automation</div>
        <div id="tab-settings" class="tab ${activeTab === 'settings' ? 'active' : ''}" onclick="showTab('settings')">Ajustes / Settings</div>
        <div id="tab-info" class="tab ${activeTab === 'info' ? 'active' : ''}" onclick="showTab('info')">Info</div>
    </div>

    <h1>RDLC Auto Header PRO</h1>
    <div class="credits">Enterprise Edition • v1.7.0</div>

    <div id="info" class="content ${activeTab === 'info' ? 'active' : ''}" style="font-size: 11px; line-height: 1.5; color: var(--text-dim);">
        <div class="card">
            <div class="card-title">EL DESAFÍO / THE CHALLENGE</div>
            <p>En informes de <b>Business Central</b> con múltiples páginas, el motor RDLC pierde la referencia del encabezado al cambiar de documento. / In <b>Business Central</b> reports with multiple pages, the RDLC engine loses header reference when changing documents.</p>
        </div>

        <div class="card">
            <div class="card-title">LA SOLUCIÓN / THE SOLUTION</div>
            <p>Esta extensión implementa el patrón <b>SetData / GetData</b> automáticamente. / This extension implements the <b>SetData / GetData</b> pattern automatically.</p>
            <ul style="padding-left: 15px;">
                <li>Inyecta código VB.NET / Injects VB.NET code.</li>
                <li>Serializa campos del encabezado / Serializes header fields.</li>
                <li>Crea Master Tablix de sincronización / Creates synchronization Master Tablix.</li>
            </ul>
        </div>

        <div style="text-align: center; margin-top: 20px; opacity: 0.8; font-size: 9px;">
            By <b><a href="https://github.com/roblesgg" style="color:var(--accent)">Alvaro Robles</a></b> • Thanks to <b>Junpeng Jin</b>
        </div>
    </div>

    <div id="automation" class="content ${activeTab === 'automation' ? 'active' : ''}">
        <div id="dropZone" class="drop-zone">
            <div style="font-size: 16px; font-weight: 800; margin-bottom: 5px;">AÑADIR / ADD RDLC</div>
            <div style="font-size: 9px; opacity: 0.7;">arrastrar archivos / drag files</div>
        </div>
        
        <button class="btn" id="btnDetect" style="background-color: var(--card); color: var(--accent); border: 1px solid var(--accent); margin-top: -5px; margin-bottom: 15px;">DETECTAR TODOS / SCAN ALL</button>
        
        <div class="file-list" id="fileList"></div>
        


        <button class="btn btn-run" id="btnRun">INICIAR / START</button>
        <div class="log-box" id="logBox">Ready...</div>
    </div>

    <div id="settings" class="content ${activeTab === 'settings' ? 'active' : ''}">
        <div class="card">
            <div class="card-title">Interacción</div>
            <div class="setting-row">
                <div class="setting-info">
                    <span class="setting-label">Preguntar Sufijo / Ask Suffix</span>
                    <span class="setting-desc">¿Preguntar por _MOD? / Always ask?</span>
                </div>
                <label class="switch">
                    <input type="checkbox" id="setAskSuffix" ${askForSuffix ? 'checked' : ''}>
                    <span class="slider"></span>
                </label>
            </div>
            <div class="setting-row" style="${askForSuffix ? 'opacity: 0.4; pointer-events: none;' : ''}">
                <div class="setting-info">
                    <span class="setting-label">Usar Sufijo / Use Suffix</span>
                    <span class="setting-desc">Valor defecto / Default value</span>
                </div>
                <label class="switch">
                    <input type="checkbox" id="setDefaultSuffix" ${defaultUseSuffix ? 'checked' : ''} ${askForSuffix ? 'disabled' : ''}>
                    <span class="slider"></span>
                </label>
            </div>
            
            <div class="setting-row" style="margin-top: 15px; border-top: 1px solid rgba(255,255,255,0.05); padding-top: 15px;">
                <div class="setting-info">
                    <span class="setting-label">Preguntar Abrir / Ask Open</span>
                    <span class="setting-desc">¿Preguntar al terminar? / Ask when done?</span>
                </div>
                <label class="switch">
                    <input type="checkbox" id="setAskOpen" ${askToOpen ? 'checked' : ''}>
                    <span class="slider"></span>
                </label>
            </div>
            <div class="setting-row" style="${askToOpen ? 'opacity: 0.4; pointer-events: none;' : ''}">
                <div class="setting-info">
                    <span class="setting-label">Abrir al terminar / Open when done</span>
                    <span class="setting-desc">Abrir archivo / Auto open file</span>
                </div>
                <label class="switch">
                    <input type="checkbox" id="setDefaultOpen" ${defaultOpen ? 'checked' : ''} ${askToOpen ? 'disabled' : ''}>
                    <span class="slider"></span>
                </label>
            </div>
        </div>

        <div class="card">
            <div class="card-title">Estructura / Master Structure</div>
            <div class="setting-row">
                <div class="setting-info">
                    <span class="setting-label">Preguntar Agrupación / Ask Group</span>
                    <span class="setting-desc">¿Preguntar tabla Master? / Ask for Master?</span>
                </div>
                <label class="switch">
                    <input type="checkbox" id="setAskGroup" ${askForGrouping ? 'checked' : ''}>
                    <span class="slider"></span>
                </label>
            </div>
            <div class="setting-row" style="${askForGrouping ? 'opacity: 0.4; pointer-events: none;' : ''}">
                <div class="setting-info">
                    <span class="setting-label">Agrupar Body / Group Body</span>
                    <span class="setting-desc">Valor defecto / Default value</span>
                </div>
                <label class="switch">
                    <input type="checkbox" id="setDefaultGroup" ${defaultGroupBody ? 'checked' : ''} ${askForGrouping ? 'disabled' : ''}>
                    <span class="slider"></span>
                </label>
            </div>
        </div>

        <div class="card">
            <div class="card-title">Estética / Appearance</div>
            <div class="setting-row">
                <div class="setting-info">
                    <span class="setting-label">Color inyector / Injector color</span>
                    <span class="setting-desc">Color SetData square</span>
                </div>
                <input type="color" id="setColor" value="${rectColor}">
            </div>
        </div>

        <div class="card">
            <div class="card-title">Avanzado / Advanced</div>
            <div class="setting-row">
                <div class="setting-info">
                    <span class="setting-label">Salto Página / Page Break</span>
                    <span class="setting-desc">Location in Master Tablix</span>
                </div>
                <select id="setPageBreak" style="background: #45475A; color: white; border: none; padding: 4px; border-radius: 4px; font-size: 11px;">
                    <option value="None" ${pageBreakLocation === 'None' ? 'selected' : ''}>None / Ninguno</option>
                    <option value="Start" ${pageBreakLocation === 'Start' ? 'selected' : ''}>Start / Inicio</option>
                    <option value="End" ${pageBreakLocation === 'End' ? 'selected' : ''}>End / Fin</option>
                    <option value="Between" ${pageBreakLocation === 'Between' ? 'selected' : ''}>Between / Entre</option>
                </select>
            </div>
            <div class="setting-row">
                <div class="setting-info">
                    <span class="setting-label">Limpiar / Clean Expressions</span>
                    <span class="setting-desc">Auto-remove First()</span>
                </div>
                <label class="switch">
                    <input type="checkbox" id="setCleanExpr" ${cleanExpressions ? 'checked' : ''}>
                    <span class="slider"></span>
                </label>
            </div>
            <div class="setting-row">
                <div class="setting-info">
                    <span class="setting-label">DataSet Principal / Primary DS</span>
                    <span class="setting-desc">Report DataSet name</span>
                </div>
                <input type="text" id="setPrimaryDS" value="${primaryDataSet}" style="background: #45475A; color: white; border: none; padding: 4px; border-radius: 4px; font-size: 11px; width: 80px;">
            </div>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        let selectedFiles = [];

        function showTab(tabId) {
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.content').forEach(c => c.classList.remove('active'));
            
            let btnId = 'tab-auto';
            if (tabId === 'settings') btnId = 'tab-settings';
            if (tabId === 'info') btnId = 'tab-info';
            
            document.getElementById(btnId).classList.add('active');
            document.getElementById(tabId).classList.add('active');
        }

        function updateSetting(key, value) {
            vscode.postMessage({ command: 'updateConfig', key: key, value: value });
        }

        document.getElementById('setAskSuffix').onchange = (e) => updateSetting('askForSuffix', e.target.checked);
        document.getElementById('setDefaultSuffix').onchange = (e) => updateSetting('defaultUseSuffix', e.target.checked);
        document.getElementById('setAskGroup').onchange = (e) => updateSetting('askForGrouping', e.target.checked);
        document.getElementById('setDefaultGroup').onchange = (e) => updateSetting('defaultGroupBody', e.target.checked);
        document.getElementById('setColor').onchange = (e) => updateSetting('rectColor', e.target.value);
        document.getElementById('setPageBreak').onchange = (e) => updateSetting('pageBreakLocation', e.target.value);
        document.getElementById('setCleanExpr').onchange = (e) => updateSetting('cleanExpressions', e.target.checked);
        document.getElementById('setAskOpen').onchange = (e) => updateSetting('askToOpen', e.target.checked);
        document.getElementById('setDefaultOpen').onchange = (e) => updateSetting('defaultOpen', e.target.checked);
        document.getElementById('setPrimaryDS').onchange = (e) => updateSetting('primaryDataSet', e.target.value);

        const dropZone = document.getElementById('dropZone');
        const fileList = document.getElementById('fileList');
        const logBox = document.getElementById('logBox');

        dropZone.onclick = () => vscode.postMessage({ command: 'selectFiles' });
        
        dropZone.ondragover = (e) => { e.preventDefault(); dropZone.style.borderColor = 'var(--accent)'; };
        dropZone.ondragleave = () => { dropZone.style.borderColor = 'var(--accent-dim)'; };
        dropZone.ondrop = (e) => {
            e.preventDefault();
            const files = Array.from(e.dataTransfer.files).map(f => f.path).filter(p => p.toLowerCase().endsWith('.rdlc'));
            addFiles(files);
        };

        window.addEventListener('message', event => {
            const m = event.data;
            if (m.command === 'addFiles') addFiles(m.files);
            if (m.command === 'log') {
                logBox.innerHTML += \`<div class="\${m.status}">\${m.text}</div>\`;
                logBox.scrollTop = logBox.scrollHeight;
            }
        });

        function addFiles(paths) {
            paths.forEach(p => { if(!selectedFiles.includes(p)) selectedFiles.push(p); });
            renderFiles();
        }

        function renderFiles() {
            if (selectedFiles.length === 0) {
                fileList.innerHTML = '<div style="color: #6C7086; text-align: center; padding-top: 5px;">Ningun archivo seleccionado</div>';
                return;
            }
            
            // Añadir cabecera con "Seleccionar todos"
            let html = '<div class="file-item" style="border-bottom: 2px solid var(--card); margin-bottom: 5px; font-weight: bold; color: var(--accent);">' +
                    '<div style="display: flex; align-items: center;">' +
                        '<input type="checkbox" id="selectAll" onchange="toggleSelectAll(this.checked)" checked style="margin-right: 10px;">' +
                        '<span>TODOS</span>' +
                    '</div>' +
                '</div>';

            html += selectedFiles.map((f, i) => {
                const name = f.split(/[\\\\/]/).pop();
                return '<div class="file-item">' +
                    '<div style="display: flex; align-items: center; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">' +
                        '<input type="checkbox" class="file-check" data-path="' + f + '" checked style="margin-right: 10px; flex-shrink: 0;">' +
                        '<span title="' + f + '">' + name + '</span>' +
                    '</div>' +
                    '<span class="remove-icon" onclick="removeFile(' + i + ')" style="flex-shrink: 0;">×</span>' +
                '</div>';
            }).join('');
            
            fileList.innerHTML = html;
        }

        window.toggleSelectAll = function(checked) {
            document.querySelectorAll('.file-check').forEach(cb => cb.checked = checked);
        }

        window.removeFile = function(i) { selectedFiles.splice(i, 1); renderFiles(); }

        document.getElementById('btnDetect').onclick = () => {
            vscode.postMessage({ command: 'detectFiles' });
        };

        document.getElementById('btnRun').onclick = () => {
            const checkedFiles = Array.from(document.querySelectorAll('.file-check:checked')).map(cb => cb.getAttribute('data-path'));
            if (checkedFiles.length === 0) {
                vscode.postMessage({ command: 'log', text: '[ERROR] Selecciona al menos un archivo para procesar.\\n', status: 'error' });
                return;
            }
            vscode.postMessage({ command: 'processFiles', files: checkedFiles });
        };

        vscode.postMessage({ command: 'ready' });
    </script>
</body>
</html>`;
}
