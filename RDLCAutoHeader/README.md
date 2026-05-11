# RDLC Auto Header PRO 🚀

**Solución Enterprise para la persistencia de datos en encabezados de Business Central.**

## 📑 Índice
- [El Desafío Técnico](#-el-desafío-técnico)
- [La Solución: SetData / GetData](#-la-solución-setdata--getdata)
- [Guía de Uso Profesional](#-guía-de-uso-profesional)
- [Características Avanzadas](#-características-avanzadas)
- [Créditos](#-créditos)

---

## 🏗️ El Desafío Técnico
En el desarrollo de informes RDLC para **Microsoft Dynamics 365 Business Central**, surge un problema crítico al manejar documentos con múltiples páginas (como la impresión masiva de facturas). 

El motor de renderizado de SSRS pierde la referencia del contexto de datos en el encabezado (Header) al cambiar de registro en el cuerpo. Esto provoca que el encabezado muestre datos estáticos (normalmente del primer registro del DataSet) en todas las páginas, independientemente de qué factura se esté visualizando en ese momento.

## 💡 La Solución: SetData / GetData
**RDLC Auto Header PRO** automatiza la implementación del patrón de diseño más robusto para solucionar este problema:

1.  **Inyección de Código VB.NET:** Añade un módulo global de código al informe que gestiona un diccionario de datos dinámico.
2.  **Serialización de Expresiones:** Transforma automáticamente las expresiones del encabezado `Fields!Campo.Value` en llamadas seguras a `Code.GetData(índice, 1)`.
3.  **Sincronización mediante Master Tablix:** Crea un elemento de control invisible (un Tablix de agrupación) en el cuerpo del informe. Este elemento invoca la función `Code.SetData` en cada cambio de grupo, asegurando que el encabezado se actualice en tiempo real para cada nuevo documento.

---

## 🛠️ Guía de Uso Profesional

### Opción A: Procesamiento Masivo (Recomendado)
1. Abra la pestaña lateral de la extensión **RDLC Auto Header**.
2. Utilice el botón **"DETECTAR TODOS EN PROYECTO"** para escanear su espacio de trabajo.
3. Seleccione los archivos específicos que desea transformar mediante los checkboxes.
4. Pulse **"INICIAR PROCESO"**.

### Opción B: Procesamiento Individual
1. En el explorador de archivos, haga clic derecho sobre un archivo `.rdlc`.
2. Seleccione **"RDLC Auto Header: Inyectar SetData"**.

---

## 🚀 Características Avanzadas (v1.6.3)
*   **Limpieza de Expresiones:** Elimina automáticamente funciones redundantes como `First()` para optimizar el rendimiento.
*   **Control de Paginación:** Configure ubicaciones de salto de página (Inicio, Fin, Entre) directamente desde la UI.
*   **Multi-DataSet Support:** Defina el DataSet principal para informes complejos con múltiples orígenes de datos.
*   **Interfaz Glassmorphism:** Panel moderno y responsive integrado en VS Code.

---

## 💜 Créditos
Desarrollado por **[Alvaro Robles](https://github.com/roblesgg)** ([LinkedIn](https://www.linkedin.com/in/alvaro-robles-gonzález-bbb017240/)) para elevar la calidad y eficiencia en el ecosistema de Business Central.

**Agradecimientos Especiales:**
*   **[Junpeng Jin](https://www.linkedin.com/in/junpeng-jin-9587832b4/)**: Por su exhaustivo testing, QA y feedback fundamental para convertir esta herramienta en una solución de nivel Enterprise.

---
*Enterprise Edition • v1.7.1*
