using System;
using System.Collections.Generic;
using System.Drawing;
using System.Linq;
using System.Windows.Forms;

namespace SmartEasyBIM.Revit
{
    /// <summary>
    /// Publicar no CDE: conexão (endereço, e-mail e senha), empreendimento, documento (existente ou
    /// novo), opções do IFC e se compartilha depois de enviar. Lembra as escolhas de cada projeto.
    /// </summary>
    internal sealed class PublishDialog : Form
    {
        private static readonly string[][] Disciplinas =
        {
            new[] { "AR", "Arquitetura" }, new[] { "ES", "Estrutura" }, new[] { "EL", "Elétrica" }, new[] { "HD", "Hidráulica" },
            new[] { "IN", "Incêndio" }, new[] { "AC", "Ar condicionado" }, new[] { "GS", "Gás" }, new[] { "TC", "Telecom" },
            new[] { "MP", "Instalações (várias)" }, new[] { "ZZ", "Geral" },
        };
        private static readonly string[][] Finalidades =
        {
            new[] { "S1", "S1 — Para coordenação" }, new[] { "S2", "S2 — Para informação" }, new[] { "S3", "S3 — Para revisão e comentários" }, new[] { "S4", "S4 — Para aprovação" },
        };

        private readonly CdeClient _cde;
        private readonly CdeLink _saved;
        private readonly TextBox _url = new TextBox(), _email = new TextBox(), _senha = new TextBox { UseSystemPasswordChar = true };
        private readonly Label _who = new Label { AutoSize = true };
        private readonly Button _login = new Button { Text = "Entrar", Width = 90 }, _logout = new Button { Text = "Sair", Width = 70 };
        private readonly ComboBox _emp = new ComboBox { DropDownStyle = ComboBoxStyle.DropDownList, Width = 420 };
        private readonly ComboBox _doc = new ComboBox { DropDownStyle = ComboBoxStyle.DropDownList, Width = 420 };
        private readonly TextBox _titulo = new TextBox { Width = 260 }, _nivel = new TextBox { Width = 50, Text = "ZZ" };
        private readonly ComboBox _disc = new ComboBox { DropDownStyle = ComboBoxStyle.DropDownList, Width = 150 };
        private readonly RadioButton _ifc2x3 = new RadioButton { Text = "IFC 2x3 (Coordination View)", AutoSize = true, Checked = true };
        private readonly RadioButton _ifc4 = new RadioButton { Text = "IFC4 (Reference View)", AutoSize = true };
        private readonly CheckBox _onlyView = new CheckBox { Text = "Só os elementos visíveis na vista 3D atual", AutoSize = true };
        private readonly CheckBox _share = new CheckBox { Text = "Compartilhar depois de enviar", AutoSize = true, Checked = true };
        private readonly ComboBox _fin = new ComboBox { DropDownStyle = ComboBoxStyle.DropDownList, Width = 230 };
        private readonly TextBox _desc = new TextBox { Width = 420 };
        private readonly Label _status = new Label { AutoSize = true, ForeColor = Color.DarkRed, MaximumSize = new Size(520, 0) };
        private readonly Button _ok = new Button { Text = "Publicar", Width = 110 };
        private readonly Panel _novoPanel = new FlowLayoutPanel { AutoSize = true, WrapContents = false };
        private List<CdeDoc> _docs = new List<CdeDoc>();

        public long EmpId { get; private set; }
        public string EmpNome { get; private set; }
        public CdeDoc Documento { get; private set; }
        public bool NovoDocumento => _doc.SelectedIndex == 0;
        public string NovoTitulo => _titulo.Text.Trim();
        public string NovaDisciplina => Disciplinas[Math.Max(0, _disc.SelectedIndex)][0];
        public string NovoNivel => _nivel.Text.Trim();
        public bool Ifc4 => _ifc4.Checked;
        public bool OnlyView => _onlyView.Checked;
        public bool Share => _share.Checked;
        public string Finalidade => Finalidades[Math.Max(0, _fin.SelectedIndex)][0];
        public string Descricao => _desc.Text.Trim();

        public PublishDialog(CdeClient cde, CdeLink saved, bool has3dView, string projectTitle)
        {
            _cde = cde;
            _saved = saved;
            Text = "SmartEasyBIM — Publicar no CDE";
            StartPosition = FormStartPosition.CenterScreen;
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = MinimizeBox = false;
            AutoSize = true;
            AutoSizeMode = AutoSizeMode.GrowAndShrink;
            Font = new Font("Segoe UI", 9f);
            Padding = new Padding(12);

            var root = new TableLayoutPanel { ColumnCount = 2, AutoSize = true, Dock = DockStyle.Fill };
            root.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
            root.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
            void Row(string label, Control c)
            {
                root.Controls.Add(new Label { Text = label, AutoSize = true, Margin = new Padding(0, 7, 8, 0) });
                root.Controls.Add(c);
            }
            void Title(string t)
            {
                var l = new Label { Text = t, AutoSize = true, Font = new Font(Font, FontStyle.Bold), Margin = new Padding(0, 12, 0, 2) };
                root.Controls.Add(l);
                root.SetColumnSpan(l, 2);
            }

            Title("Servidor do CDE");
            _url.Width = 420;
            _url.Text = cde.Url;
            Row("Endereço", _url);
            _email.Width = 260;
            _email.Text = cde.UserEmail ?? "";
            Row("E-mail", _email);
            var loginRow = new FlowLayoutPanel { AutoSize = true, WrapContents = false };
            _senha.Width = 160;
            loginRow.Controls.AddRange(new Control[] { _senha, _login, _who, _logout });
            Row("Senha", loginRow);
            _login.Click += (s, e) => DoLogin();
            _logout.Click += (s, e) =>
            {
                _cde.Logout();
                RefreshLogin();
            };

            Title($"Destino de \"{projectTitle}\"");
            Row("Empreendimento", _emp);
            Row("Documento", _doc);
            foreach (var d in Disciplinas) _disc.Items.Add($"{d[0]} — {d[1]}");
            _disc.SelectedIndex = 0;
            _novoPanel.Controls.AddRange(new Control[] { new Label { Text = "Título", AutoSize = true, Margin = new Padding(0, 7, 4, 0) }, _titulo, _disc, new Label { Text = "Nível", AutoSize = true, Margin = new Padding(8, 7, 4, 0) }, _nivel });
            Row("", _novoPanel);
            _titulo.Text = projectTitle;
            _emp.SelectedIndexChanged += (s, e) => LoadDocs();
            _doc.SelectedIndexChanged += (s, e) => _novoPanel.Visible = _doc.SelectedIndex == 0;

            Title("Exportação IFC");
            var ver = new FlowLayoutPanel { AutoSize = true, WrapContents = false };
            ver.Controls.AddRange(new Control[] { _ifc2x3, _ifc4 });
            Row("Versão", ver);
            _onlyView.Enabled = has3dView;
            Row("", _onlyView);
            Row("", new Label { Text = "Sai com as coordenadas compartilhadas e os GUIDs fixos dos elementos (para comparar revisões no CDE).", AutoSize = true, ForeColor = Color.DimGray, MaximumSize = new Size(440, 0) });

            Title("Depois de enviar");
            foreach (var f in Finalidades) _fin.Items.Add(f[1]);
            _fin.SelectedIndex = 0;
            var share = new FlowLayoutPanel { AutoSize = true, WrapContents = false };
            share.Controls.AddRange(new Control[] { _share, _fin });
            Row("", share);
            Row("Descrição", _desc);

            var buttons = new FlowLayoutPanel { AutoSize = true, FlowDirection = FlowDirection.RightToLeft, Dock = DockStyle.Fill, Margin = new Padding(0, 12, 0, 0) };
            var cancel = new Button { Text = "Cancelar", DialogResult = DialogResult.Cancel, Width = 90 };
            buttons.Controls.AddRange(new Control[] { _ok, cancel });
            root.Controls.Add(_status);
            root.SetColumnSpan(_status, 2);
            root.Controls.Add(buttons);
            root.SetColumnSpan(buttons, 2);
            Controls.Add(root);
            CancelButton = cancel;
            _ok.Click += (s, e) => Confirm();

            if (saved != null)
            {
                _ifc4.Checked = saved.Ifc4;
                _ifc2x3.Checked = !saved.Ifc4;
                _onlyView.Checked = saved.OnlyView && has3dView;
                _share.Checked = saved.Share;
                _fin.SelectedIndex = Math.Max(0, Array.FindIndex(Finalidades, f => f[0] == saved.Finalidade));
            }
            Shown += (s, e) => RefreshLogin();
        }

        private void Busy(Action a)
        {
            Cursor = Cursors.WaitCursor;
            _status.Text = "";
            try
            {
                a();
            }
            catch (Exception ex)
            {
                _status.Text = ex.Message;
            }
            finally
            {
                Cursor = Cursors.Default;
            }
        }

        private void DoLogin() => Busy(() =>
        {
            _cde.Login(_url.Text, _email.Text.Trim(), _senha.Text);
            _senha.Text = "";
            RefreshLogin();
        });

        private void RefreshLogin()
        {
            bool on = _cde.LoggedIn;
            _who.Text = on ? $"Conectado como {_cde.UserName}" : "";
            _who.Margin = new Padding(8, 7, 0, 0);
            _senha.Visible = _login.Visible = !on;
            _logout.Visible = on;
            _url.Enabled = _email.Enabled = !on;
            _emp.Enabled = _doc.Enabled = _ok.Enabled = on;
            _emp.Items.Clear();
            _doc.Items.Clear();
            if (!on) return;
            Busy(() =>
            {
                var list = _cde.Empreendimentos();
                foreach (var e in list) _emp.Items.Add(new Item(e.Key, e.Value));
                int idx = _saved != null ? list.FindIndex(e => e.Key == _saved.EmpId) : -1;
                if (_emp.Items.Count > 0) _emp.SelectedIndex = Math.Max(0, idx);
                if (_emp.Items.Count == 0) _status.Text = "Nenhum empreendimento no CDE: crie um pela página do CDE.";
            });
        }

        private void LoadDocs()
        {
            _doc.Items.Clear();
            _doc.Items.Add("(novo documento — modelo 3D)");
            if (!(_emp.SelectedItem is Item emp)) return;
            Busy(() =>
            {
                _docs = _cde.Documentos(emp.Id).Where(d => d.Estado != "arquivado").ToList();
                // Modelos 3D primeiro; os demais (pranchas, planilhas) também podem receber o IFC.
                foreach (var d in _docs.OrderBy(d => d.Tipo == "M3" ? 0 : 1).ThenBy(d => d.Codigo)) _doc.Items.Add(d);
                int idx = _saved != null && _saved.EmpId == emp.Id ? _doc.Items.Cast<object>().ToList().FindIndex(o => o is CdeDoc d && d.Id == _saved.DocId) : -1;
                _doc.SelectedIndex = idx > 0 ? idx : 0;
            });
            _novoPanel.Visible = _doc.SelectedIndex == 0;
        }

        private void Confirm()
        {
            if (!(_emp.SelectedItem is Item emp)) return;
            if (NovoDocumento && string.IsNullOrWhiteSpace(NovoTitulo))
            {
                _status.Text = "Informe o título do novo documento.";
                return;
            }
            EmpId = emp.Id;
            EmpNome = emp.Name;
            Documento = _doc.SelectedItem as CdeDoc;
            DialogResult = DialogResult.OK;
            Close();
        }

        private sealed class Item
        {
            public readonly long Id;
            public readonly string Name;
            public Item(long id, string name) { Id = id; Name = name; }
            public override string ToString() => Name;
        }
    }
}
