import re
import os
import xml.etree.ElementTree as ET
import tkinter as tk
from tkinter import filedialog, messagebox
import json
import tkinter.font as tkfont

NS_URL = "http://schemas.microsoft.com/sqlserver/reporting/2016/01/reportdefinition"
RD_URL = "http://schemas.microsoft.com/SQLServer/reporting/reportdesigner"
AM_URL = "http://schemas.microsoft.com/sqlserver/reporting/authoringmetadata"
DF_URL = "http://schemas.microsoft.com/sqlserver/reporting/2016/01/reportdefinition/defaultfontfamily"

NS = {'': NS_URL, 'rd': RD_URL, 'am': AM_URL, 'df': DF_URL}

ET.register_namespace('', NS_URL)
ET.register_namespace('rd', RD_URL)
ET.register_namespace('am', AM_URL)
ET.register_namespace('df', DF_URL)

CONFIG_FILE = "rdlc_config.json"

class RDLCAutoHeaderApp:
    def __init__(self, root):
        self.root = root
        self.root.title("RDLCAutoHeader Pro")
        self.root.geometry("650x550")
        self.root.configure(bg="#1E1E2E")
        self.root.resizable(False, False)
        self.rdlc_files = []
        self.output_dir = ""
        self.last_input_dir = ""
        self.use_mod_suffix = tk.BooleanVar(value=True)
        self.setup_ui()
        self.load_config()
        
    def load_config(self):
        try:
            if os.path.exists(CONFIG_FILE):
                with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    self.last_input_dir = data.get("input_dir", "")
                    self.output_dir = data.get("output_dir", "")
                    if "use_mod_suffix" in data:
                        self.use_mod_suffix.set(data["use_mod_suffix"])
                    if self.output_dir:
                        self.lbl_dir.config(text=self.output_dir)
        except Exception:
            pass

    def save_config(self):
        try:
            with open(CONFIG_FILE, 'w', encoding='utf-8') as f:
                json.dump({
                    "input_dir": self.last_input_dir, 
                    "output_dir": self.output_dir,
                    "use_mod_suffix": self.use_mod_suffix.get()
                }, f)
        except Exception:
            pass
        
    def setup_ui(self):
        tf = tkfont.Font(family="Segoe UI", size=18, weight="bold")
        bf = tkfont.Font(family="Segoe UI", size=10, weight="bold")
        
        tk.Label(self.root, text="⚡ RDLCAutoHeader Pro", font=tf, bg="#1E1E2E", fg="#CBA6F7").pack(pady=(25, 15))
        
        frame = tk.Frame(self.root, bg="#1E1E2E")
        frame.pack(fill=tk.X, padx=40)
        
        # Archivos
        self.btn_files = tk.Button(frame, text="📄 Seleccionar RDLCs...", font=bf, bg="#89B4FA", fg="#11111B", 
                                   command=self.select_files, relief=tk.FLAT, pady=10, cursor="hand2")
        self.btn_files.pack(fill=tk.X, pady=5)
        self.lbl_files = tk.Label(frame, text="Ningún archivo seleccionado", bg="#1E1E2E", fg="#A6ADC8", font=("Segoe UI", 9))
        self.lbl_files.pack(pady=(0,15))
        
        # Directorio
        self.btn_dir = tk.Button(frame, text="📁 Carpeta de Destino...", font=bf, bg="#89B4FA", fg="#11111B", 
                                 command=self.select_dir, relief=tk.FLAT, pady=10, cursor="hand2")
        self.btn_dir.pack(fill=tk.X, pady=5)
        self.lbl_dir = tk.Label(frame, text="Ninguna carpeta seleccionada", bg="#1E1E2E", fg="#A6ADC8", font=("Segoe UI", 9))
        self.lbl_dir.pack(pady=(0,10))
        
        # Checkbox Sufijo MOD
        self.chk_mod = tk.Checkbutton(frame, text="Añadir sufijo '_MOD' (Desmarcar para Sobrescribir)",
                                      variable=self.use_mod_suffix, bg="#1E1E2E", fg="#A6ADC8",
                                      selectcolor="#181825", activebackground="#1E1E2E", activeforeground="#CDD6F4",
                                      font=("Segoe UI", 10), command=self.save_config)
        self.chk_mod.pack(pady=(0, 10))
        
        # Boton Procesar
        self.btn_run = tk.Button(self.root, text="🚀 INYECTAR MAGIA RDLC", font=tkfont.Font(family="Segoe UI", size=12, weight="bold"), 
                                 bg="#A6E3A1", fg="#11111B", command=self.process, relief=tk.FLAT, padx=20, pady=12, cursor="hand2")
        self.btn_run.pack(pady=10)
        
        # Log
        self.txt_log = tk.Text(self.root, height=8, bg="#181825", fg="#CDD6F4", font=("Consolas", 10), 
                               relief=tk.FLAT, padx=15, pady=15, highlightthickness=0)
        self.txt_log.pack(fill=tk.X, padx=40, pady=10)
        self.txt_log.insert(tk.END, "Esperando acciones...\n")
        self.txt_log.config(state=tk.DISABLED)

    def log(self, text, color="#CDD6F4"):
        self.txt_log.config(state=tk.NORMAL)
        self.txt_log.insert(tk.END, text + "\n")
        self.txt_log.see(tk.END)
        self.txt_log.config(state=tk.DISABLED)

    def select_files(self):
        f = filedialog.askopenfilenames(
            title="Selecciona los RDLC originales", 
            filetypes=[("Reportes RDLC", "*.rdlc")],
            initialdir=self.last_input_dir if self.last_input_dir else None
        )
        if f:
            self.rdlc_files = list(f)
            self.lbl_files.config(text=f"{len(f)} archivos seleccionados")
            self.last_input_dir = os.path.dirname(f[0])
            self.save_config()
            self.log(f"Seleccionados: {len(f)} archivos.")

    def select_dir(self):
        d = filedialog.askdirectory(
            title="Selecciona la carpeta de destino",
            initialdir=self.output_dir if self.output_dir else self.last_input_dir
        )
        if d:
            self.output_dir = d
            self.lbl_dir.config(text=d)
            self.save_config()
            self.log(f"Destino: {d}")

    def process(self):
        if not self.rdlc_files or not self.output_dir:
            messagebox.showwarning("Atención", "Debes seleccionar archivos y una carpeta de destino.")
            return

        self.log("\n--- Iniciando Procesamiento ---")
        for rdlc in self.rdlc_files:
            self.process_file(rdlc)
            
        self.log("✅ Fin de proceso.")

    def process_file(self, rdlc_path):
        fname = os.path.basename(rdlc_path)
        try:
            tree = ET.parse(rdlc_path)
            report = tree.getroot()

            header = report.find('.//PageHeader', NS)
            if header is None: return self.log(f"[-] {fname}: Sin Header")

            # 1. Extraer campos del Header
            fields = []
            for v in header.findall('.//Value', NS):
                if v.text and "Fields!" in v.text:
                    for f in re.findall(r'Fields!([a-zA-Z0-9_]+)\.Value', v.text):
                        if f not in fields: fields.append(f)

            if not fields: return self.log(f"[!] {fname}: Sin campos en cabecera")

            # 2. Inyectar / Actualizar Code Block (SetData / GetData)
            code = report.find('Code', NS)
            if code is None: code = ET.SubElement(report, '{' + NS_URL + '}Code')
            c_text = code.text or ""
            
            if "Function SetData" not in c_text:
                code.text = c_text + '\nShared Data1 as Object\nPublic Function GetData(N as Integer, G as integer) as Object\n If G=1 Then Return Cstr(Choose(N, Split(Cstr(Data1),Chr(177))))\n End If\nEnd Function\nPublic Function SetData(D as Object, G as integer)\n If G=1 Then Data1=D\n End If\n Return True\nEnd Function\n'

            # 3. Preparar la expresión
            expr = "=Code.SetData(" + " + Chr(177) + ".join([f"Cstr(Fields!{f}.Value)" for f in fields]) + ", 1)"

            # 4. Encontrar campo de Agrupación y nombre del DataSet
            dataset_name = "DataSet_Result"
            ds_node = report.find('.//DataSet', NS)
            if ds_node is not None and ds_node.get('Name'):
                dataset_name = ds_node.get('Name')

            all_fields = []
            if ds_node is not None:
                for fld in ds_node.findall('.//Field', NS):
                    field_name = fld.get('Name')
                    if field_name: all_fields.append(field_name)
            
            group_field = ""
            for f in all_fields:
                if f.upper() in ["NO_", "DOCUMENTNO", "DOCUMENT_NO", "ORDERNO", "ORDER_NO"]:
                    group_field = f
                    break
            if not group_field:
                for f in all_fields:
                    if "NO_" in f.upper() and "HEADER" in f.upper():
                        group_field = f
                        break
            if not group_field:
                for f in all_fields:
                    if "NO" in f.upper() or "ID" in f.upper():
                        group_field = f
                        break
            if not group_field and all_fields:
                group_field = all_fields[0]
            if not group_field:
                group_field = "No_"

            # 5. Inyectar Tablix Agrupador en Body (con fondo Rojo y Hidden=SetData)
            body = report.find('.//Body/ReportItems', NS)
            if body is not None:
                for c in list(body):
                    if c.get('Name') == "BTC_Master_Inyector": body.remove(c)
                
                xml = f'''<Tablix Name="BTC_Master_Inyector" xmlns="{NS_URL}">
                    <TablixBody>
                        <TablixColumns><TablixColumn><Width>1cm</Width></TablixColumn></TablixColumns>
                        <TablixRows><TablixRow><Height>1cm</Height><TablixCells><TablixCell><CellContents>
                            <Rectangle Name="BTC_Header_Carrier">
                                <KeepTogether>true</KeepTogether>
                                <Visibility><Hidden>{expr}</Hidden></Visibility>
                                <Style><BackgroundColor>Red</BackgroundColor></Style>
                            </Rectangle>
                        </CellContents></TablixCell></TablixCells></TablixRow></TablixRows>
                    </TablixBody>
                    <TablixColumnHierarchy><TablixMembers><TablixMember /></TablixMembers></TablixColumnHierarchy>
                    <TablixRowHierarchy><TablixMembers><TablixMember>
                        <Group Name="BTC_DocGrp">
                            <GroupExpressions><GroupExpression>=Fields!{group_field}.Value</GroupExpression></GroupExpressions>
                        </Group>
                    </TablixMember></TablixMembers></TablixRowHierarchy>
                    <DataSetName>{dataset_name}</DataSetName>
                    <Top>0cm</Top><Left>0cm</Left><Height>1cm</Height><Width>1cm</Width>
                    <Style><Border><Style>None</Style></Border></Style>
                </Tablix>'''
                body.insert(0, ET.fromstring(xml))

            # 6. Modificar Header (sustituir por GetData y poner Etiquetas)
            parent_map = {c: p for p in header.iter() for c in p}
            for v in header.findall('.//Value', NS):
                if v.text and "Fields!" in v.text:
                    matched_fields = []
                    for i, f in enumerate(fields, 1):
                        if f"Fields!{f}.Value" in v.text:
                            v.text = v.text.replace(f"Fields!{f}.Value", f"Code.GetData({i}, 1)")
                            if f not in matched_fields:
                                matched_fields.append(f)
                    
                    if matched_fields:
                        parent = parent_map.get(v)
                        if parent is not None and parent.tag == '{' + NS_URL + '}TextRun':
                            label_node = parent.find('{' + NS_URL + '}Label')
                            if label_node is None:
                                label_node = ET.Element('{' + NS_URL + '}Label')
                                v_index = list(parent).index(v)
                                parent.insert(v_index, label_node)
                            if not label_node.text:
                                label_node.text = " + ".join(matched_fields)

            # Guardar
            if self.use_mod_suffix.get():
                out = os.path.join(self.output_dir, os.path.splitext(fname)[0] + "_MOD.rdlc")
            else:
                out = os.path.join(self.output_dir, fname)
                
            tree.write(out, encoding='utf-8', xml_declaration=True)
            
            # Forzar comillas dobles en la declaración XML
            with open(out, 'r', encoding='utf-8') as f:
                content = f.read()
            content = content.replace("<?xml version='1.0' encoding='utf-8'?>", '<?xml version="1.0" encoding="utf-8"?>')
            with open(out, 'w', encoding='utf-8') as f:
                f.write(content)
                
            self.log(f"\n[+] {fname}: PROCESADO CON ÉXITO")
            self.log(f"   ✔️ Tabla de agrupación creada")
            self.log(f"   ✔️ Agrupado por: {group_field}")
            self.log(f"   ✔️ Rectángulo rojo portador inyectado")
            self.log(f"   ✔️ Variables modificadas:")
            for i, f in enumerate(fields, 1):
                self.log(f"      Fields!{f}.Value  ->  Code.GetData({i}, 1)")
            
        except Exception as e:
            self.log(f"\n[-] {fname}: Error -> {str(e)}")

if __name__ == "__main__":
    root = tk.Tk()
    app = RDLCAutoHeaderApp(root)
    root.mainloop()
