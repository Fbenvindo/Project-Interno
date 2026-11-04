using System;
using System.Collections.Generic;
using System.Linq;
using Autodesk.Revit.DB;

namespace SmartEasyBIM.Revit
{
    internal sealed class ExportedParam
    {
        public string Name;
        /// <summary>Nome do BuiltInParameter (parâmetros nativos do Revit), ou null.</summary>
        public string BuiltIn;
        public bool IsInstance;
        public double? Number;
        public bool? Bool;
        public string Text;
        public string Unit;
    }

    internal sealed class ExportedType
    {
        public string Name;
        public List<ExportedParam> Params = new List<ExportedParam>();
        /// <summary>Vértices em mm, nas coordenadas da família (X, Y, Z do Revit).</summary>
        public List<double> Positions = new List<double>();
        public List<int> Indices = new List<int>();
        public double[] Min = { double.MaxValue, double.MaxValue, double.MaxValue };
        public double[] Max = { double.MinValue, double.MinValue, double.MinValue };
        public bool Truncated;
        /// <summary>Cor de cada triângulo (índice na paleta), pelo material da face.</summary>
        public List<int> Colors = new List<int>();
        public List<string> Palette = new List<string>();
        /// <summary>Linhas simbólicas visíveis em planta (polilinhas x, y em mm), como o Revit desenha a família.</summary>
        public List<List<double>> PlanLines = new List<List<double>>();
    }

    internal sealed class ExportedConnector
    {
        public string Domain;
        public string Shape;
        public string System;
        public double[] Origin;
        public double[] Direction;
        public double Diameter;
        public double Width;
        public double Height;
    }

    internal sealed class ExportedFamily
    {
        public string Uid;
        public string Name;
        public string Category;
        public string BuiltInCategory;
        public string Hosting;
        public string Placement;
        public List<ExportedType> Types = new List<ExportedType>();
        public List<ExportedConnector> Connectors = new List<ExportedConnector>();
        public List<string> Warnings = new List<string>();
    }

    /// <summary>Lê uma família aberta no editor de famílias: tipos, parâmetros, geometria e conectores.</summary>
    internal static class FamilyExporter
    {
        private const double FeetToMm = 304.8;
        private const int MaxTrianglesPerType = 150000;

        public static long IdValue(ElementId id)
        {
#if REVIT2024_OR_GREATER
            return id.Value;
#else
            return id.IntegerValue;
#endif
        }

        public static string BuiltInCategoryName(Category cat)
        {
            if (cat == null) return null;
            long v = IdValue(cat.Id);
            return v < 0 ? ((BuiltInCategory)(int)v).ToString() : null;
        }

        /// <summary>Hospedagem da família: parede, teto, piso, face ou nenhuma.</summary>
        public static string HostingOf(Family family)
        {
            try
            {
                var p = family.get_Parameter(BuiltInParameter.FAMILY_HOSTING_BEHAVIOR);
                switch (p?.AsInteger() ?? 0)
                {
                    case 1: return "parede";
                    case 2: return "piso";
                    case 3: return "teto";
                    case 4: return "telhado";
                    case 5: return "face";
                }
            }
            catch { /* parâmetro indisponível nesta família */ }
            return family.FamilyPlacementType == FamilyPlacementType.WorkPlaneBased ? "face" : "nenhuma";
        }

        public static ExportedFamily Export(Document fam, string familyName)
        {
            var mgr = fam.FamilyManager;
            var owner = fam.OwnerFamily;
            var cat = owner.FamilyCategory;
            var result = new ExportedFamily
            {
                Name = familyName,
                Category = cat?.Name,
                BuiltInCategory = BuiltInCategoryName(cat),
                Hosting = HostingOf(owner),
                Placement = owner.FamilyPlacementType.ToString(),
            };
            result.Uid = (result.BuiltInCategory ?? "OST") + ":" + familyName;

            var types = mgr.Types.Cast<FamilyType>().Where(t => t != null).ToList();
            using (var group = new TransactionGroup(fam, "SmartEasyBIM: leitura da família"))
            {
                group.Start();
                if (types.Count == 0)
                {
                    result.Types.Add(ReadType(fam, mgr.CurrentType, familyName, result));
                }
                else
                {
                    foreach (var t in types)
                    {
                        using (var tx = new Transaction(fam, "SmartEasyBIM: tipo"))
                        {
                            tx.Start();
                            mgr.CurrentType = t;
                            tx.Commit();
                        }
                        var name = string.IsNullOrWhiteSpace(t.Name) ? familyName : t.Name;
                        result.Types.Add(ReadType(fam, t, name, result));
                        if (result.Connectors.Count == 0) result.Connectors.AddRange(ReadConnectors(fam));
                    }
                }
                // Nada é gravado na família.
                group.RollBack();
            }
            return result;
        }

        private static ExportedType ReadType(Document fam, FamilyType type, string name, ExportedFamily family)
        {
            var et = new ExportedType { Name = name };
            var mgr = fam.FamilyManager;
            if (type != null)
            {
                foreach (FamilyParameter fp in mgr.Parameters)
                {
                    try
                    {
                        if (!type.HasValue(fp)) continue;
                        var p = ReadParam(fam, type, fp);
                        if (p != null) et.Params.Add(p);
                    }
                    catch (Exception ex)
                    {
                        family.Warnings.Add($"Parâmetro {fp.Definition?.Name}: {ex.Message}");
                    }
                }
            }
            // Triangulação fina (curvas suaves); se passar do limite, tenta mais grossa.
            foreach (var lod in new[] { 0.85, 0.5, 0.0 })
            {
                et.Positions.Clear();
                et.Indices.Clear();
                et.Colors.Clear();
                et.Palette.Clear();
                et.Min = new[] { double.MaxValue, double.MaxValue, double.MaxValue };
                et.Max = new[] { double.MinValue, double.MinValue, double.MinValue };
                et.Truncated = false;
                ReadGeometry(fam, et, lod);
                if (!et.Truncated) break;
            }
            if (et.Truncated) family.Warnings.Add($"Tipo {name}: geometria simplificada (mais de {MaxTrianglesPerType} triângulos).");
            ReadPlanLines(fam, et);
            if (et.Indices.Count == 0) family.Warnings.Add($"Tipo {name}: nenhuma geometria 3D encontrada.");
            return et;
        }

        private static ExportedParam ReadParam(Document fam, FamilyType type, FamilyParameter fp)
        {
            var p = new ExportedParam
            {
                Name = fp.Definition.Name,
                IsInstance = fp.IsInstance,
            };
            long id = IdValue(fp.Id);
            if (id < 0) p.BuiltIn = ((BuiltInParameter)(int)id).ToString();
            ForgeTypeId spec = null;
            try { spec = fp.Definition.GetDataType(); } catch { /* sem tipo de dado */ }

            switch (fp.StorageType)
            {
                case StorageType.Double:
                {
                    var raw = type.AsDouble(fp);
                    if (raw == null) return null;
                    if (spec != null && UnitUtils.IsMeasurableSpec(spec))
                    {
                        var fo = fam.GetUnits().GetFormatOptions(spec);
                        var unit = fo.GetUnitTypeId();
                        p.Number = UnitUtils.ConvertFromInternalUnits(raw.Value, unit);
                        p.Unit = UnitLabel(fo);
                    }
                    else p.Number = raw.Value;
                    break;
                }
                case StorageType.Integer:
                {
                    var v = type.AsInteger(fp);
                    if (v == null) return null;
                    if (spec != null && spec == SpecTypeId.Boolean.YesNo) p.Bool = v.Value != 0;
                    else p.Number = v.Value;
                    break;
                }
                case StorageType.String:
                    p.Text = type.AsString(fp);
                    if (string.IsNullOrEmpty(p.Text)) return null;
                    break;
                case StorageType.ElementId:
                    p.Text = type.AsValueString(fp);
                    if (string.IsNullOrEmpty(p.Text)) return null;
                    break;
                default:
                    return null;
            }
            if (p.Text == null)
            {
                try { p.Text = type.AsValueString(fp); } catch { /* sem texto formatado */ }
            }
            return p;
        }

        private static string UnitLabel(FormatOptions fo)
        {
            try
            {
                var sym = fo.GetSymbolTypeId();
                if (sym != null && !sym.Empty()) return LabelUtils.GetLabelForSymbol(sym);
                return LabelUtils.GetLabelForUnit(fo.GetUnitTypeId());
            }
            catch
            {
                return null;
            }
        }

        // ---- Geometria -------------------------------------------------------------------------

        private sealed class MeshBuilder
        {
            private readonly ExportedType _t;
            private readonly Dictionary<(long, long, long), int> _index = new Dictionary<(long, long, long), int>();
            private readonly Dictionary<string, int> _palette = new Dictionary<string, int>();
            private int _color;
            public MeshBuilder(ExportedType t) { _t = t; SetColor(DefaultColor); }

            /// <summary>Cor (#rrggbb) dos próximos triângulos.</summary>
            public void SetColor(string hex)
            {
                if (!_palette.TryGetValue(hex, out _color))
                {
                    _color = _t.Palette.Count;
                    _t.Palette.Add(hex);
                    _palette[hex] = _color;
                }
            }

            public int Vertex(XYZ p)
            {
                double x = p.X * FeetToMm, y = p.Y * FeetToMm, z = p.Z * FeetToMm;
                var key = ((long)Math.Round(x * 10), (long)Math.Round(y * 10), (long)Math.Round(z * 10));
                if (_index.TryGetValue(key, out int i)) return i;
                i = _t.Positions.Count / 3;
                _t.Positions.Add(x);
                _t.Positions.Add(y);
                _t.Positions.Add(z);
                _index[key] = i;
                if (x < _t.Min[0]) _t.Min[0] = x;
                if (y < _t.Min[1]) _t.Min[1] = y;
                if (z < _t.Min[2]) _t.Min[2] = z;
                if (x > _t.Max[0]) _t.Max[0] = x;
                if (y > _t.Max[1]) _t.Max[1] = y;
                if (z > _t.Max[2]) _t.Max[2] = z;
                return i;
            }

            public bool Triangle(XYZ a, XYZ b, XYZ c)
            {
                if (_t.Indices.Count / 3 >= MaxTrianglesPerType) { _t.Truncated = true; return false; }
                int ia = Vertex(a), ib = Vertex(b), ic = Vertex(c);
                if (ia == ib || ib == ic || ia == ic) return true;
                _t.Indices.Add(ia);
                _t.Indices.Add(ib);
                _t.Indices.Add(ic);
                _t.Colors.Add(_color);
                return true;
            }

            public void Add(Mesh m)
            {
                for (int i = 0; i < m.NumTriangles; i++)
                {
                    var tri = m.get_Triangle(i);
                    if (!Triangle(tri.get_Vertex(0), tri.get_Vertex(1), tri.get_Vertex(2))) return;
                }
            }
        }

        private static void ReadGeometry(Document fam, ExportedType et, double levelOfDetail)
        {
            var opt = new Options { DetailLevel = ViewDetailLevel.Fine, ComputeReferences = false, IncludeNonVisibleObjects = false };
            var mesh = new MeshBuilder(et);
            var elements = new FilteredElementCollector(fam).WhereElementIsNotElementType().ToElements();
            foreach (var e in elements)
            {
                if (e is GenericForm gf && !gf.IsSolid) continue; // vazios já recortaram os sólidos
                if (e is ReferencePlane || e is Dimension || e is CurveElement || e is ConnectorElement || e is SketchPlane) continue;
                // Famílias hospedadas trazem a parede/forro/laje de referência no próprio documento.
                if (e is HostObject || e is Level) continue;
                GeometryElement g;
                try { g = e.get_Geometry(opt); }
                catch { continue; }
                if (g == null) continue;
                Walk(fam, g, mesh, levelOfDetail, ElementColor(fam, e));
                if (et.Truncated) return;
            }
        }

        private static void Walk(Document fam, GeometryElement g, MeshBuilder mesh, double lod, string fallback)
        {
            foreach (var obj in g)
            {
                switch (obj)
                {
                    case Solid s when s.Faces.Size > 0 && s.Volume > 1e-9:
                        var solidColor = StyleColor(fam, obj.GraphicsStyleId) ?? fallback;
                        foreach (Face f in s.Faces)
                        {
                            Mesh m;
                            try { m = f.Triangulate(lod); }
                            catch { continue; }
                            if (m == null) continue;
                            mesh.SetColor(MaterialColor(fam, f.MaterialElementId) ?? solidColor);
                            mesh.Add(m);
                        }
                        break;
                    case Mesh m:
                        mesh.SetColor(MaterialColor(fam, m.MaterialElementId) ?? StyleColor(fam, obj.GraphicsStyleId) ?? fallback);
                        mesh.Add(m);
                        break;
                    case GeometryInstance gi:
                        var inner = gi.GetInstanceGeometry();
                        if (inner != null) Walk(fam, inner, mesh, lod, StyleColor(fam, obj.GraphicsStyleId) ?? fallback);
                        break;
                }
            }
        }

        // ---- Cores (materiais) -----------------------------------------------------------------

        private const string DefaultColor = "#a8adb5";

        private static string Hex(Color c) => c != null && c.IsValid ? $"#{c.Red:x2}{c.Green:x2}{c.Blue:x2}" : null;

        private static string MaterialColor(Document fam, ElementId id)
        {
            if (id == null || id == ElementId.InvalidElementId) return null;
            return fam.GetElement(id) is Material mat ? Hex(mat.Color) : null;
        }

        /// <summary>Cor pela subcategoria (estilo gráfico) do objeto: o material da subcategoria.</summary>
        private static string StyleColor(Document fam, ElementId styleId)
        {
            if (styleId == null || styleId == ElementId.InvalidElementId) return null;
            if (!(fam.GetElement(styleId) is GraphicsStyle gs) || gs.GraphicsStyleCategory == null) return null;
            return MaterialColor(fam, gs.GraphicsStyleCategory.Material?.Id);
        }

        /// <summary>Cor padrão de um elemento da família: material do parâmetro "Material", senão da subcategoria/categoria.</summary>
        private static string ElementColor(Document fam, Element e)
        {
            try
            {
                var p = e.get_Parameter(BuiltInParameter.MATERIAL_ID_PARAM);
                var byParam = p != null ? MaterialColor(fam, p.AsElementId()) : null;
                if (byParam != null) return byParam;
                if (e.Category?.Material != null) return Hex(e.Category.Material.Color) ?? DefaultColor;
                if (e.Category?.Parent?.Material != null) return Hex(e.Category.Parent.Material.Color) ?? DefaultColor;
            }
            catch { /* sem material */ }
            return DefaultColor;
        }

        // ---- Símbolo em planta -------------------------------------------------------------------

        private const int MaxPlanPoints = 20000;

        /// <summary>Linhas simbólicas visíveis em planta (vista superior), como o Revit desenha a família na planta.</summary>
        private static void ReadPlanLines(Document fam, ExportedType et)
        {
            int count = 0;
            foreach (var sc in new FilteredElementCollector(fam).OfClass(typeof(SymbolicCurve)).Cast<SymbolicCurve>())
            {
                try
                {
                    var vis = sc.GetVisibility();
                    if (vis != null && !vis.IsShownInTopBottom) continue;
                    var normal = sc.SketchPlane?.GetPlane()?.Normal;
                    if (normal != null && Math.Abs(normal.Z) < 0.99) continue; // só linhas no plano horizontal
                    var pts = sc.GeometryCurve?.Tessellate();
                    if (pts == null || pts.Count < 2) continue;
                    var line = new List<double>(pts.Count * 2);
                    foreach (var q in pts)
                    {
                        line.Add(q.X * FeetToMm);
                        line.Add(q.Y * FeetToMm);
                    }
                    et.PlanLines.Add(line);
                    count += pts.Count;
                    if (count > MaxPlanPoints) break;
                }
                catch { /* linha sem visibilidade/geometria */ }
            }
        }

        // ---- Conectores ------------------------------------------------------------------------

        private static IEnumerable<ExportedConnector> ReadConnectors(Document fam)
        {
            var list = new List<ExportedConnector>();
            foreach (var ce in new FilteredElementCollector(fam).OfClass(typeof(ConnectorElement)).Cast<ConnectorElement>())
            {
                try
                {
                    var cs = ce.CoordinateSystem;
                    var c = new ExportedConnector
                    {
                        Domain = ce.Domain.ToString(),
                        Shape = ce.Shape.ToString(),
                        Origin = new[] { ce.Origin.X * FeetToMm, ce.Origin.Y * FeetToMm, ce.Origin.Z * FeetToMm },
                        Direction = new[] { cs.BasisZ.X, cs.BasisZ.Y, cs.BasisZ.Z },
                    };
                    try { c.System = ce.SystemClassification.ToString(); } catch { /* conector elétrico sem classificação */ }
                    if (ce.Shape == ConnectorProfileType.Round)
                    {
                        try { c.Diameter = ce.Radius * 2 * FeetToMm; } catch { /* sem raio */ }
                    }
                    else if (ce.Shape == ConnectorProfileType.Rectangular || ce.Shape == ConnectorProfileType.Oval)
                    {
                        try { c.Width = ce.Width * FeetToMm; c.Height = ce.Height * FeetToMm; } catch { /* sem dimensões */ }
                    }
                    list.Add(c);
                }
                catch { /* conector inválido */ }
            }
            return list;
        }
    }
}
