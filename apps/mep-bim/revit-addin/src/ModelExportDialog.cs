using System.Collections.Generic;
using System.Drawing;
using System.Linq;
using System.Windows.Forms;

namespace SmartEasyBIM.Revit
{
    /// <summary>Escolha das categorias do modelo a exportar (arquitetura e estrutura já marcadas).</summary>
    internal sealed class ModelExportDialog : Form
    {
        private readonly ListView _list = new ListView();
        private readonly CheckBox _params = new CheckBox();
        private readonly Label _count = new Label();

        public HashSet<long> Selected => new HashSet<long>(_list.Items.Cast<ListViewItem>().Where(i => i.Checked).Select(i => ((CategoryEntry)i.Tag).Id));
        public bool InstanceParams => _params.Checked;

        public ModelExportDialog(IList<CategoryEntry> categories)
        {
            Text = "SmartEasyBIM — Exportar modelo";
            StartPosition = FormStartPosition.CenterScreen;
            Size = new Size(560, 600);
            MinimumSize = new Size(420, 360);
            Font = new Font("Segoe UI", 9f);

            var info = new Label
            {
                Dock = DockStyle.Top,
                Height = 52,
                Padding = new Padding(10, 10, 10, 0),
                Text = "Elementos, famílias, tipos, categorias e parâmetros, com a geometria, níveis, ambientes, eixos e coordenadas. " +
                       "Plantas, vistas e folhas não são exportadas (o SmartEasyBIM monta as suas).",
            };

            _list.Dock = DockStyle.Fill;
            _list.View = View.Details;
            _list.CheckBoxes = true;
            _list.FullRowSelect = true;
            _list.Columns.Add("Categoria", 360);
            _list.Columns.Add("Elementos", 90, HorizontalAlignment.Right);
            foreach (var c in categories)
                _list.Items.Add(new ListViewItem(new[] { c.Name, c.Count.ToString() }) { Tag = c, Checked = c.Default });
            _list.ItemChecked += (s, e) => UpdateCount();

            var bottom = new FlowLayoutPanel { Dock = DockStyle.Bottom, Height = 80, FlowDirection = FlowDirection.RightToLeft, Padding = new Padding(8) };
            var export = new Button { Text = "Exportar…", DialogResult = DialogResult.OK, Width = 110 };
            var cancel = new Button { Text = "Cancelar", DialogResult = DialogResult.Cancel, Width = 90 };
            var all = new Button { Text = "Marcar todas", Width = 110 };
            var none = new Button { Text = "Desmarcar", Width = 100 };
            all.Click += (s, e) => SetAll(true);
            none.Click += (s, e) => SetAll(false);
            bottom.Controls.AddRange(new Control[] { export, cancel, none, all });
            _params.Text = "Incluir os parâmetros de cada elemento (os de tipo sempre vão)";
            _params.Checked = true;
            _params.AutoSize = true;
            _params.Margin = new Padding(0, 8, 20, 0);
            bottom.Controls.Add(_params);
            _count.AutoSize = true;
            _count.Margin = new Padding(0, 8, 20, 0);
            bottom.Controls.Add(_count);
            AcceptButton = export;
            CancelButton = cancel;

            Controls.Add(_list);
            Controls.Add(info);
            Controls.Add(bottom);
            UpdateCount();
        }

        private void SetAll(bool on)
        {
            foreach (ListViewItem i in _list.Items) i.Checked = on;
            UpdateCount();
        }

        private void UpdateCount()
        {
            int n = _list.Items.Cast<ListViewItem>().Where(i => i.Checked).Sum(i => ((CategoryEntry)i.Tag).Count);
            _count.Text = $"{n} elementos marcados";
        }
    }
}
