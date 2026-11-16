using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Text;
using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Architecture;

namespace SmartEasyBIM.Revit
{
    /// <summary>Categoria de modelo do projeto, com quantos elementos tem.</summary>
    internal sealed class CategoryEntry
    {
        public string Name;
        public string BuiltInCategory;
        public long Id;
        public int Count;
        public bool Default;
    }

    internal sealed class ModelExportResult
    {
        public int Elements;
        public int Meshes;
        public int Shared;
        public int Rooms;
        public int Levels;
        public List<string> Warnings = new List<string>();
    }

    /// <summary>
    /// Exporta o modelo (elementos, famílias, tipos, categorias e parâmetros, com a geometria) para
    /// o SmartEasyBIM: arquivo .sebmod (JSON compactado). Coordenadas internas do Revit, em metros.
    /// Instâncias iguais de uma família (mesmo tipo e mesmos parâmetros de instância) dividem uma
    /// malha só, colocada pela matriz de cada instância.
    /// </summary>
    internal static class ModelExporter
    {
        public const string Format = "smarteasybim/modelo";
        public const int Version = 1;
        private const double Ft = 0.3048;
        private const int MaxTrianglesPerElement = 200000;

        /// <summary>Categorias de arquitetura e estrutura (pré-marcadas no diálogo).</summary>
        internal static readonly HashSet<string> ArchStructure = new HashSet<string>
        {
            "OST_Walls", "OST_Doors", "OST_Windows", "OST_Floors", "OST_Roofs", "OST_Ceilings",
            "OST_Columns", "OST_StructuralColumns", "OST_StructuralFraming", "OST_StructuralFoundation", "OST_StructuralTruss",
            "OST_Stairs", "OST_StairsRuns", "OST_StairsLandings", "OST_Ramps", "OST_Railings", "OST_StairsRailing",
            "OST_CurtainWallPanels", "OST_CurtainWallMullions", "OST_Furniture", "OST_FurnitureSystems", "OST_Casework",
            "OST_GenericModel", "OST_SpecialityEquipment", "OST_PlumbingFixtures", "OST_Planting", "OST_Site",
            "OST_Topography", "OST_Toposolid", "OST_Parking", "OST_Entourage",
        };

        private static readonly HashSet<string> Openings = new HashSet<string> { "OST_Doors", "OST_Windows" };

        private static bool Exportable(Element e) =>
            e.Category != null &&
            e.Category.CategoryType == CategoryType.Model &&
            !(e is Room) && !(e is Level) && !(e is Grid) && !(e is RevitLinkInstance) && !(e is ImportInstance) &&
            !(e is SpatialElement) && e.ViewSpecific == false;

        /// <summary>Categorias de modelo com elementos no projeto.</summary>
        public static List<CategoryEntry> Categories(Document doc)
        {
            var map = new Dictionary<long, CategoryEntry>();
            foreach (var e in new FilteredElementCollector(doc).WhereElementIsNotElementType())
            {
                if (!Exportable(e)) continue;
                long id = FamilyExporter.IdValue(e.Category.Id);
                if (!map.TryGetValue(id, out var c))
                {
                    var bic = FamilyExporter.BuiltInCategoryName(e.Category);
                    c = new CategoryEntry { Name = e.Category.Name, BuiltInCategory = bic, Id = id, Default = bic != null && ArchStructure.Contains(bic) };
                    map[id] = c;
                }
                c.Count++;
            }
            return map.Values.OrderBy(c => c.Name).ToList();
        }

        // ---- Malhas --------------------------------------------------------------------------

        private sealed class GeoMesh
        {
            public int Id;
            public readonly List<double> P = new List<double>();
            public readonly List<int> I = new List<int>();
            public readonly List<int> C = new List<int>();
            public readonly List<string> Palette = new List<string>();
            private readonly Dictionary<(long, long, long), int> _index = new Dictionary<(long, long, long), int>();
            private readonly Dictionary<string, int> _pal = new Dictionary<string, int>();
            private int _color;
            public bool Truncated;

            public void SetColor(string hex)
            {
                if (!_pal.TryGetValue(hex, out _color))
                {
                    _color = Palette.Count;
                    Palette.Add(hex);
                    _pal[hex] = _color;
                }
            }

            private int Vertex(XYZ p)
            {
                double x = p.X * Ft, y = p.Y * Ft, z = p.Z * Ft;
                var key = ((long)Math.Round(x * 10000), (long)Math.Round(y * 10000), (long)Math.Round(z * 10000));
                if (_index.TryGetValue(key, out int i)) return i;
                i = P.Count / 3;
                P.Add(x);
                P.Add(y);
                P.Add(z);
                _index[key] = i;
                return i;
            }

            public void Add(Mesh m, Transform t)
            {
                for (int k = 0; k < m.NumTriangles; k++)
                {
                    if (I.Count / 3 >= MaxTrianglesPerElement) { Truncated = true; return; }
                    var tri = m.get_Triangle(k);
                    XYZ a = tri.get_Vertex(0), b = tri.get_Vertex(1), c = tri.get_Vertex(2);
                    if (t != null) { a = t.OfPoint(a); b = t.OfPoint(b); c = t.OfPoint(c); }
                    int ia = Vertex(a), ib = Vertex(b), ic = Vertex(c);
                    if (ia == ib || ib == ic || ia == ic) continue;
                    I.Add(ia);
                    I.Add(ib);
                    I.Add(ic);
                    C.Add(_color);
                }
            }
        }

        private static void Walk(Document doc, GeometryElement g, GeoMesh mesh, Transform t, string fallback)
        {
            foreach (var obj in g)
            {
                if (mesh.Truncated) return;
                switch (obj)
                {
                    case Solid s when s.Faces.Size > 0 && s.Volume > 1e-9:
                        var solidColor = StyleColor(doc, obj.GraphicsStyleId) ?? fallback;
                        foreach (Face f in s.Faces)
                        {
                            Mesh m;
                            try { m = f.Triangulate(0.5); }
                            catch { continue; }
                            if (m == null) continue;
                            mesh.SetColor(MaterialColor(doc, f.MaterialElementId) ?? solidColor);
                            mesh.Add(m, t);
                        }
                        break;
                    case Mesh m:
                        mesh.SetColor(MaterialColor(doc, m.MaterialElementId) ?? StyleColor(doc, obj.GraphicsStyleId) ?? fallback);
                        mesh.Add(m, t);
                        break;
                    case GeometryInstance gi:
                        // Instância aninhada: geometria já posicionada no sistema de quem a contém.
                        var inner = gi.GetInstanceGeometry();
                        if (inner != null) Walk(doc, inner, mesh, t, StyleColor(doc, obj.GraphicsStyleId) ?? fallback);
                        break;
                }
            }
        }

        // ---- Cores ---------------------------------------------------------------------------

        private const string DefaultColor = "#bfbfbf";
        private static string Hex(Color c) => c != null && c.IsValid ? $"#{c.Red:x2}{c.Green:x2}{c.Blue:x2}" : null;
        private static readonly Dictionary<long, string> MaterialCache = new Dictionary<long, string>();

        private static string MaterialColor(Document doc, ElementId id)
        {
            if (id == null || id == ElementId.InvalidElementId) return null;
            long k = FamilyExporter.IdValue(id);
            if (MaterialCache.TryGetValue(k, out var hex)) return hex;
            hex = doc.GetElement(id) is Material mat ? Hex(mat.Color) : null;
            MaterialCache[k] = hex;
            return hex;
        }

        private static string StyleColor(Document doc, ElementId styleId)
        {
            if (styleId == null || styleId == ElementId.InvalidElementId) return null;
            if (!(doc.GetElement(styleId) is GraphicsStyle gs) || gs.GraphicsStyleCategory == null) return null;
            return MaterialColor(doc, gs.GraphicsStyleCategory.Material?.Id);
        }

        private static string ElementColor(Document doc, Element e)
        {
            try
            {
                if (e.Category?.Material != null) return Hex(e.Category.Material.Color) ?? DefaultColor;
                if (e.Category?.Parent?.Material != null) return Hex(e.Category.Parent.Material.Color) ?? DefaultColor;
            }
            catch { /* sem material */ }
            return DefaultColor;
        }

        // ---- Parâmetros ------------------------------------------------------------------------

        private sealed class Param
        {
            public string Name, Text, Group;
            public double? Number;
            public bool? Bool;
            public string Str;
        }

        private static string GroupLabel(Definition d)
        {
            try
            {
#if REVIT2024_OR_GREATER
                var g = d.GetGroupTypeId();
                return g == null || g.Empty() ? null : LabelUtils.GetLabelForGroup(g);
#else
                return LabelUtils.GetLabelFor(d.ParameterGroup);
#endif
            }
            catch { return null; }
        }

        private static List<Param> ReadParams(Element e)
        {
            var list = new List<Param>();
            foreach (Parameter p in e.Parameters)
            {
                try
                {
                    if (p == null || !p.HasValue || p.Definition == null) continue;
                    var q = new Param { Name = p.Definition.Name, Group = GroupLabel(p.Definition) };
                    switch (p.StorageType)
                    {
                        case StorageType.Double:
                            try
                            {
                                var unit = p.GetUnitTypeId();
                                q.Number = UnitUtils.ConvertFromInternalUnits(p.AsDouble(), unit);
                            }
                            catch { q.Number = p.AsDouble(); }
                            q.Text = p.AsValueString();
                            break;
                        case StorageType.Integer:
                            ForgeTypeId spec = null;
                            try { spec = p.Definition.GetDataType(); } catch { /* sem tipo */ }
                            if (spec != null && spec == SpecTypeId.Boolean.YesNo) q.Bool = p.AsInteger() != 0;
                            else q.Number = p.AsInteger();
                            q.Text = p.AsValueString();
                            break;
                        case StorageType.String:
                            q.Str = p.AsString();
                            if (string.IsNullOrEmpty(q.Str)) continue;
                            break;
                        case StorageType.ElementId:
                            q.Str = p.AsValueString();
                            if (string.IsNullOrEmpty(q.Str)) continue;
                            break;
                        default:
                            continue;
                    }
                    list.Add(q);
                }
                catch { /* parâmetro ilegível */ }
            }
            return list.OrderBy(x => x.Group).ThenBy(x => x.Name).ToList();
        }

        private static void WriteParams(JsonWriter w, string name, List<Param> list)
        {
            w.Name(name).BeginArray();
            foreach (var p in list)
            {
                w.BeginObject().Prop("nome", p.Name);
                w.Name("valor");
                if (p.Bool.HasValue) w.Value(p.Bool.Value);
                else if (p.Number.HasValue) w.Value(p.Number.Value, 6);
                else w.Value(p.Str);
                if (!string.IsNullOrEmpty(p.Text)) w.Prop("texto", p.Text);
                if (p.Group != null) w.Prop("grupo", p.Group);
                w.EndObject();
            }
            w.EndArray();
        }

        /// <summary>Chave das instâncias de mesma geometria: tipo e parâmetros de instância numéricos da família.</summary>
        private static string InstanceKey(FamilyInstance fi)
        {
            var sb = new StringBuilder(FamilyExporter.IdValue(fi.Symbol.Id).ToString(CultureInfo.InvariantCulture));
            foreach (Parameter p in fi.Parameters)
            {
                try
                {
                    if (p.IsShared == false && FamilyExporter.IdValue(p.Id) < 0) continue; // nativo do Revit
                    if (p.StorageType == StorageType.Double) sb.Append('|').Append(Math.Round(p.AsDouble(), 5).ToString(CultureInfo.InvariantCulture));
                    else if (p.StorageType == StorageType.Integer) sb.Append('|').Append(p.AsInteger());
                }
                catch { /* sem valor */ }
            }
            return sb.ToString();
        }

        // ---- GUID IFC --------------------------------------------------------------------------

        private const string Base64Chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$";

        /// <summary>GlobalId IFC (22 caracteres) do Guid de exportação do elemento.</summary>
        internal static string IfcGuid(Guid guid)
        {
            var b = guid.ToByteArray();
            uint d1 = BitConverter.ToUInt32(b, 0);
            uint d2 = BitConverter.ToUInt16(b, 4);
            uint d3 = BitConverter.ToUInt16(b, 6);
            var num = new uint[6];
            num[0] = d1 / 16777216;
            num[1] = d1 % 16777216;
            num[2] = d2 * 256 + d3 / 256;
            num[3] = (d3 % 256) * 65536 + (uint)b[8] * 256 + b[9];
            num[4] = (uint)b[10] * 65536 + (uint)b[11] * 256 + b[12];
            num[5] = (uint)b[13] * 65536 + (uint)b[14] * 256 + b[15];
            var res = new char[22];
            int pos = 0;
            for (int i = 0; i < 6; i++)
            {
                int len = i == 0 ? 2 : 4;
                uint n = num[i];
                for (int k = len - 1; k >= 0; k--)
                {
                    res[pos + k] = Base64Chars[(int)(n % 64)];
                    n /= 64;
                }
                pos += len;
            }
            return new string(res);
        }

        private static string GuidOf(Document doc, Element e)
        {
            try { return IfcGuid(ExportUtils.GetExportId(doc, e.Id)); }
            catch { return e.UniqueId; }
        }

        // ---- Exportação ------------------------------------------------------------------------

        private static void Matrix(JsonWriter w, string name, Transform t)
        {
            w.Numbers(name, new[]
            {
                t.BasisX.X, t.BasisX.Y, t.BasisX.Z,
                t.BasisY.X, t.BasisY.Y, t.BasisY.Z,
                t.BasisZ.X, t.BasisZ.Y, t.BasisZ.Z,
                t.Origin.X * Ft, t.Origin.Y * Ft, t.Origin.Z * Ft,
            }, 6);
        }

        private static void WriteMesh(JsonWriter w, GeoMesh m)
        {
            w.BeginObject().Prop("id", m.Id);
            w.Numbers("posicoes", m.P, 4);
            w.Integers("indices", m.I);
            w.Name("paleta").BeginArray();
            foreach (var c in m.Palette) w.Value(c);
            w.EndArray();
            if (m.Palette.Count > 1) w.Integers("cores", m.C);
            w.EndObject();
        }

        public static ModelExportResult Export(Document doc, ISet<long> categoryIds, bool instanceParams, string path, string revitVersion)
        {
            var result = new ModelExportResult();
            MaterialCache.Clear();
            var opt = new Options { DetailLevel = ViewDetailLevel.Fine, ComputeReferences = false, IncludeNonVisibleObjects = false };

            // Níveis (cota em relação à origem interna, como a geometria).
            var levels = new FilteredElementCollector(doc).OfClass(typeof(Level)).Cast<Level>().OrderBy(l => l.ProjectElevation).ToList();
            var levelName = levels.ToDictionary(l => FamilyExporter.IdValue(l.Id), l => l.Name);
            string LevelOf(Element e, BoundingBoxXYZ bb)
            {
                try
                {
                    if (e.LevelId != null && e.LevelId != ElementId.InvalidElementId && levelName.TryGetValue(FamilyExporter.IdValue(e.LevelId), out var n)) return n;
                    foreach (var bip in new[] { BuiltInParameter.FAMILY_LEVEL_PARAM, BuiltInParameter.SCHEDULE_LEVEL_PARAM, BuiltInParameter.INSTANCE_REFERENCE_LEVEL_PARAM, BuiltInParameter.WALL_BASE_CONSTRAINT })
                    {
                        var p = e.get_Parameter(bip);
                        var id = p?.AsElementId();
                        if (id != null && id != ElementId.InvalidElementId && levelName.TryGetValue(FamilyExporter.IdValue(id), out n)) return n;
                    }
                }
                catch { /* sem nível */ }
                if (bb == null || levels.Count == 0) return null;
                var below = levels.LastOrDefault(l => l.ProjectElevation <= bb.Min.Z + 0.15);
                return (below ?? levels[0]).Name;
            }

            var meshes = new List<GeoMesh>();
            var shared = new Dictionary<string, int>();
            var typesUsed = new Dictionary<long, ElementType>();
            var openingSymbols = new Dictionary<long, FamilySymbol>();

            var elements = new FilteredElementCollector(doc).WhereElementIsNotElementType()
                .Where(e => Exportable(e) && categoryIds.Contains(FamilyExporter.IdValue(e.Category.Id)))
                .ToList();

            using (var fs = new FileStream(path, FileMode.Create, FileAccess.Write))
            using (var gz = new GZipStream(fs, CompressionLevel.Optimal))
            using (var sw = new StreamWriter(gz, new UTF8Encoding(false)))
            {
                var w = new JsonWriter(sw);
                w.BeginObject()
                    .Prop("formato", Format)
                    .Prop("versao", Version)
                    .Prop("origem", "Revit " + revitVersion)
                    .Prop("arquivo", doc.Title)
                    .Prop("exportadoEm", DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ"))
                    .Prop("unidades", "m");

                // Coordenadas compartilhadas: posição da origem interna e direção do eixo X no mapa.
                try
                {
                    var tf = doc.ActiveProjectLocation.GetTotalTransform().Inverse;
                    var o = tf.OfPoint(XYZ.Zero);
                    var x = tf.OfVector(XYZ.BasisX);
                    w.Name("local").BeginObject()
                        .Prop("leste", o.X * Ft, 4).Prop("norte", o.Y * Ft, 4).Prop("cota", o.Z * Ft, 4);
                    w.Numbers("eixoX", new[] { x.X, x.Y }, 9);
                    try
                    {
                        var bp = BasePoint.GetProjectBasePoint(doc).Position;
                        w.Numbers("pontoBase", new[] { bp.X * Ft, bp.Y * Ft, bp.Z * Ft }, 4);
                    }
                    catch { /* sem ponto base */ }
                    w.EndObject();
                }
                catch (Exception ex) { result.Warnings.Add("Coordenadas compartilhadas: " + ex.Message); }

                w.Name("niveis").BeginArray();
                foreach (var l in levels)
                    w.BeginObject().Prop("id", FamilyExporter.IdValue(l.Id)).Prop("nome", l.Name).Prop("cota", l.ProjectElevation * Ft, 4).EndObject();
                w.EndArray();
                result.Levels = levels.Count;

                // Elementos (as malhas vão depois, numa lista própria).
                w.Name("elementos").BeginArray();
                foreach (var e in elements)
                {
                    GeometryElement g;
                    try { g = e.get_Geometry(opt); }
                    catch { continue; }
                    if (g == null) continue;
                    var top = g.Cast<GeometryObject>().ToList();
                    var refs = new List<(int mesh, Transform t)>();
                    var fallback = ElementColor(doc, e);
                    var fi = e as FamilyInstance;
                    var instances = top.OfType<GeometryInstance>().ToList();
                    bool onlyInstance = fi != null && instances.Count == 1 && top.All(o => o is GeometryInstance || (o is Solid s && s.Volume <= 1e-9) || o is Curve || o is Point);
                    try
                    {
                        if (onlyInstance)
                        {
                            var gi = instances[0];
                            var key = InstanceKey(fi);
                            if (!shared.TryGetValue(key, out int id))
                            {
                                var m = new GeoMesh { Id = meshes.Count };
                                Walk(doc, gi.GetSymbolGeometry(), m, null, StyleColor(doc, gi.GraphicsStyleId) ?? fallback);
                                if (m.Truncated) result.Warnings.Add($"{e.Name} ({FamilyExporter.IdValue(e.Id)}): geometria simplificada.");
                                id = m.I.Count > 0 ? m.Id : -1;
                                if (id >= 0) meshes.Add(m);
                                shared[key] = id;
                            }
                            else result.Shared++;
                            if (id >= 0) refs.Add((id, gi.Transform));
                        }
                        else
                        {
                            var m = new GeoMesh { Id = meshes.Count };
                            Walk(doc, g, m, null, fallback);
                            if (m.Truncated) result.Warnings.Add($"{e.Name} ({FamilyExporter.IdValue(e.Id)}): geometria simplificada.");
                            if (m.I.Count > 0)
                            {
                                meshes.Add(m);
                                refs.Add((m.Id, null));
                            }
                        }
                    }
                    catch (Exception ex)
                    {
                        result.Warnings.Add($"{e.Name} ({FamilyExporter.IdValue(e.Id)}): {ex.Message}");
                    }
                    if (refs.Count == 0) continue;

                    var bic = FamilyExporter.BuiltInCategoryName(e.Category);
                    var typeId = e.GetTypeId();
                    ElementType type = null;
                    if (typeId != null && typeId != ElementId.InvalidElementId)
                    {
                        long tid = FamilyExporter.IdValue(typeId);
                        if (!typesUsed.TryGetValue(tid, out type))
                        {
                            type = doc.GetElement(typeId) as ElementType;
                            if (type != null) typesUsed[tid] = type;
                        }
                    }
                    BoundingBoxXYZ bb = null;
                    try { bb = e.get_BoundingBox(null); } catch { /* sem caixa */ }

                    w.BeginObject()
                        .Prop("id", FamilyExporter.IdValue(e.Id))
                        .Prop("guid", GuidOf(doc, e))
                        .Prop("categoria", e.Category.Name)
                        .Prop("categoriaRevit", bic)
                        .Prop("nome", type != null ? $"{type.FamilyName}: {type.Name}" : e.Name)
                        .Prop("nivel", LevelOf(e, bb));
                    if (type != null) w.Prop("tipo", FamilyExporter.IdValue(type.Id));
                    w.Name("malhas").BeginArray();
                    foreach (var (mesh, t) in refs)
                    {
                        w.BeginObject().Prop("malha", mesh);
                        if (t != null && !t.IsIdentity) Matrix(w, "matriz", t);
                        w.EndObject();
                    }
                    w.EndArray();
                    try
                    {
                        if (e.Location is LocationCurve lc && lc.Curve != null) w.Prop("comprimento", lc.Curve.Length * Ft, 4);
                    }
                    catch { /* sem comprimento */ }

                    // Portas e janelas: eixos e matriz (para o símbolo de planta da família).
                    if (fi != null && bic != null && Openings.Contains(bic))
                    {
                        try
                        {
                            var tr = fi.GetTransform();
                            var o = (fi.Location as LocationPoint)?.Point ?? tr.Origin;
                            w.Name("porta").BeginObject();
                            w.Numbers("origem", new[] { o.X * Ft, o.Y * Ft, o.Z * Ft }, 4);
                            w.Numbers("x", new[] { fi.HandOrientation.X, fi.HandOrientation.Y, fi.HandOrientation.Z }, 6);
                            w.Numbers("y", new[] { fi.FacingOrientation.X, fi.FacingOrientation.Y, fi.FacingOrientation.Z }, 6);
                            Matrix(w, "matriz", tr);
                            w.Prop("espelhada", fi.Mirrored);
                            if (fi.Host != null) w.Prop("hospedeiro", FamilyExporter.IdValue(fi.Host.Id));
                            w.EndObject();
                            openingSymbols[FamilyExporter.IdValue(fi.Symbol.Id)] = fi.Symbol;
                        }
                        catch { /* sem orientação */ }
                    }

                    // Sistemas (instalações).
                    try
                    {
                        var sys = e.get_Parameter(BuiltInParameter.RBS_SYSTEM_NAME_PARAM)?.AsString();
                        if (!string.IsNullOrEmpty(sys))
                        {
                            w.Name("sistemas").BeginArray();
                            foreach (var s in sys.Split(',')) w.Value(s.Trim());
                            w.EndArray();
                        }
                    }
                    catch { /* sem sistema */ }

                    if (instanceParams) WriteParams(w, "parametros", ReadParams(e));
                    w.EndObject();
                    result.Elements++;
                }
                w.EndArray();

                // Tipos: família, nome, parâmetros e o símbolo de planta das portas e janelas.
                var planLines = ReadOpeningSymbols(doc, openingSymbols.Values.ToList(), result);
                w.Name("tipos").BeginArray();
                foreach (var kv in typesUsed)
                {
                    var t = kv.Value;
                    w.BeginObject().Prop("id", kv.Key).Prop("familia", t.FamilyName).Prop("nome", t.Name);
                    WriteParams(w, "parametros", ReadParams(t));
                    if (planLines.TryGetValue(kv.Key, out var lines) && lines.Count > 0)
                    {
                        w.Name("planta").BeginArray();
                        foreach (var l in lines) w.Numbers(null, l, 4);
                        w.EndArray();
                    }
                    w.EndObject();
                }
                w.EndArray();

                w.Name("malhas").BeginArray();
                foreach (var m in meshes) WriteMesh(w, m);
                w.EndArray();
                result.Meshes = meshes.Count;

                // Ambientes: contorno (acabamento), número, nome, área e altura.
                w.Name("ambientes").BeginArray();
                var bopt = new SpatialElementBoundaryOptions { SpatialElementBoundaryLocation = SpatialElementBoundaryLocation.Finish };
                foreach (var r in new FilteredElementCollector(doc).OfCategory(BuiltInCategory.OST_Rooms).WhereElementIsNotElementType().OfType<Room>())
                {
                    try
                    {
                        if (r.Area <= 0 || r.Location == null) continue;
                        var loops = r.GetBoundarySegments(bopt);
                        if (loops == null || loops.Count == 0) continue;
                        var pts = new List<double>();
                        foreach (var seg in loops[0])
                        {
                            var q = seg.GetCurve().Tessellate();
                            for (int i = 0; i < q.Count - 1; i++)
                            {
                                pts.Add(q[i].X * Ft);
                                pts.Add(q[i].Y * Ft);
                            }
                        }
                        if (pts.Count < 6) continue;
                        double floor = (r.Level?.ProjectElevation ?? 0) + r.BaseOffset;
                        w.BeginObject()
                            .Prop("id", FamilyExporter.IdValue(r.Id))
                            .Prop("guid", GuidOf(doc, r))
                            .Prop("nome", r.get_Parameter(BuiltInParameter.ROOM_NAME)?.AsString() ?? "")
                            .Prop("numero", r.Number ?? "")
                            .Prop("nivel", r.Level?.Name)
                            .Prop("area", r.Area * Ft * Ft, 3)
                            .Prop("cotaPiso", floor * Ft, 4)
                            .Prop("altura", r.UnboundedHeight * Ft, 4);
                        w.Numbers("contorno", pts, 4);
                        w.EndObject();
                        result.Rooms++;
                    }
                    catch { /* ambiente sem contorno */ }
                }
                w.EndArray();

                // Eixos.
                w.Name("eixos").BeginArray();
                foreach (var gr in new FilteredElementCollector(doc).OfClass(typeof(Grid)).Cast<Grid>())
                {
                    try
                    {
                        var q = gr.Curve.Tessellate();
                        var pts = new List<double>();
                        foreach (var p in q)
                        {
                            pts.Add(p.X * Ft);
                            pts.Add(p.Y * Ft);
                        }
                        w.BeginObject().Prop("nome", gr.Name);
                        w.Numbers("pontos", pts, 4);
                        w.EndObject();
                    }
                    catch { /* eixo sem curva */ }
                }
                w.EndArray();

                w.EndObject();
            }
            return result;
        }

        /// <summary>
        /// Símbolo de planta (linhas simbólicas: folha, arco, caixilho) de cada tipo de porta e janela,
        /// lido no editor de famílias, em metros nas coordenadas da família. Nada é gravado.
        /// </summary>
        private static Dictionary<long, List<List<double>>> ReadOpeningSymbols(Document doc, List<FamilySymbol> symbols, ModelExportResult result)
        {
            var outMap = new Dictionary<long, List<List<double>>>();
            foreach (var group in symbols.GroupBy(s => FamilyExporter.IdValue(s.Family.Id)))
            {
                var family = group.First().Family;
                if (!family.IsEditable) continue;
                Document fam = null;
                try
                {
                    fam = doc.EditFamily(family);
                    var mgr = fam.FamilyManager;
                    using (var tg = new TransactionGroup(fam, "SmartEasyBIM: símbolo de planta"))
                    {
                        tg.Start();
                        foreach (var sym in group)
                        {
                            var ft = mgr.Types.Cast<FamilyType>().FirstOrDefault(t => t != null && t.Name == sym.Name);
                            if (ft != null)
                            {
                                using (var tx = new Transaction(fam, "SmartEasyBIM: tipo"))
                                {
                                    tx.Start();
                                    mgr.CurrentType = ft;
                                    tx.Commit();
                                }
                            }
                            var et = new ExportedType { Name = sym.Name };
                            FamilyExporter.ReadPlanLines(fam, et);
                            outMap[FamilyExporter.IdValue(sym.Id)] = et.PlanLines.Select(l => l.Select(v => v / 1000.0).ToList()).ToList();
                        }
                        tg.RollBack();
                    }
                }
                catch (Exception ex)
                {
                    result.Warnings.Add($"Símbolo de planta de {family.Name}: {ex.Message}");
                }
                finally
                {
                    fam?.Close(false);
                }
            }
            return outMap;
        }
    }
}
