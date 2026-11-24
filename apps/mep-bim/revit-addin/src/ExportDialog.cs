using System;
using System.Collections.Generic;
using System.Drawing;
using System.Linq;
using System.Windows.Forms;

namespace SmartEasyBIM.Revit
{
    internal sealed class FamilyEntry
    {
        public string Name;
        public string Category;
        public string BuiltInCategory;
        public int TypeCount;
        public bool IsMep;
        public object Tag;
    }

    /// <summary>Escolha das famílias carregadas no projeto a exportar.</summary>
    internal sealed class ExportDialog : Form
    {
        private readonly List<FamilyEntry> _all;
        private readonly HashSet<FamilyEntry> _checked = new HashSet<FamilyEntry>();
        private readonly ListView _list = new ListView();
        private readonly TextBox _filter = new TextBox();
        private readonly CheckBox _mepOnly = new CheckBox();
        private readonly Label _count = new Label();
        private bool _refreshing;

        public IList<FamilyEntry> Selected => _all.Where(_checked.Contains).ToList();

        public ExportDialog(IList<FamilyEntry> families)
        {
            _all = families.OrderBy(f => f.Category).ThenBy(f => f.Name).ToList();
            foreach (var f in _all.Where(f => f.IsMep)) _checked.Add(f);

            Text = "SmartEasyBIM — Exportar famílias";
            StartPosition = FormStartPosition.CenterScreen;
            Size = new Size(720, 560);
            MinimumSize = new Size(520, 360);
            Font = new Font("Segoe UI", 9f);

            var top = new FlowLayoutPanel { Dock = DockStyle.Top, Height = 38, Padding = new Padding(8, 8, 8, 0), WrapContents = false };
            top.Controls.Add(new Label { Text = "Buscar:", AutoSize = true, Margin = new Padding(0, 6, 4, 0) });
            _filter.Width = 260;
            _filter.TextChanged += (s, e) => Fill();
            top.Controls.Add(_filter);
            _mepOnly.Text = "Só categorias MEP";
            _mepOnly.Checked = true;
            _mepOnly.AutoSize = true;
            _mepOnly.Margin = new Padding(16, 5, 0, 0);
            _mepOnly.CheckedChanged += (s, e) => Fill();
            top.Controls.Add(_mepOnly);

            _list.Dock = DockStyle.Fill;
            _list.View = View.Details;
            _list.CheckBoxes = true;
            _list.FullRowSelect = true;
            _list.Columns.Add("Família", 330);
            _list.Columns.Add("Categoria", 230);
            _list.Columns.Add("Tipos", 60, HorizontalAlignment.Right);
            _list.ItemChecked += (s, e) =>
            {
                if (_refreshing) return;
                var f = (FamilyEntry)e.Item.Tag;
                if (e.Item.Checked) _checked.Add(f); else _checked.Remove(f);
                UpdateCount();
            };

            var bottom = new FlowLayoutPanel { Dock = DockStyle.Bottom, Height = 46, FlowDirection = FlowDirection.RightToLeft, Padding = new Padding(8) };
            var export = new Button { Text = "Exportar…", DialogResult = DialogResult.OK, Width = 110 };
            var cancel = new Button { Text = "Cancelar", DialogResult = DialogResult.Cancel, Width = 90 };
            var all = new Button { Text = "Marcar visíveis", Width = 120 };
            var none = new Button { Text = "Desmarcar", Width = 100 };
            all.Click += (s, e) => SetVisible(true);
            none.Click += (s, e) => SetVisible(false);
            bottom.Controls.AddRange(new Control[] { export, cancel, none, all });
            _count.AutoSize = true;
            _count.Margin = new Padding(0, 8, 20, 0);
            bottom.Controls.Add(_count);
            AcceptButton = export;
            CancelButton = cancel;

            Controls.Add(_list);
            Controls.Add(top);
            Controls.Add(bottom);
            Fill();
        }

        private IEnumerable<FamilyEntry> VisibleEntries()
        {
            var q = _filter.Text.Trim();
            return _all.Where(f =>
                (!_mepOnly.Checked || f.IsMep) &&
                (q.Length == 0 ||
                 f.Name.IndexOf(q, StringComparison.CurrentCultureIgnoreCase) >= 0 ||
                 (f.Category ?? "").IndexOf(q, StringComparison.CurrentCultureIgnoreCase) >= 0));
        }

        private void Fill()
        {
            _refreshing = true;
            _list.BeginUpdate();
            _list.Items.Clear();
            foreach (var f in VisibleEntries())
            {
                var item = new ListViewItem(new[] { f.Name, f.Category ?? "", f.TypeCount.ToString() }) { Tag = f, Checked = _checked.Contains(f) };
                _list.Items.Add(item);
            }
            _list.EndUpdate();
            _refreshing = false;
            UpdateCount();
        }

        private void SetVisible(bool on)
        {
            foreach (var f in VisibleEntries())
            {
                if (on) _checked.Add(f); else _checked.Remove(f);
            }
            Fill();
        }

        private void UpdateCount()
        {
            int n = _checked.Count;
            _count.Text = n == 1 ? "1 família marcada" : $"{n} famílias marcadas";
        }
    }
}
