using System;
using System.Collections.Generic;
using System.Drawing;
using System.Linq;
using System.Windows.Forms;
using ExternalEvent = Autodesk.Revit.UI.ExternalEvent;

namespace SmartEasyBIM.Revit
{
    /// <summary>
    /// Interferências do CDE para o modelo aberto (janela que fica aberta ao lado do Revit): lista as
    /// pendências em aberto, mostra cada uma no modelo (seleção + vista 3D com caixa de corte) e
    /// registra o tratamento (comentário, em tratamento, resolvida) direto no CDE.
    /// </summary>
    internal sealed class ClashWindow : Form
    {
        private static readonly Dictionary<string, string> EstadoLabel = new Dictionary<string, string> { { "nova", "Nova" }, { "ativa", "Ativa" }, { "resolvida", "Resolvida" }, { "aprovada", "Aprovada" } };

        private readonly CdeClient _cde;
        private readonly CdeLink _link;
        private readonly ExternalEvent _event;
        private readonly ClashSelector _selector;
        private readonly ListView _list = new ListView { Dock = DockStyle.Fill, View = View.Details, FullRowSelect = true, HideSelection = false, MultiSelect = false };
        private readonly TextBox _history = new TextBox { Multiline = true, ReadOnly = true, ScrollBars = ScrollBars.Vertical, Dock = DockStyle.Fill, BackColor = SystemColors.Window };
        private readonly TextBox _comment = new TextBox { Multiline = true, Dock = DockStyle.Fill };
        private readonly Label _status = new Label { Dock = DockStyle.Bottom, Height = 22, ForeColor = Color.DimGray, Padding = new Padding(6, 4, 6, 0) };
        private readonly Label _header = new Label { AutoSize = true, Font = new Font("Segoe UI", 9.5f, FontStyle.Bold), Margin = new Padding(0, 6, 12, 0) };
        private List<ClashItem> _items = new List<ClashItem>();

        public ClashWindow(CdeClient cde, CdeLink link, ExternalEvent ev, ClashSelector selector)
        {
            _cde = cde;
            _link = link;
            _event = ev;
            _selector = selector;
            Text = "SmartEasyBIM — Interferências (CDE)";
            Size = new Size(980, 560);
            MinimumSize = new Size(700, 380);
            StartPosition = FormStartPosition.CenterScreen;
            Font = new Font("Segoe UI", 9f);
            ShowInTaskbar = false;

            var top = new FlowLayoutPanel { Dock = DockStyle.Top, Height = 36, Padding = new Padding(8, 4, 8, 0), WrapContents = false };
            var refresh = new Button { Text = "Atualizar", Width = 90 };
            refresh.Click += (s, e) => Reload();
            _header.Text = $"{link.EmpNome} · {link.DocCodigo}";
            top.Controls.AddRange(new Control[] { _header, refresh });

            _list.Columns.Add("Nº", 50);
            _list.Columns.Add("Tipo", 70);
            _list.Columns.Add("Elemento deste modelo", 210);
            _list.Columns.Add("Interfere com", 210);
            _list.Columns.Add("Modelo", 170);
            _list.Columns.Add("Pavimento", 90);
            _list.Columns.Add("Medida", 140);
            _list.Columns.Add("Estado", 80);
            _list.SelectedIndexChanged += (s, e) => ShowDetail();
            _list.DoubleClick += (s, e) => GoTo();

            var bottom = new TableLayoutPanel { Dock = DockStyle.Bottom, Height = 150, ColumnCount = 3, Padding = new Padding(8, 4, 8, 4) };
            bottom.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50));
            bottom.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50));
            bottom.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 150));
            bottom.Controls.Add(_history, 0, 0);
            bottom.Controls.Add(_comment, 1, 0);
            var actions = new FlowLayoutPanel { Dock = DockStyle.Fill, FlowDirection = FlowDirection.TopDown, WrapContents = false };
            var ver = new Button { Text = "Ver no modelo", Width = 135 };
            var ativa = new Button { Text = "Em tratamento", Width = 135 };
            var resolvida = new Button { Text = "Resolvida", Width = 135 };
            var comentar = new Button { Text = "Só comentar", Width = 135 };
            ver.Click += (s, e) => GoTo();
            ativa.Click += (s, e) => Update("ativa");
            resolvida.Click += (s, e) => Update("resolvida");
            comentar.Click += (s, e) => Update(null);
            actions.Controls.AddRange(new Control[] { ver, ativa, resolvida, comentar });
            bottom.Controls.Add(actions, 2, 0);
            _comment.Text = "";

            Controls.Add(_list);
            Controls.Add(top);
            Controls.Add(bottom);
            Controls.Add(_status);
            _selector.Report = msg => BeginInvoke(new Action(() => _status.Text = msg));
            Shown += (s, e) => Reload();
        }

        private ClashItem Current => _list.SelectedItems.Count > 0 ? (ClashItem)_list.SelectedItems[0].Tag : null;

        private void Busy(Action a)
        {
            Cursor = Cursors.WaitCursor;
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

        private void Reload() => Busy(() =>
        {
            var keep = Current?.Id;
            _items = _cde.Pendencias(_link.EmpId, _link.DocId);
            _list.BeginUpdate();
            _list.Items.Clear();
            foreach (var c in _items)
            {
                var it = new ListViewItem(new[]
                {
                    "#" + c.Numero,
                    c.Tipo == "colisao" ? "Colisão" : "Folga",
                    $"{c.Mine.Nome} ({c.Mine.Tipo})",
                    $"{c.Other.Nome} ({c.Other.Tipo})",
                    c.Other.Codigo,
                    c.Pavimento ?? "",
                    c.Medida,
                    (EstadoLabel.TryGetValue(c.Estado ?? "", out var l) ? l : c.Estado) + (c.Situacao == "reaberta" ? " (reaberta)" : c.Situacao == "nova" ? " (nova)" : ""),
                }) { Tag = c };
                if (c.Tipo == "colisao") it.ForeColor = Color.FromArgb(185, 28, 28);
                _list.Items.Add(it);
                if (keep == c.Id) it.Selected = true;
            }
            _list.EndUpdate();
            _status.Text = _items.Count == 0
                ? "Nenhuma interferência em aberto para este modelo nas análises do CDE."
                : $"{_items.Count} interferência(s) em aberto · {string.Join(", ", _items.Select(i => i.AnaliseNome).Distinct())}. Duplo clique: ver no modelo.";
            ShowDetail();
        });

        private void ShowDetail()
        {
            var c = Current;
            _history.Text = c == null
                ? ""
                : $"#{c.Numero} · {c.AnaliseNome}\r\n{c.Mine.Nome} × {c.Other.Nome} ({c.Other.Codigo})\r\n" +
                  (c.Responsavel != null ? $"Responsável: {c.Responsavel}\r\n" : "") +
                  (c.Comentarios.Count > 0 ? "\r\n" + string.Join("\r\n", c.Comentarios) : "\r\nSem comentários.");
        }

        private void GoTo()
        {
            var c = Current;
            if (c == null) return;
            _selector.Pending = c;
            _status.Text = $"Mostrando a #{c.Numero} no modelo…";
            _event.Raise();
        }

        private void Update(string estado)
        {
            var c = Current;
            if (c == null) return;
            if (estado == null && string.IsNullOrWhiteSpace(_comment.Text))
            {
                _status.Text = "Escreva o comentário.";
                return;
            }
            Busy(() =>
            {
                _cde.AtualizarInterferencia(c.AnaliseId, c.Id, estado, _comment.Text);
                _comment.Text = "";
                Reload();
                _status.Text = estado == "resolvida" ? $"#{c.Numero} marcada como resolvida no CDE. A próxima análise (com a revisão nova) confirma." : $"#{c.Numero} atualizada no CDE.";
            });
        }
    }
}
