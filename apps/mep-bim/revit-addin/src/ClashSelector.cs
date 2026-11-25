using System;
using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;

namespace SmartEasyBIM.Revit
{
    /// <summary>
    /// Mostra uma interferência no modelo (chamado pelo Revit, via evento externo): acha os elementos
    /// pelo GlobalId do IFC (neste modelo e nos vínculos), abre a vista 3D "SmartEasyBIM —
    /// Interferências" com caixa de corte em volta e seleciona os elementos.
    /// </summary>
    internal sealed class ClashSelector : IExternalEventHandler
    {
        public const string ViewName = "SmartEasyBIM — Interferências";
        private const double Margin = 1.0 / 0.3048; // 1 m em pés

        public ClashItem Pending;
        public Action<string> Report = _ => { };

        // Índice GlobalId → elemento, por documento (refeito quando o documento muda).
        private readonly Dictionary<string, Dictionary<string, ElementId>> _index = new Dictionary<string, Dictionary<string, ElementId>>();
        private readonly Dictionary<string, int> _indexVersion = new Dictionary<string, int>();

        public string GetName() => "SmartEasyBIM — mostrar interferência";

        public void Execute(UIApplication app)
        {
            var c = Pending;
            Pending = null;
            var uidoc = app.ActiveUIDocument;
            if (c == null || uidoc == null) return;
            var doc = uidoc.Document;
            try
            {
                var wanted = new[] { c.Mine?.GlobalId, c.Other?.GlobalId }.Where(g => !string.IsNullOrEmpty(g)).ToList();
                var own = new List<ElementId>();
                var linked = new List<Tuple<RevitLinkInstance, ElementId>>();
                var box = new BoundingBoxXYZ { Min = new XYZ(double.MaxValue, double.MaxValue, double.MaxValue), Max = new XYZ(double.MinValue, double.MinValue, double.MinValue) };
                bool any = false;
                void Grow(BoundingBoxXYZ b, Transform t)
                {
                    if (b == null) return;
                    var tr = (b.Transform ?? Transform.Identity);
                    if (t != null) tr = t.Multiply(tr);
                    foreach (var x in new[] { b.Min.X, b.Max.X })
                        foreach (var y in new[] { b.Min.Y, b.Max.Y })
                            foreach (var z in new[] { b.Min.Z, b.Max.Z })
                            {
                                var p = tr.OfPoint(new XYZ(x, y, z));
                                box.Min = new XYZ(Math.Min(box.Min.X, p.X), Math.Min(box.Min.Y, p.Y), Math.Min(box.Min.Z, p.Z));
                                box.Max = new XYZ(Math.Max(box.Max.X, p.X), Math.Max(box.Max.Y, p.Y), Math.Max(box.Max.Z, p.Z));
                            }
                    any = true;
                }

                var idx = IndexOf(doc);
                foreach (var g in wanted)
                    if (idx.TryGetValue(g, out var id))
                    {
                        own.Add(id);
                        Grow(doc.GetElement(id)?.get_BoundingBox(null), null);
                    }
                foreach (var li in new FilteredElementCollector(doc).OfClass(typeof(RevitLinkInstance)).Cast<RevitLinkInstance>())
                {
                    var ld = li.GetLinkDocument();
                    if (ld == null) continue;
                    var lidx = IndexOf(ld);
                    foreach (var g in wanted)
                        if (lidx.TryGetValue(g, out var id))
                        {
                            linked.Add(Tuple.Create(li, id));
                            Grow(ld.GetElement(id)?.get_BoundingBox(null), li.GetTotalTransform());
                        }
                }

                // Nenhum elemento achado: usa o ponto da interferência (coordenadas compartilhadas).
                if (!any && c.PontoIfc != null)
                {
                    var shared = new XYZ(c.PontoIfc[0] / 0.3048, c.PontoIfc[1] / 0.3048, c.PontoIfc[2] / 0.3048);
                    var p = doc.ActiveProjectLocation.GetTotalTransform().Inverse.OfPoint(shared);
                    box.Min = p;
                    box.Max = p;
                    any = true;
                }
                if (!any)
                {
                    Report($"#{c.Numero}: elementos não encontrados neste modelo nem nos vínculos.");
                    return;
                }
                // Caixa de corte: a região da interferência (elementos longos limitados a ~8 m).
                var center = (box.Min + box.Max) / 2;
                var half = new XYZ(Math.Min((box.Max.X - box.Min.X) / 2, 4 / 0.3048), Math.Min((box.Max.Y - box.Min.Y) / 2, 4 / 0.3048), Math.Min((box.Max.Z - box.Min.Z) / 2, 4 / 0.3048));
                var mm = new XYZ(Margin, Margin, Margin);
                var section = new BoundingBoxXYZ { Min = center - half - mm, Max = center + half + mm };

                View3D view;
                using (var t = new Transaction(doc, "SmartEasyBIM — vista da interferência"))
                {
                    t.Start();
                    view = new FilteredElementCollector(doc).OfClass(typeof(View3D)).Cast<View3D>().FirstOrDefault(v => !v.IsTemplate && v.Name == ViewName);
                    if (view == null)
                    {
                        var vft = new FilteredElementCollector(doc).OfClass(typeof(ViewFamilyType)).Cast<ViewFamilyType>().First(v => v.ViewFamily == ViewFamily.ThreeDimensional);
                        view = View3D.CreateIsometric(doc, vft.Id);
                        try { view.Name = ViewName; } catch { /* nome em uso */ }
                    }
                    view.IsSectionBoxActive = true;
                    view.SetSectionBox(section);
                    t.Commit();
                }
                uidoc.ActiveView = view;

#if REVIT2024_OR_GREATER
                var refs = own.Select(id => new Reference(doc.GetElement(id)))
                    .Concat(linked.Select(l => new Reference(l.Item1.GetLinkDocument().GetElement(l.Item2)).CreateLinkReference(l.Item1)))
                    .ToList();
                uidoc.Selection.SetReferences(refs);
#else
                uidoc.Selection.SetElementIds(own);
#endif
                var uiview = uidoc.GetOpenUIViews().FirstOrDefault(v => v.ViewId == view.Id);
                uiview?.ZoomAndCenterRectangle(section.Min, section.Max);

                var found = own.Count + linked.Count;
                Report(found > 0
                    ? $"#{c.Numero}: {found} elemento(s) selecionado(s) ({own.Count} deste modelo, {linked.Count} de vínculos) na vista \"{ViewName}\"."
                    : $"#{c.Numero}: elementos não encontrados; a vista mostra o ponto da interferência.");
            }
            catch (Exception ex)
            {
                Report($"Não foi possível mostrar a #{c.Numero}: {ex.Message}");
            }
        }

        /// <summary>GlobalId do IFC → elemento (só elementos de modelo, não tipos).</summary>
        private Dictionary<string, ElementId> IndexOf(Document doc)
        {
            var key = doc.PathName + "|" + doc.Title;
            // Refaz se o número de elementos mudou (elementos criados ou apagados).
            int count = new FilteredElementCollector(doc).WhereElementIsNotElementType().GetElementCount();
            if (_index.TryGetValue(key, out var cached) && _indexVersion[key] == count) return cached;
            var map = new Dictionary<string, ElementId>();
            foreach (var e in new FilteredElementCollector(doc).WhereElementIsNotElementType())
            {
                if (e.Category == null || e.Category.CategoryType != CategoryType.Model) continue;
                var g = IfcGuid.Of(doc, e);
                if (g != null && !map.ContainsKey(g)) map[g] = e.Id;
            }
            _index[key] = map;
            _indexVersion[key] = count;
            return map;
        }
    }
}
