/**
 * RDLC Auto Header Engine
 * Author: Alvaro Robles
 */
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';

function escapeXml(unsafe: string): string {
    return unsafe.replace(/[<>&'"]/g, function (c) {
        switch (c) {
            case '<': return '&lt;';
            case '>': return '&gt;';
            case '&': return '&amp;';
            case '\'': return '&apos;';
            case '"': return '&quot;';
            default: return c;
        }
    });
}

/**
 * Función principal de procesamiento de archivos RDLC
 * @param xmlString Contenido original del archivo RDLC
 * @param groupBody Si es true, envuelve el cuerpo en una tabla agrupada (Master)
 */
export function processRdlc(
    xmlString: string, 
    groupBody: boolean = false, 
    rectColor: string = "Red",
    pageBreakLocation: string = "End",
    cleanExpressions: boolean = true,
    primaryDataSet: string = "DataSet_Result"
): { xml: string, fields: string[], groupField: string } {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlString, "text/xml");

    // Detectar el namespace del informe (ej. RDL 2016 o 2010)
    const reportNode = doc.getElementsByTagName("Report")[0];
    const nsUrl = reportNode && reportNode.namespaceURI ? reportNode.namespaceURI : "http://schemas.microsoft.com/sqlserver/reporting/2016/01/reportdefinition";

    // Buscar la sección del encabezado (PageHeader)
    let header = doc.getElementsByTagName("PageHeader")[0] || doc.getElementsByTagNameNS(nsUrl, "PageHeader")[0];
    if (!header) {
        throw new Error("No se encontró PageHeader.");
    }

    const valueNodes = header.getElementsByTagName("Value");
    const fields: string[] = [];

    // --- 1. EXTRACCIÓN DE CAMPOS DE LA CABECERA ---
    for (let i = 0; i < valueNodes.length; i++) {
        const node = valueNodes[i];
        
        // Ignorar campos que pertenezcan a una imagen (Logos, etc)
        let isImage = false;
        let parent = node.parentNode;
        while (parent) {
            if (parent.nodeName === "Image") {
                isImage = true;
                break;
            }
            parent = parent.parentNode;
        }
        if (isImage) continue;

        const text = node.textContent || "";
        // Buscar campos con el patrón Fields!Nombre.Value
        if (text.includes("Fields!")) {
            const regex = /Fields!([a-zA-Z0-9_]+)\.Value/g;
            let match;
            while ((match = regex.exec(text)) !== null) {
                const f = match[1];
                if (!fields.includes(f)) {
                    fields.push(f);
                }
                
                // Si cleanExpressions está activado, sustituimos la expresión por Code.GetData
                if (cleanExpressions) {
                    const fieldIndex = fields.indexOf(f) + 1;
                    // Simplificación: Sustituimos toda la expresión por la llamada a GetData
                    // En una versión más avanzada se podría hacer un replace quirúrgico
                    node.textContent = `=Code.GetData(${fieldIndex}, 1)`;
                }
            }
        }
    }

    if (fields.length === 0) {
        throw new Error("No hay campos de base de datos válidos en el header.");
    }

    // --- 2. INYECCIÓN DEL BLOQUE DE CÓDIGO VB.NET ---
    let codeNodes = doc.getElementsByTagName("Code");
    let codeNode;
    if (codeNodes.length === 0) {
        codeNode = doc.createElementNS(nsUrl, "Code");
        if (reportNode) reportNode.appendChild(codeNode);
    } else {
        codeNode = codeNodes[0];
    }

    let codeText = codeNode.textContent || "";
    // Solo inyectar si no existe ya la lógica de SetData
    if (!codeText.includes("Function SetData")) {
        const vbCode = `\nShared Data1 as Object
Public Function GetData(Num as Integer, Group as integer) as Object
if Group = 1 then
   Return Cstr(Choose(Num, Split(Cstr(Data1),Chr(177))))
End If
 
End Function
 
Public Function SetData(NewData as Object,Group as integer)
  If Group = 1 and NewData > "" Then
      Data1 = NewData
  End If
 
  Return True
End Function\n`;
        codeNode.textContent = codeText + vbCode;
    }

    // --- 3. PREPARACIÓN DE LA EXPRESIÓN SETDATA ---
    // Concatenamos todos los campos detectados separados por Chr(177)
    const fieldsArrayStr = fields.map(f => `Cstr(Fields!${f}.Value)`).join(" + Chr(177) + \n");
    const expr = `=Code.SetData(${fieldsArrayStr}, 1)`;

    // --- 4. DETECCIÓN DEL CAMPO DE AGRUPACIÓN (DOCUMENT NO.) ---
    const dataSets = doc.getElementsByTagName("DataSet");
    if (dataSets.length === 0) {
        throw new Error("El archivo RDLC no tiene ningún DataSet asociado.");
    }
    
    let datasetName = "DataSet_Result";
    const dsName = dataSets[0].getAttribute("Name");
    if (dsName) datasetName = dsName;

    const fieldNodes = doc.getElementsByTagName("Field");
    const allFields: string[] = [];
    for (let i = 0; i < fieldNodes.length; i++) {
        const fname = fieldNodes[i].getAttribute("Name");
        if (fname) allFields.push(fname);
    }

    if (allFields.length === 0) {
        throw new Error(`El DataSet '${datasetName}' no contiene campos.`);
    }

    // Estrategia de búsqueda de campo de agrupación (No_, DocumentNo, etc)
    let groupField = "";
    for (const f of allFields) {
        const fUp = f.toUpperCase();
        if (fUp === "NO_" || fUp === "DOCUMENTNO" || fUp === "DOCUMENT_NO" || fUp === "ORDERNO" || fUp === "ORDER_NO") {
            groupField = f;
            break;
        }
    }
    if (!groupField) {
        for (const f of allFields) {
            if (f.toUpperCase().includes("NO_") && f.toUpperCase().includes("HEADER")) {
                groupField = f;
                break;
            }
        }
    }
    if (!groupField) {
        for (const f of allFields) {
            if (f.toUpperCase().includes("NO") || f.toUpperCase().includes("ID")) {
                groupField = f;
                break;
            }
        }
    }
    
    // Si después de todas las búsquedas no hay campo, lanzar error en lugar de inventar uno
    if (!groupField) {
        throw new Error("No se pudo detectar automáticamente un campo de agrupación válido (ej. No., DocumentNo). Compruebe los campos de su DataSet.");
    }

    // --- 5. INYECCIÓN DEL RECTÁNGULO PORTADOR (INYECTOR) ---
    let reportItemsNodes = doc.getElementsByTagName("Body")[0]?.getElementsByTagName("ReportItems");
    let reportItems = reportItemsNodes ? reportItemsNodes[0] : null;

    if (reportItems) {
        // Limpiar restos de inyecciones anteriores
        const rects = reportItems.getElementsByTagName("Rectangle");
        for (let i = rects.length - 1; i >= 0; i--) {
            if (rects[i].getAttribute("Name") === "BTC_Header_Carrier") {
                rects[i].parentNode?.removeChild(rects[i]);
            }
        }
        
        // También limpiar el Tablix antiguo por si acaso venía de una versión anterior
        const tbs = reportItems.getElementsByTagName("Tablix");
        for (let i = tbs.length - 1; i >= 0; i--) {
            if (tbs[i].getAttribute("Name") === "BTC_Master_Inyector" || tbs[i].getAttribute("Name") === "BTC_Master_Group_Body") {
                tbs[i].parentNode?.removeChild(tbs[i]);
            }
        }

        // Obtener el ancho del cuerpo para ajustar el diseño
        const bodyNode = doc.getElementsByTagName("Body")[0];
        const bodyWidth = bodyNode?.getElementsByTagName("Width")[0]?.textContent || "19cm";

        // Crear el rectángulo que contiene la expresión SetData oculta
        const simpleXml = `<Rectangle Name="BTC_Header_Carrier" xmlns="${nsUrl}">
    <KeepTogether>true</KeepTogether>
    <Visibility><Hidden>${escapeXml(expr)}</Hidden></Visibility>
    <Top>0cm</Top><Left>0cm</Left><Height>0.5cm</Height><Width>0.5cm</Width>
    <Style><BackgroundColor>${rectColor}</BackgroundColor></Style>
</Rectangle>`;
        const tbDoc = parser.parseFromString(simpleXml, "text/xml");
        const tbNode = doc.importNode(tbDoc.documentElement, true);
        reportItems.insertBefore(tbNode, reportItems.firstChild);

        // --- OPCIONAL: ENVOLVER TODO EL CUERPO EN UNA TABLA MASTER ---
        if (groupBody) {
            const itemsToMove: any[] = [];
            for (let i = 0; i < reportItems.childNodes.length; i++) {
                const node = reportItems.childNodes[i];
                if (node.nodeType === 1) { // Guardar elementos actuales
                    itemsToMove.push(node);
                }
            }

            // Crear Tablix agrupada por el campo de cabecera
            const masterTablixXml = `<Tablix Name="BTC_Master_Group_Body" xmlns="${nsUrl}">
    <TablixBody>
        <TablixColumns><TablixColumn><Width>${bodyWidth}</Width></TablixColumn></TablixColumns>
        <TablixRows><TablixRow><Height>1cm</Height><TablixCells><TablixCell><CellContents>
            <Rectangle Name="BTC_Body_Container">
                <ReportItems></ReportItems>
                <KeepTogether>true</KeepTogether>
                <PageBreak><BreakLocation>${pageBreakLocation === 'None' ? 'None' : 'End'}</BreakLocation></PageBreak>
                <Style><Border><Style>None</Style></Border></Style>
            </Rectangle>
        </CellContents></TablixCell></TablixCells></TablixRow></TablixRows>
    </TablixBody>
    <TablixColumnHierarchy><TablixMembers><TablixMember /></TablixMembers></TablixColumnHierarchy>
    <TablixRowHierarchy><TablixMembers><TablixMember>
        <Group Name="BTC_MasterGroup">
            <GroupExpressions><GroupExpression>=Fields!${groupField}.Value</GroupExpression></GroupExpressions>
            <PageBreak><BreakLocation>${pageBreakLocation}</BreakLocation></PageBreak>
        </Group>
    </TablixMember></TablixMembers></TablixRowHierarchy>
    <DataSetName>${primaryDataSet}</DataSetName>
    <Top>0cm</Top><Left>0cm</Left><Height>1cm</Height><Width>${bodyWidth}</Width>
    <Style><Border><Style>None</Style></Border></Style>
</Tablix>`;
            const masterDoc = parser.parseFromString(masterTablixXml, "text/xml");
            const masterNode = doc.importNode(masterDoc.documentElement, true);
            const containerItems = masterNode.getElementsByTagName("ReportItems")[0];

            // Trasladar todos los elementos al nuevo contenedor Master
            itemsToMove.forEach(item => {
                containerItems.appendChild(item);
            });

            // Limpiar el cuerpo original y dejar solo la tabla Master
            while (reportItems.firstChild) {
                reportItems.removeChild(reportItems.firstChild);
            }
            reportItems.appendChild(masterNode);
        }
    }

    // --- 6. TRANSFORMACIÓN DE EXPRESIONES EN EL HEADER (GETDATA) ---
    for (let i = 0; i < valueNodes.length; i++) {
        const node = valueNodes[i];
        
        // Ignorar imágenes (Logos)
        let isImage = false;
        let parent = node.parentNode;
        while (parent) {
            if (parent.nodeName === "Image") {
                isImage = true;
                break;
            }
            parent = parent.parentNode;
        }
        if (isImage) continue;

        let text = node.textContent || "";
        if (text.includes("Fields!")) {
            let matchedFields: string[] = [];
            fields.forEach((f, idx) => {
                const repl = `Code.GetData(${idx + 1}, 1)`;
                
                // Sustituir patrones First(...) para evitar errores de SSRS
                const firstRegex = new RegExp(`First\\(Fields!${f}\\.Value,\\s*"[^"]*"\\)`, 'g');
                if (firstRegex.test(text)) {
                    text = text.replace(firstRegex, repl);
                    if (!matchedFields.includes(f)) matchedFields.push(f);
                }

                // Sustituir patrones simples Fields!Field.Value
                const simpleSearch = `Fields!${f}.Value`;
                if (text.includes(simpleSearch)) {
                    text = text.split(simpleSearch).join(repl);
                    if (!matchedFields.includes(f)) matchedFields.push(f);
                }
            });
            node.textContent = text;
            
            // Añadir etiquetas visuales (Labels) para facilitar la edición en Report Builder
            if (matchedFields.length > 0 && node.parentNode && node.parentNode.nodeName === "TextRun") {
                let textRun = node.parentNode;
                let labelNode = null;
                for (let j = 0; j < textRun.childNodes.length; j++) {
                    if (textRun.childNodes[j].nodeName === "Label") {
                        labelNode = textRun.childNodes[j];
                        break;
                    }
                }
                if (!labelNode) {
                    labelNode = doc.createElementNS(nsUrl, "Label");
                    textRun.insertBefore(labelNode, node);
                }
                if (!labelNode.textContent) {
                    labelNode.textContent = matchedFields.join(" + ");
                }
            }
        }
    }

    // --- 7. SERIALIZACIÓN FINAL ---
    const serializer = new XMLSerializer();
    let finalXml = serializer.serializeToString(doc);
    
    // Asegurar que mantenemos la declaración XML
    if (!finalXml.startsWith("<?xml")) {
        finalXml = '<?xml version="1.0" encoding="utf-8"?>\n' + finalXml;
    }

    return { xml: finalXml, fields, groupField };
}
